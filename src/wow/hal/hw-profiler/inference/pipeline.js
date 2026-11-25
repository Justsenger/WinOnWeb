import { getCachedMobileModelsDb, KB_VERSION, mobileModelSocOverrides, mobileSocsDb, pcCpusDb, } from '../data/kb.js';
import { parseGpuContext } from './gpu_parser.js';
function realField(value, confidence, sources, capped = false) {
    return {
        status: 'real',
        value,
        confidence,
        tier: confidence >= 0.85 ? 'high' : 'medium',
        ...(capped ? { capped: true } : {}),
        sources,
    };
}
function exactField(value, confidence, sources) {
    return {
        status: 'inferred_exact',
        value,
        confidence,
        tier: confidence >= 0.85 ? 'high' : 'medium',
        sources,
    };
}
function candidatesField(values, confidence, sources, commonFamily) {
    return {
        status: 'inferred_candidates',
        candidates: values,
        commonFamily,
        confidence,
        tier: confidence >= 0.6 ? 'medium' : 'low',
        sources,
    };
}
function unknownField(reason, sources, detail, fallbackName) {
    return {
        status: 'unknown',
        reason,
        confidence: 0,
        tier: 'none',
        detail,
        ...(fallbackName ? { fallbackName } : {}),
        sources,
    };
}
function detectOsAndArch(signals) {
    const ua = signals.userAgent;
    const plat = (signals.uaData?.platform || signals.platform || '').toLowerCase();
    let osName = 'Unknown';
    let osVersion = '';
    if (plat.includes('win') || /windows/i.test(ua)) {
        osName = 'Windows';
        osVersion = signals.uaData?.platformVersion || '';
    }
    else if (plat.includes('android') || /android/i.test(ua)) {
        osName = 'Android';
        const m = ua.match(/Android\s+([\d.]+)/i);
        osVersion = signals.uaData?.platformVersion || m?.[1] || '';
    }
    else if (/iphone|ipad|ipod/i.test(ua) || (plat.includes('mac') && signals.maxTouchPoints > 1)) {
        osName = /ipad/i.test(ua) || signals.maxTouchPoints > 1 ? 'iPadOS' : 'iOS';
        const m = ua.match(/OS\s+([\d_]+)/i);
        osVersion = m ? m[1].replace(/_/g, '.') : '';
    }
    else if (plat.includes('mac') || /macintosh|mac os x/i.test(ua)) {
        osName = 'macOS';
        osVersion = signals.uaData?.platformVersion || '';
    }
    else if (plat.includes('linux') || /linux/i.test(ua)) {
        osName = 'Linux';
    }
    let arch = signals.uaData?.architecture?.toLowerCase();
    if (arch === 'x86') {
        arch = signals.uaData?.bitness === '64' || signals.uaData?.wow64 ? 'x86_64' : 'x86';
    }
    else if (arch === 'arm') {
        arch = signals.uaData?.bitness === '64' ? 'arm64' : 'arm';
    }
    if (!arch) {
        if (/aarch64|arm64/i.test(ua))
            arch = 'arm64';
        else if (/x86_64|win64|x64|amd64/i.test(ua))
            arch = 'x86_64';
        else if (osName === 'Android' || osName === 'iOS' || osName === 'iPadOS')
            arch = 'arm64';
    }
    let formFactor = 'unknown';
    if (signals.uaData?.mobile || osName === 'iOS' || (osName === 'Android' && /mobile/i.test(ua))) {
        formFactor = 'smartphone';
    }
    else if (osName === 'iPadOS' || (osName === 'Android' && !/mobile/i.test(ua))) {
        formFactor = 'tablet';
    }
    else if (osName === 'Windows' || osName === 'macOS' || osName === 'Linux') {
        formFactor = 'desktop';
    }
    const bitness = signals.uaData?.bitness === '64' || arch === 'x86_64' || arch === 'arm64'
        ? '64'
        : signals.uaData?.bitness === '32'
            ? '32'
            : undefined;
    return { osName, osVersion, arch, bitness, formFactor };
}
function scoreSkuMarketPriority(sku, ctx = {}) {
    let score = 0;
    // Curated flagship entries rank above bulk auto-scraped records
    if (!sku.id.startsWith('bc-') && !sku.id.startsWith('intel-'))
        score += 100;
    const m = sku.model;
    // Explicit Top-1 tie-breakers for mainstream retail SKUs
    if (/X1E80100/i.test(m))
        score += 50;
    if (/258V/i.test(m))
        score += 30;
    if (/(7840HS|7640HS|1260P|1360P|155H)/i.test(m))
        score += 25;
    if (/\b(HS|H|U|P|K|V)\b/i.test(m) || /(HS|U|P|K|V)$/i.test(m))
        score += 15;
    // Penalize niche low-TDP -T / OEM variants
    if (/T$/i.test(m))
        score -= 40;
    // Lunar Lake 16 GB (256V/266V) vs 32 GB (258V/268V/288V) weighting via WebGPU maxBufferSize
    if (ctx.maxBufferSize && /(256V|266V|258V|268V|288V)/i.test(m)) {
        const FOUR_GIB = 4 * 1024 * 1024 * 1024;
        const EIGHT_GIB = 8 * 1024 * 1024 * 1024;
        const is16GbSku = /(256V|266V)/i.test(m);
        if (ctx.maxBufferSize <= FOUR_GIB) {
            score += is16GbSku ? 40 : -15;
        }
        else if (ctx.maxBufferSize >= EIGHT_GIB) {
            score += is16GbSku ? -15 : 40;
        }
    }
    return score;
}
function summarizeFromSkus(rawSkus, sources, baseConfidence, confidentSingle = false, scoringCtx = {}) {
    const sorted = [...rawSkus].sort((a, b) => scoreSkuMarketPriority(b, scoringCtx) - scoreSkuMarketPriority(a, scoringCtx));
    const skus = confidentSingle ? [sorted[0]] : sorted;
    const isExact = skus.length === 1;
    const prob = Math.round((1 / skus.length) * 1000) / 1000;
    const wrap = (vals, fallbackReason = 'kb_miss') => {
        const present = vals.filter((v) => v !== undefined && v !== null);
        if (present.length === 0)
            return unknownField(fallbackReason, sources);
        const serialized = present.map((v) => JSON.stringify(v));
        const uniqueMap = new Map();
        serialized.forEach((k, idx) => {
            if (!uniqueMap.has(k))
                uniqueMap.set(k, present[idx]);
        });
        if (uniqueMap.size === 1 && present.length === skus.length) {
            const exactConf = Math.round(Math.min(0.95, baseConfidence + 0.08) * 100) / 100;
            return isExact
                ? exactField(present[0], baseConfidence, sources)
                : exactField(present[0], exactConf, sources);
        }
        const uVals = Array.from(uniqueMap.values());
        const cProb = Math.round((1 / uVals.length) * 1000) / 1000;
        return candidatesField(uVals.map((v) => ({ value: v, probability: cProb })), Math.max(0.4, baseConfidence - 0.12), sources);
    };
    const skuCandidates = isExact
        ? exactField(skus[0], baseConfidence, sources)
        : candidatesField(skus.map((s) => ({ value: s, probability: prob })), baseConfidence, sources, skus[0].codename);
    return {
        vendor: wrap(skus.map((s) => s.vendor)),
        model: isExact
            ? exactField(skus[0].model, baseConfidence, sources)
            : candidatesField(skus.map((s) => ({ value: s.model, probability: prob })), baseConfidence, sources, skus[0].codename),
        winBrandString: isExact
            ? exactField(skus[0].winBrandString || skus[0].model, baseConfidence, sources)
            : candidatesField(skus.map((s) => ({ value: s.winBrandString || s.model, probability: prob })), baseConfidence, sources, skus[0].codename),
        codename: wrap(skus.map((s) => s.codename)),
        baseClockGHz: wrap(skus.map((s) => s.baseClockGHz)),
        physicalCores: wrap(skus.map((s) => s.physicalCores)),
        cache: wrap(skus.map((s) => s.cache)),
        memorySpec: wrap(skus.map((s) => s.memorySpec)),
        npu: wrap(skus.map((s) => s.npu)),
        network: wrap(skus.map((s) => s.coupledNetworkHardware), 'hardware_decoupled'),
        skuCandidates,
    };
}
export function inferHardwareFromSignals(signals, options = {}) {
    const startMs = typeof performance !== 'undefined' ? performance.now() : 0;
    const { osName, osVersion, arch, bitness, formFactor } = detectOsAndArch(signals);
    const gpuCtx = parseGpuContext(signals);
    const cores = signals.hardwareConcurrency;
    const logicalCoresField = cores
        ? realField(cores, 0.98, [{ signal: 'navigator.hardwareConcurrency', observed: String(cores) }])
        : unknownField('browser_unsupported', []);
    const memGiB = signals.deviceMemoryGiB;
    const browserMemField = memGiB
        ? realField(memGiB, 0.95, [{ signal: 'navigator.deviceMemory', observed: String(memGiB) }], memGiB === 8)
        : unknownField(signals.isSecureContext ? 'browser_unsupported' : 'insecure_context', []);
    // Device Marketing Model (Mobile UA-CH or legacy UA)
    const rawModelCode = signals.uaData?.model?.trim() || '';
    const upperCode = rawModelCode.toUpperCase();
    const activeMobileModelsDb = options.mobileModelsDb ?? getCachedMobileModelsDb();
    const modelEntry = rawModelCode
        ? mobileModelSocOverrides[upperCode] ?? activeMobileModelsDb?.[upperCode]
        : undefined;
    let marketingModelField;
    if (modelEntry) {
        marketingModelField = exactField({ brand: modelEntry.brand, modelName: modelEntry.modelName, rawCode: rawModelCode }, 0.97, [{ signal: 'uaData.model', observed: rawModelCode, ruleId: `model:${rawModelCode.toUpperCase()}` }]);
    }
    else if (rawModelCode) {
        marketingModelField = realField({ brand: 'Unknown', modelName: rawModelCode, rawCode: rawModelCode }, 0.9, [{ signal: 'uaData.model', observed: rawModelCode }]);
    }
    else if (osName === 'Android' && !signals.isSecureContext) {
        marketingModelField = unknownField('insecure_context', [], 'HTTPS required for uaData.model');
    }
    else if (osName === 'iOS' || osName === 'iPadOS') {
        marketingModelField = unknownField('privacy_masked', [], 'iOS/iPadOS masks specific device model');
    }
    else {
        marketingModelField = unknownField('browser_unsupported', []);
    }
    // GPU output fields
    const gpuSources = [];
    if (gpuCtx.rendererRaw)
        gpuSources.push({ signal: 'webgl.renderer', observed: gpuCtx.rendererRaw });
    if (gpuCtx.igpuDeviceHexForInference) {
        gpuSources.push({
            signal: 'gpu.pciDeviceId',
            observed: `0x${gpuCtx.igpuDeviceHexForInference}`,
            ruleId: gpuCtx.igpuVendorHexForInference
                ? `pci:${gpuCtx.igpuVendorHexForInference}:${gpuCtx.igpuDeviceHexForInference}`
                : undefined,
        });
    }
    const gpuProfile = {
        environment: exactField(gpuCtx.environment, gpuCtx.rendererRaw ? 0.96 : 0.5, gpuSources),
        vendor: gpuCtx.vendor !== 'Unknown' ? realField(gpuCtx.vendor, 0.95, gpuSources) : unknownField('kb_miss', gpuSources),
        rendererRaw: gpuCtx.rendererRaw ? realField(gpuCtx.rendererRaw, 0.98, gpuSources) : unknownField('browser_unsupported', []),
        pciDeviceIdHex: gpuCtx.deviceHex
            ? realField(`0x${gpuCtx.deviceHex}`, 0.98, gpuSources)
            : unknownField('browser_unsupported', gpuSources),
        architecture: gpuCtx.architecture
            ? exactField(gpuCtx.architecture, 0.9, gpuSources)
            : unknownField('kb_miss', gpuSources),
        name: gpuCtx.pciEntry?.name
            ? exactField(gpuCtx.pciEntry.name, 0.96, gpuSources)
            : gpuCtx.rendererRaw
                ? realField(gpuCtx.rendererRaw, 0.9, gpuSources)
                : unknownField('browser_unsupported', []),
    };
    const fallbackCpuName = gpuCtx.isVirtualOrSoftware
        ? arch === 'arm64'
            ? 'Virtual ARM64 Processor'
            : 'Virtual x64 Processor'
        : arch === 'arm64'
            ? 'ARM64 Processor'
            : 'x64 Processor';
    // Layer 0 Guardrails: Software/Virtual renderer / Discrete GPU occlusion
    let cpuVendor = unknownField('kb_miss', []);
    let cpuModel = unknownField('kb_miss', [], undefined, fallbackCpuName);
    let cpuWinBrand = unknownField('kb_miss', [], undefined, fallbackCpuName);
    let cpuCodename = unknownField('kb_miss', []);
    let cpuBaseClock = unknownField('kb_miss', []);
    let cpuPhysicalCores = unknownField('kb_miss', []);
    let cpuCache = unknownField('kb_miss', []);
    let cpuSkus = unknownField('kb_miss', []);
    let memSpecField = unknownField('kb_miss', []);
    let npuField = unknownField('kb_miss', []);
    let netField = unknownField('hardware_decoupled', []);
    if (gpuCtx.isVirtualOrSoftware) {
        const swSrc = [{ signal: 'webgl.renderer', observed: gpuCtx.rendererRaw }];
        cpuModel = unknownField('privacy_masked', swSrc, 'Virtual or software GPU renderer', fallbackCpuName);
        cpuWinBrand = unknownField('privacy_masked', swSrc, 'Virtual or software GPU renderer', fallbackCpuName);
        cpuSkus = unknownField('privacy_masked', swSrc);
        npuField = unknownField('privacy_masked', swSrc);
        memSpecField = unknownField('privacy_masked', swSrc);
    }
    else if (gpuCtx.environment === 'discrete_primary') {
        const dSrc = gpuSources;
        cpuModel = unknownField('discrete_gpu_occluded', dSrc, 'Discrete GPU hides integrated GPU PCI ID; refusing to guess desktop CPU model', fallbackCpuName);
        cpuWinBrand = unknownField('discrete_gpu_occluded', dSrc, undefined, fallbackCpuName);
        cpuSkus = unknownField('discrete_gpu_occluded', dSrc);
        cpuBaseClock = unknownField('discrete_gpu_occluded', dSrc);
        cpuPhysicalCores = unknownField('discrete_gpu_occluded', dSrc);
        cpuCache = unknownField('discrete_gpu_occluded', dSrc);
        npuField = unknownField('discrete_gpu_occluded', dSrc);
        memSpecField = unknownField('discrete_gpu_occluded', dSrc);
        netField = unknownField('hardware_decoupled', dSrc);
    }
    else if (osName === 'Android' || osName === 'iOS' || osName === 'iPadOS') {
        // Layer 1A: Mobile / Tablet SoC Inference
        const mSources = [...gpuSources];
        if (rawModelCode)
            mSources.push({ signal: 'uaData.model', observed: rawModelCode });
        if (cores)
            mSources.push({ signal: 'navigator.hardwareConcurrency', observed: String(cores) });
        let matchedSocs = (modelEntry?.socIds || [])
            .map((sid) => mobileSocsDb.socs[sid])
            .filter((s) => Boolean(s));
        if (matchedSocs.length === 0 && gpuCtx.normalizedMobileKey) {
            const exactIds = mobileSocsDb.gpuToSocs[gpuCtx.normalizedMobileKey] || [];
            const baseKey = gpuCtx.normalizedMobileKey.replace(/(mc|mp)\d+$/, '');
            const ids = exactIds.length > 0
                ? exactIds
                : baseKey !== gpuCtx.normalizedMobileKey
                    ? mobileSocsDb.gpuToSocs[baseKey] || []
                    : [];
            matchedSocs = ids
                .map((id) => mobileSocsDb.socs[id])
                .filter((s) => Boolean(s));
            if (cores && matchedSocs.some((s) => s.logicalCores === cores)) {
                matchedSocs = matchedSocs.filter((s) => s.logicalCores === cores);
            }
        }
        if (matchedSocs.length > 0) {
            const conf = modelEntry?.socIds && matchedSocs.length === 1 ? 0.97 : matchedSocs.length === 1 ? 0.9 : 0.72;
            const sum = summarizeFromSkus(matchedSocs, mSources, conf, Boolean(options.confidentSingle));
            cpuVendor = sum.vendor;
            cpuModel = sum.model;
            cpuWinBrand = sum.winBrandString;
            cpuCodename = sum.codename;
            cpuBaseClock = sum.baseClockGHz;
            cpuPhysicalCores = sum.physicalCores;
            cpuCache = sum.cache;
            memSpecField = sum.memorySpec;
            npuField = sum.npu;
            netField = sum.network;
            cpuSkus = sum.skuCandidates;
        }
        else if (gpuCtx.isPrivacyMaskedAppleGpu) {
            cpuVendor = exactField('Apple', 0.99, mSources);
            cpuModel = unknownField('privacy_masked', mSources, 'Safari masks Apple A-series GPU string');
        }
    }
    else {
        // Layer 1B: PC / Windows on ARM / Apple Silicon
        const pcSources = [...gpuSources];
        if (arch)
            pcSources.push({ signal: 'uaData.architecture', observed: arch });
        if (cores)
            pcSources.push({ signal: 'navigator.hardwareConcurrency', observed: String(cores) });
        if (osName === 'macOS' && arch === 'arm64' && gpuCtx.isPrivacyMaskedAppleGpu) {
            const appleCpus = pcCpusDb.filter((c) => c.vendor === 'Apple' && (!cores || c.logicalCores === cores));
            if (appleCpus.length > 0) {
                const sum = summarizeFromSkus(appleCpus, pcSources, 0.7, Boolean(options.confidentSingle));
                cpuVendor = sum.vendor;
                cpuModel = sum.model;
                cpuWinBrand = sum.winBrandString;
                cpuCodename = sum.codename;
                cpuBaseClock = sum.baseClockGHz;
                cpuPhysicalCores = sum.physicalCores;
                cpuCache = sum.cache;
                memSpecField = sum.memorySpec;
                npuField = sum.npu;
                cpuSkus = sum.skuCandidates;
            }
            else {
                cpuVendor = exactField('Apple', 0.98, pcSources);
                cpuModel = unknownField('privacy_masked', pcSources, 'Safari masks Apple Silicon GPU model');
            }
        }
        else {
            const igpuStr = gpuCtx.igpuRendererForInference.toLowerCase();
            const igpuDev = gpuCtx.igpuDeviceHexForInference;
            let candidates = pcCpusDb.filter((c) => {
                if (arch && c.architecture !== arch)
                    return false;
                if (cores && c.logicalCores && c.logicalCores !== cores)
                    return false;
                const pciMatch = igpuDev && c.igpuPciIds?.includes(igpuDev);
                const tokenMatch = c.igpuTokens?.some((t) => igpuStr.includes(t));
                // For shared PCI IDs (like AMD 0x15bf or Qualcomm 0x36334330), require tokenMatch too if token is present in renderer!
                if (c.igpuPciIds?.length && igpuDev) {
                    if (!pciMatch)
                        return false;
                    if (c.igpuTokens?.length && igpuStr) {
                        // If renderer explicitly names 780M vs 760M or X1-85 vs X1-45, enforce it
                        const hasExplicitSub = /(780m|760m|740m|890m|880m|x1-85|x1-45|140v|130v)/i.test(igpuStr);
                        if (hasExplicitSub && !tokenMatch)
                            return false;
                    }
                    return true;
                }
                return Boolean(tokenMatch);
            });
            if (candidates.length > 0) {
                const primaryAdapter = signals.webgpu?.adapters.find((a) => a.powerPreference === 'low-power' && !a.isFallbackAdapter) ||
                    signals.webgpu?.adapters.find((a) => !a.isFallbackAdapter);
                const maxBufferSize = primaryAdapter?.maxBufferSize;
                if (maxBufferSize) {
                    pcSources.push({ signal: 'webgpu.adapter.limits.maxBufferSize', observed: String(maxBufferSize) });
                }
                const conf = candidates.length === 1 ? 0.96 : candidates.length <= 3 ? 0.84 : 0.68;
                const sum = summarizeFromSkus(candidates, pcSources, conf, Boolean(options.confidentSingle), {
                    maxBufferSize,
                });
                cpuVendor = sum.vendor;
                cpuModel = sum.model;
                cpuWinBrand = sum.winBrandString;
                cpuCodename = sum.codename;
                cpuBaseClock = sum.baseClockGHz;
                cpuPhysicalCores = sum.physicalCores;
                cpuCache = sum.cache;
                memSpecField = sum.memorySpec;
                npuField = sum.npu;
                netField = sum.network;
                cpuSkus = sum.skuCandidates;
            }
        }
    }
    const webnnNpuField = signals.webnn?.available
        ? realField(Boolean(signals.webnn.npuSupported), 0.95, [
            { signal: 'navigator.ml.createContext(npu)', observed: String(signals.webnn.npuSupported) },
        ])
        : unknownField(signals.isSecureContext ? 'browser_unsupported' : 'insecure_context', []);
    const executionEnvironment = gpuCtx.isVirtualOrSoftware
        ? 'virtual_or_emulated'
        : gpuCtx.environment === 'discrete_primary'
            ? 'bare_metal_discrete_opaque'
            : cpuModel.status !== 'unknown'
                ? 'bare_metal_identified'
                : 'generic_unknown';
    const endMs = typeof performance !== 'undefined' ? performance.now() : 0;
    return {
        meta: {
            schemaVersion: '1.0.0',
            kbVersion: KB_VERSION,
            timestampIso: new Date().toISOString(),
            isSecureContext: signals.isSecureContext,
            degradationMode: signals.isSecureContext ? 'full_secure' : 'degraded_insecure',
            executionEnvironment,
            collectionDurationMs: Math.max(0, Math.round((endMs - startMs) * 100) / 100),
        },
        device: {
            formFactor: realField(formFactor, 0.95, [{ signal: 'navigator.userAgent' }]),
            osName: osName !== 'Unknown' ? realField(osName, 0.98, [{ signal: 'navigator.userAgent' }]) : unknownField('kb_miss', []),
            osVersion: osVersion ? realField(osVersion, 0.95, [{ signal: 'uaData.platformVersion' }]) : unknownField('browser_unsupported', []),
            architecture: arch ? realField(arch, 0.96, [{ signal: 'uaData.architecture' }]) : unknownField('insecure_context', []),
            bitness: bitness ? realField(bitness, 0.96, [{ signal: 'uaData.bitness' }]) : unknownField('insecure_context', []),
            marketingModel: marketingModelField,
        },
        cpu: {
            vendor: cpuVendor,
            model: cpuModel,
            winBrandString: cpuWinBrand,
            codename: cpuCodename,
            baseClockGHz: cpuBaseClock,
            physicalCores: cpuPhysicalCores,
            logicalCores: logicalCoresField,
            cache: cpuCache,
            skuCandidates: cpuSkus,
        },
        gpu: gpuProfile,
        memory: {
            browserDeviceMemoryGiB: browserMemField,
            spec: memSpecField,
        },
        npu: {
            hardware: npuField,
            webnnNpuSupported: webnnNpuField,
        },
        network: {
            hardwareName: netField,
        },
    };
}
