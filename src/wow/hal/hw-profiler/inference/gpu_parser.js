import { gpuPciDb } from '../data/kb.js';
const SOFTWARE_RENDERER_RE = /swiftshader|llvmpipe|softpipe|microsoft basic render driver|apple software renderer|subzero/i;
const VIRTUAL_GPU_RE = /vmware|svga|qemu|virtio|red hat|virtualbox|vbox|parallels|hyper-v|microsoft remote display/i;
const DISCRETE_RENDERER_RE = /\b(geforce|rtx|gtx|quadro|tesla|titan|radeon\s+rx|radeon\s+pro\s+w|arc\s+a\d{3}|arc\s+b\d{3})\b/i;
export function normalizeMobileGpuKey(name) {
    const s = name
        .toLowerCase()
        .replace(/\(tm\)|\(r\)|qualcomm|arm|imagination|powervr|graphics|gpu/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const adreno = s.match(/adreno\s*(\d{3,4}l?\b|x\d-\d+)/);
    if (adreno)
        return `adreno:${adreno[1]}`;
    const mali = s.match(/(immortalis|mali)[-\s]*([gt]\d+(?:\s*mp\d+|\s*mc\d+)?)/);
    if (mali)
        return `${mali[1]}:${mali[2].replace(/\s+/g, '')}`;
    const xclipse = s.match(/xclipse[-\s]*(\d{3})/);
    if (xclipse)
        return `xclipse:${xclipse[1]}`;
    const apple = s.match(/apple\s*(m\d+(?:\s*(?:pro|max|ultra))?|a\d+(?:\s*pro)?)/);
    if (apple)
        return `apple:${apple[1].replace(/\s+/g, '-')}`;
    return undefined;
}
function inferVendorHex(vendorStr) {
    const v = vendorStr.toLowerCase();
    if (v.includes('intel'))
        return '8086';
    if (v.includes('amd') || v.includes('ati') || v.includes('advanced micro'))
        return '1002';
    if (v.includes('nvidia'))
        return '10de';
    if (v.includes('qualcomm'))
        return '5143';
    if (v.includes('apple'))
        return '106b';
    return undefined;
}
function normalizeHex4Or8(raw) {
    if (!raw)
        return undefined;
    const cleaned = raw.toLowerCase().replace(/^0x/, '').replace(/^0+(?=[0-9a-f]{4}$)/, '');
    if (!/^[0-9a-f]{4,8}$/.test(cleaned))
        return undefined;
    if (cleaned.length > 4 && cleaned.startsWith('0000')) {
        return cleaned.slice(4);
    }
    return cleaned;
}
export function parseAngleOrRenderer(rendererRaw, vendorHint = '') {
    // Example: ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)
    const angleMatch = rendererRaw.match(/^ANGLE\s*\(\s*([^,]+),\s*(.+)\)$/i);
    const body = angleMatch ? angleMatch[2] : rendererRaw;
    const vendorPart = angleMatch ? angleMatch[1].trim() : vendorHint;
    const devIdMatch = body.match(/\(0x([0-9a-fA-F]{4,8})\)/);
    const deviceHex = normalizeHex4Or8(devIdMatch?.[1]);
    let vendor = 'Unknown';
    const combined = `${vendorPart} ${body}`.toLowerCase();
    if (combined.includes('intel'))
        vendor = 'Intel';
    else if (combined.includes('nvidia'))
        vendor = 'NVIDIA';
    else if (combined.includes('amd') || combined.includes('radeon') || combined.includes('ati '))
        vendor = 'AMD';
    else if (combined.includes('qualcomm') || combined.includes('adreno'))
        vendor = 'Qualcomm';
    else if (combined.includes('apple'))
        vendor = 'Apple';
    else if (combined.includes('mali') || combined.includes('immortalis') || combined.includes('arm'))
        vendor = 'ARM';
    else if (vendorPart)
        vendor = vendorPart;
    return {
        vendor,
        vendorHex: inferVendorHex(vendor),
        deviceHex,
    };
}
export function parseGpuContext(signals) {
    const webglRenderer = signals.webgl?.unmaskedRenderer || signals.webgl?.renderer || '';
    const webglVendor = signals.webgl?.unmaskedVendor || signals.webgl?.vendor || '';
    const lowPowerAdapter = signals.webgpu?.adapters.find((a) => a.powerPreference === 'low-power' && !a.isFallbackAdapter);
    const highPerfAdapter = signals.webgpu?.adapters.find((a) => a.powerPreference === 'high-performance' && !a.isFallbackAdapter);
    const anyWebGpuAdapter = lowPowerAdapter || highPerfAdapter || signals.webgpu?.adapters[0];
    const primaryRenderer = webglRenderer || anyWebGpuAdapter?.description || '';
    const primaryVendorHint = webglVendor || anyWebGpuAdapter?.vendor || '';
    const isSoftwareRenderer = SOFTWARE_RENDERER_RE.test(primaryRenderer) ||
        Boolean(anyWebGpuAdapter?.isFallbackAdapter && signals.webgpu?.adapters.length === 1);
    const isVirtualOrSoftware = isSoftwareRenderer || VIRTUAL_GPU_RE.test(primaryRenderer);
    const isPrivacyMaskedAppleGpu = /^apple\s+gpu$/i.test(primaryRenderer.trim());
    const parsedPrimary = parseAngleOrRenderer(primaryRenderer, primaryVendorHint);
    const webgpuPrimaryDevHex = normalizeHex4Or8(anyWebGpuAdapter?.device);
    const primaryDeviceHex = parsedPrimary.deviceHex || webgpuPrimaryDevHex;
    const primaryVendorHex = parsedPrimary.vendorHex || inferVendorHex(anyWebGpuAdapter?.vendor || '');
    const primaryPciEntry = primaryVendorHex && primaryDeviceHex
        ? gpuPciDb[`${primaryVendorHex}:${primaryDeviceHex}`]
        : undefined;
    // Check if WebGPU low-power exposes an iGPU even when primary WebGL is discrete
    let igpuAdapter = lowPowerAdapter;
    if (igpuAdapter) {
        const lpDev = normalizeHex4Or8(igpuAdapter.device);
        const lpVen = inferVendorHex(igpuAdapter.vendor || '');
        const lpEntry = lpVen && lpDev ? gpuPciDb[`${lpVen}:${lpDev}`] : undefined;
        if (lpEntry?.kind === 'dgpu' || DISCRETE_RENDERER_RE.test(igpuAdapter.description || '')) {
            igpuAdapter = undefined;
        }
    }
    const primaryIsDiscrete = primaryPciEntry?.kind === 'dgpu' ||
        primaryVendorHex === '10de' ||
        DISCRETE_RENDERER_RE.test(primaryRenderer);
    let environment = 'integrated_only';
    if (isSoftwareRenderer) {
        environment = 'software_emulated';
    }
    else if (primaryIsDiscrete && igpuAdapter) {
        environment = 'dual_gpu_detected';
    }
    else if (primaryIsDiscrete) {
        environment = 'discrete_primary';
    }
    // Determine the best iGPU signal for CPU/SoC inference
    let igpuRenderer = primaryRenderer;
    let igpuDeviceHex = primaryDeviceHex;
    let igpuVendorHex = primaryVendorHex;
    let igpuPciEntry = primaryPciEntry;
    if (environment === 'dual_gpu_detected' && igpuAdapter) {
        igpuRenderer = igpuAdapter.description || igpuAdapter.architecture || primaryRenderer;
        igpuDeviceHex = normalizeHex4Or8(igpuAdapter.device);
        igpuVendorHex = inferVendorHex(igpuAdapter.vendor || '');
        igpuPciEntry =
            igpuVendorHex && igpuDeviceHex
                ? gpuPciDb[`${igpuVendorHex}:${igpuDeviceHex}`]
                : undefined;
    }
    return {
        environment,
        vendor: parsedPrimary.vendor,
        rendererRaw: primaryRenderer,
        vendorHex: primaryVendorHex,
        deviceHex: primaryDeviceHex,
        pciEntry: primaryPciEntry,
        architecture: anyWebGpuAdapter?.architecture || primaryPciEntry?.gen,
        normalizedMobileKey: normalizeMobileGpuKey(primaryRenderer),
        isSoftwareRenderer,
        isVirtualOrSoftware,
        isPrivacyMaskedAppleGpu,
        igpuRendererForInference: igpuRenderer,
        igpuDeviceHexForInference: igpuDeviceHex,
        igpuVendorHexForInference: igpuVendorHex,
        igpuPciEntryForInference: igpuPciEntry,
    };
}
