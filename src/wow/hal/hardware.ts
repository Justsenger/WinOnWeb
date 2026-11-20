import type { CpuCacheSpec, CpuSkuSpec, FieldEstimation, HardwareProfile, MemorySpec, UnknownReason } from 'hw-profiler';
import {
  collectDeviceHardwareReport,
  collectStorageProbeInfo,
  type DeviceProbeReport,
  type StorageProbeInfo,
} from './capabilities';
import legacySuspectCacheBackfillRaw from './legacy-cache-backfill.json';
import { drainStorageIo } from './storage';

const HISTORY_LEN = 60;

export type VirtualHardwareProvenance = 'real' | 'inferred' | 'simulated' | 'unknown';

export interface VirtualHardwareValue<T> {
  value: T;
  provenance: VirtualHardwareProvenance;
  tooltip?: string;
  unknownReason?: UnknownReason;
}

export interface VirtualHardwareGpuInfo {
  id: string;
  index: number;
  name: string;
  vendor: string;
  architecture?: string;
  pciDeviceIdHex?: string;
  environment?: 'integrated_only' | 'discrete_primary' | 'dual_gpu_detected' | 'software_emulated';
  isSoftwareRenderer: boolean;
  webglVersion?: string;
  driverVersion?: string;
  directXVersion?: string;
  sharedTotalGb: number;
  sharedUsedGb: number;
  dedicatedTotalGb?: number;
  dedicatedUsedGb?: number;
  dedicatedMemPts?: number[];
  usagePct: number;
  ptsCompute: number[];
  ptsPriority3d: number[];
  pts3d: number[];
  ptsCopy: number[];
  ptsEnc: number[];
  ptsDec: number[];
  zeroHistory: number[];
  memUtilPct: number;
  memPts: number[];
  provenance: VirtualHardwareProvenance;
  tooltip?: string;
}

export interface VirtualHardwareNpuInfo {
  name: string;
  displayName: string;
  sidebarName: string;
  vendor: string;
  topsPeak?: number;
  webnnSupported?: boolean;
  usagePct: number;
  history: number[];
  memHistory: number[];
  provenance: VirtualHardwareProvenance;
  tooltip: string;
}

export interface VirtualHardwareSnapshot {
  timestamp: string;
  probed: boolean;
  system: {
    osName: VirtualHardwareValue<string>;
    osVersion: string;
    architecture: VirtualHardwareValue<string>;
    formFactor: string;
  };
  cpu: {
    displayName: VirtualHardwareValue<string>;
    shortName: string;
    vendor: string;
    architecture: string;
    logicalCores: number;
    physicalCores: VirtualHardwareValue<number | null>;
    isVmFallback: boolean;
    baseClockGhz: VirtualHardwareValue<number | null>;
    socketCount: number;
    uptimeSeconds: number;
    currentClockGhz: number;
    boostClockGhz: number | null;
    cache: {
      l1?: string;
      l2?: string;
      l3?: string;
      tooltip?: string;
      l1Tooltip?: string;
      l2Tooltip?: string;
      l3Tooltip?: string;
      provenanceTier?: 'T1' | 'T2' | 'T3' | 'T4';
      provenanceLabel?: string;
      /** 仅内部标注：来自肃清前历史库的缺失字段暂借补缺，待实机核实后转正；不对 UI 展示 */
      _internalSuspect?: boolean;
      _internalSource?: 'legacy_unverified_backfill';
    };
    usagePct: number;
    history: number[];
    kernelHistory: number[];
    kernelCoreHistories: number[][];
    coreHistories: number[][];
    procCount: number;
    threadCount: number;
    handleCount: number;
  };
  memory: {
    totalGb: number;
    usableGb: number;
    usedGb: number;
    availGb: number;
    usagePct: number;
    history: number[];
    realDeviceGb: number | null;
    capped: boolean;
    hardwareReservedMb: number;
    capText: string;
    capTip?: string;
    modifiedMb: number;
    standbyMb: number;
    freeMb: number;
    compressionSavedMb: number;
    compressedMb: number;
    cachedText: string;
    standbyPct: number;
    committedGb: number;
    commitLimitGb: number;
    pagedPoolMb: number;
    nonPagedPoolMb: number;
    spec?: MemorySpec;
    specProvenance: VirtualHardwareProvenance;
  };
  gpus: VirtualHardwareGpuInfo[];
  npu: VirtualHardwareNpuInfo | null;
  storage: {
    model: string;
    type: string;
    capacityBytes: number;
    isSystemDisk: boolean;
    hasPagefile: boolean;
    probe: StorageProbeInfo | null;
    fixedQuotaBytes?: number | null;
    activePct: number;
    responseTimeMs: number;
    activeHistory: number[];
    rateHistory: number[];
    readHistory: number[];
    writeHistory: number[];
    readKb: number;
    writeKb: number;
  };
  network: {
    onLine: boolean;
    interfaceName: string;
    isWifiReal: boolean;
    adapterName: VirtualHardwareValue<string>;
    connectionType?: string;
    effectiveType?: string;
    downlinkMbps?: number;
    rttMs?: number;
    saveData?: boolean;
    rxHistory: number[];
    txHistory: number[];
    sendKbps: number;
    recvKbps: number;
    sentBytesTotal: number;
    recvBytesTotal: number;
  };
  display: DeviceProbeReport['display'] | null;
  battery: DeviceProbeReport['battery'] | null;
  peripheralsAndApis: DeviceProbeReport['peripheralsAndApis'] | null;
  processMetrics: {
    shellMemMb: number | null;
    byAppIdMemMb: Record<string, number>;
    byAppIdNetMbps: Record<string, number>;
    byPid: Record<number, { workers: number; handles: number }>;
  };
}

function seedSpikyHistory(base: number, amp: number, spikeChance = 0.2): number[] {
  const arr: number[] = [];
  let burstLeft = 0;
  let burstLevel = base;
  for (let i = 0; i < HISTORY_LEN; i++) {
    if (burstLeft <= 0 && Math.random() < spikeChance) {
      burstLeft = 1 + Math.floor(Math.random() * 2);
      burstLevel = base + amp * (0.45 + Math.random() * 0.6);
    }
    let val: number;
    if (burstLeft > 0) {
      burstLeft -= 1;
      val = burstLevel * (0.75 + Math.random() * 0.3);
    } else {
      val = Math.max(0.8, base * (0.35 + Math.random() * 0.85));
    }
    arr.push(Math.max(1, Math.min(95, Math.round(val))));
  }
  return arr;
}

function formatCacheSizeKB(kb: number): string {
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

interface LegacySuspectCacheEntry {
  l1KB?: number;
  l2KB?: number;
  l3KB?: number;
  /** 仅内部留档：该条目尚未经过实机/白皮书独立验证 */
  suspect: true;
}

const LEGACY_SUSPECT_CACHE_BACKFILL =
  legacySuspectCacheBackfillRaw as Record<string, LegacySuspectCacheEntry>;

function findLegacySuspectCache(sku?: CpuSkuSpec): LegacySuspectCacheEntry | undefined {
  if (!sku?.id) return undefined;
  return LEGACY_SUSPECT_CACHE_BACKFILL[sku.id];
}

function pickConsensusCache(
  est: FieldEstimation<CpuCacheSpec> | undefined,
  sku?: CpuSkuSpec,
): {
  l1?: string;
  l2?: string;
  l3?: string;
  tooltip?: string;
  l1Tooltip?: string;
  l2Tooltip?: string;
  l3Tooltip?: string;
  provenanceTier?: 'T1' | 'T2' | 'T3' | 'T4';
  provenanceLabel?: string;
  _internalSuspect?: boolean;
  _internalSource?: 'legacy_unverified_backfill';
} {
  const spec = extractEstimationValue(est).value;

  type Provenance = {label:string; tier:'T1'|'T2'|'T3'|'T4'; slcKB?:number;
    fields?:Partial<Record<'l1'|'l2'|'l3',{tier:string;label:string}>>};
  const prov = (sku as (CpuSkuSpec & {cacheProvenance?:Provenance}) | undefined)?.cacheProvenance;
  const legacy = findLegacySuspectCache(sku);
  const resolvedL1 = spec?.l1KB && spec.l1KB > 0 ? spec.l1KB : legacy?.l1KB;
  const resolvedL2 = spec?.l2KB && spec.l2KB > 0 ? spec.l2KB : legacy?.l2KB;
  const resolvedL3 = spec?.l3KB && spec.l3KB > 0 ? spec.l3KB : legacy?.l3KB;

  if (!resolvedL1 && !resolvedL2 && !resolvedL3) return {};

  const usedBackfill =
    (!spec?.l1KB && Boolean(legacy?.l1KB)) ||
    (!spec?.l2KB && Boolean(legacy?.l2KB)) ||
    (!spec?.l3KB && Boolean(legacy?.l3KB));

  if (!spec) {
    return {
      l1: resolvedL1 ? formatCacheSizeKB(resolvedL1) : undefined,
      l2: resolvedL2 ? formatCacheSizeKB(resolvedL2) : undefined,
      l3: resolvedL3 ? formatCacheSizeKB(resolvedL3) : undefined,
      _internalSuspect: true,
      _internalSource: 'legacy_unverified_backfill',
    };
  }
  const baseTip = prov?.label ? `静态硬件指纹库推理 · ${prov.label}` : '静态硬件指纹库推理';
  const fmtFieldTip = (f?: { tier: string; label: string }, extra?: string) => {
    if (!f) return baseTip;
    return `${f.tier} · ${f.label}${extra ? `（${extra}）` : ''}`;
  };
  const slcNote =
    typeof prov?.slcKB === 'number' && prov.slcKB > 0
      ? `另含 ${formatCacheSizeKB(prov.slcKB)} 系统缓存 SLC，未混入 L3`
      : undefined;
  return {
    l1: resolvedL1 ? formatCacheSizeKB(resolvedL1) : undefined,
    l2: resolvedL2 ? formatCacheSizeKB(resolvedL2) : undefined,
    l3: resolvedL3 ? formatCacheSizeKB(resolvedL3) : undefined,
    tooltip: baseTip,
    l1Tooltip: spec.l1KB ? fmtFieldTip(prov?.fields?.l1) : undefined,
    l2Tooltip: spec.l2KB ? fmtFieldTip(prov?.fields?.l2) : undefined,
    l3Tooltip: spec.l3KB ? fmtFieldTip(prov?.fields?.l3, slcNote) : undefined,
    provenanceTier: prov?.tier,
    provenanceLabel: prov?.label,
    ...(usedBackfill ? { _internalSuspect: true, _internalSource: 'legacy_unverified_backfill' as const } : {}),
  };
}

function extractEstimationValue<T>(est: FieldEstimation<T> | undefined): {
  value: T | null;
  provenance: VirtualHardwareProvenance;
  capped?: boolean;
  unknownReason?: UnknownReason;
} {
  if (!est) return { value: null, provenance: 'unknown' };
  if (est.status === 'real') {
    return { value: est.value, provenance: 'real', capped: est.capped };
  }
  if (est.status === 'inferred_exact') {
    return { value: est.value, provenance: 'inferred' };
  }
  if (est.status === 'inferred_candidates' && est.candidates.length === 1) {
    return { value: est.candidates[0].value, provenance: 'inferred' };
  }
  return {
    value: null,
    provenance: 'unknown',
    unknownReason: est.status === 'unknown' ? est.reason : undefined,
  };
}

function cleanGpuName(renderer: string): string {
  if (!renderer || renderer === '不支持 WebGL' || renderer.startsWith('WebGL 探测失败:')) return '';
  const angleMatch = renderer.match(/^ANGLE\s*\(([^,]+),\s*(.+?)(?:,\s*(?:OpenGL|Direct3D|Vulkan|Metal).*)?\)$/i);
  let name = angleMatch ? angleMatch[2].trim() : renderer.trim();
  name = name
    .replace(/\s*\(0x[0-9a-f]+\)/gi, '')
    .replace(/\s+Direct3D\d+.*$/i, '')
    .replace(/\s+vs_\d+_\d+.*$/i, '')
    .replace(/\s+\(TM\)/gi, '(TM)')
    .replace(/\s+\(R\)/gi, '(R)')
    .trim();
  return name || renderer;
}

function inferGpuVendorFromText(name: string, fallbackVendor?: string): string {
  const src = `${name} ${fallbackVendor ?? ''}`.toLowerCase();
  if (src.includes('nvidia') || src.includes('geforce') || src.includes('rtx') || src.includes('gtx')) return 'NVIDIA';
  if (src.includes('amd') || src.includes('radeon')) return 'AMD';
  if (src.includes('intel') || src.includes('arc') || src.includes('uhd') || src.includes('iris')) return 'Intel';
  if (src.includes('qualcomm') || src.includes('adreno')) return 'Qualcomm';
  if (src.includes('apple')) return 'Apple';
  return fallbackVendor?.trim() || '未知';
}

function shortenCpuName(fullName: string): string {
  return fullName
    .replace(/@\s*\d+(?:\.\d+)?\s*GHz.*$/i, '')
    .replace(/\s+\d+-Core Processor/i, '')
    .replace(/\(R\)|\(TM\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveCpuArchitectureLabel(report: DeviceProbeReport | null): string {
  const ua = report?.context.uaData;
  const uaArch =
    typeof ua === 'object' && ua !== null && typeof ua.architecture === 'string'
      ? ua.architecture.trim().toLowerCase()
      : '';
  const uaBitness =
    typeof ua === 'object' && ua !== null && typeof ua.bitness === 'string'
      ? ua.bitness.trim()
      : '';

  if (uaArch === 'x86') return uaBitness === '64' ? 'x64' : 'x86';
  if (uaArch === 'arm') return uaBitness === '64' ? 'ARM64' : 'ARM';

  const navPlatform = typeof navigator !== 'undefined' ? navigator.platform : '';
  const navUa = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const rawHint = [uaArch, report?.context.platformLegacy ?? navPlatform, report?.context.userAgent ?? navUa]
    .join(' ')
    .toLowerCase();

  if (/\b(arm64|aarch64)\b/.test(rawHint)) return 'ARM64';
  if (/\b(armv\d+\w*|armhf|arm)\b/.test(rawHint)) return 'ARM';
  if (/\briscv64\b/.test(rawHint)) return 'RISC-V 64';
  if (/\briscv32\b/.test(rawHint)) return 'RISC-V 32';
  if (/\bloongarch64\b/.test(rawHint)) return 'LoongArch64';
  if (/\b(ppc64le|ppc64)\b/.test(rawHint)) return 'PowerPC 64';
  if (/\bs390x\b/.test(rawHint)) return 's390x';
  if (/\bmips64\b/.test(rawHint)) return 'MIPS64';
  if (/\b(win64|wow64|x86_64|amd64|x64)\b/.test(rawHint)) return 'x64';
  if (/\b(i[3-6]86|x86)\b/.test(rawHint)) return 'x86';

  return uaArch.toUpperCase();
}

function extractBrandClockGhz(hp: HardwareProfile | undefined): number | null {
  const est = extractEstimationValue(hp?.cpu.winBrandString);
  if (!est.value) return null;
  const match = est.value.match(/@\s*(\d+(?:\.\d+)?)\s*GHz/i);
  return match ? Number(match[1]) : null;
}

const DISCRETE_VRAM_RULES: ReadonlyArray<readonly [RegExp, number]> = [
  [/RTX\s*5090/i, 32],
  [/RTX\s*(4090|3090)/i, 24],
  [/RTX\s*(5080|4080|4070\s*Ti\s*SUPER)|RX\s*7900\s*XT/i, 16],
  [/RX\s*7900\s*XTX/i, 24],
  [/RTX\s*(4070|3060(?!\s*Ti))|RX\s*(6700|6750|7700)/i, 12],
  [/RTX\s*3080(?!\s*Ti)/i, 10],
  [/RTX\s*2060(?!\s*SUPER)|GTX\s*1660|GTX\s*1060/i, 6],
  [/RTX\s*(4060|3070|3060\s*Ti|2070|2080)|RX\s*(6600|7600)|Arc\s*A750/i, 8],
  [/Arc\s*A770/i, 16],
];

/** Estimate dedicated VRAM (GB) for discrete GPUs; returns undefined for integrated/software GPUs. */
function inferDiscreteVramGb(name: string, env?: VirtualHardwareGpuInfo['environment'], vendor?: string): number | undefined {
  if (env === 'integrated_only' || env === 'software_emulated') return undefined;
  const isDiscreteHint =
    env === 'discrete_primary' ||
    /geforce|rtx|gtx|quadro|radeon\s*rx|intel\(r\)\s*arc/i.test(name) ||
    /nvidia|amd/i.test(vendor ?? '');
  if (!isDiscreteHint) return undefined;
  for (const [pattern, gb] of DISCRETE_VRAM_RULES) {
    if (pattern.test(name)) return gb;
  }
  return 8;
}

export function createVirtualHardwareService(
  runtimeCounts: () => {
    threadCount: number;
    handleCount: number;
    byPid?: Record<number, { workers: number; handles: number }>;
  },
) {
  let report: DeviceProbeReport | null = null;
  let liveStorage: StorageProbeInfo | null = null;
  let latchedQuotaBytes: number | null = null;
  let latchedPersisted: boolean | null = null;
  let probeInFlight: Promise<DeviceProbeReport> | null = null;
  let storageInFlight = false;
  let tickTimer: number | null = null;
  let sampleTick = 0;

  function resolveFixedQuotaBytes(probe: StorageProbeInfo | null): number | null {
    const q = probe?.quotaBytes;
    if (typeof q !== 'number' || !Number.isFinite(q) || q <= 0) return latchedQuotaBytes;
    const u = typeof probe?.usageBytes === 'number' && Number.isFinite(probe.usageBytes) ? probe.usageBytes : 0;
    const persistedNow = probe?.persisted ?? null;
    if (latchedQuotaBytes === null) {
      const headroomGiB = (q - u) / 1024 ** 3;
      latchedQuotaBytes = u > 0 && Math.abs(headroomGiB - 10) < 0.05 ? q - u : q;
      latchedPersisted = persistedNow;
    } else if (latchedPersisted === false && persistedNow === true && q > latchedQuotaBytes * 1.2) {
      latchedQuotaBytes = q;
      latchedPersisted = true;
    }
    return latchedQuotaBytes;
  }

  const subscribers = new Set<(snap: VirtualHardwareSnapshot) => void>();

  let coreHistories: number[][] = [];
  const cpuHistory: number[] = Array(HISTORY_LEN).fill(0);
  let procCount = 1;
  const memHistory: number[] = Array(HISTORY_LEN).fill(0);
  const diskActiveHistory: number[] = Array(HISTORY_LEN).fill(0);
  const diskReadHistory: number[] = Array(HISTORY_LEN).fill(0);
  const diskWriteHistory: number[] = Array(HISTORY_LEN).fill(0);
  const diskRateHistory: number[] = Array(HISTORY_LEN).fill(0);
  const wifiRxHistory: number[] = Array(HISTORY_LEN).fill(0);
  const wifiTxHistory: number[] = Array(HISTORY_LEN).fill(0);
  let sentBytesTotal = 0;
  let recvBytesTotal = 0;
  const npuHistory: number[] = Array(HISTORY_LEN).fill(0);
  const npuMemHistory: number[] = Array(HISTORY_LEN).fill(0);
  const gpu3dHistory: number[] = Array(HISTORY_LEN).fill(0);
  const gpuCopyHistory: number[] = Array(HISTORY_LEN).fill(0);
  const gpuEncHistory: number[] = Array(HISTORY_LEN).fill(0);
  const gpuDecHistory: number[] = Array(HISTORY_LEN).fill(0);
  const gpuZeroHistory: number[] = Array(HISTORY_LEN).fill(0);
  const gpuMemHistory: number[] = Array(HISTORY_LEN).fill(0);
  const gpuDedicatedMemHistory: number[] = Array(HISTORY_LEN).fill(0);

  // --- WOW 自身真实运行态遥测探针 ---
  let wowMemBytes: number | null = null;
  let wowMemCommittedBytes: number | null = null;
  let wowMemLimitBytes: number | null = null;
  let wowMemSource: 'ua-specific' | 'js-heap' | 'none' = 'none';
  let memMeasureInFlight = false;
  let shellMemMb: number | null = null;
  let byAppIdMemMb: Record<string, number> = {};
  let pendingNetByAppBytes: Record<string, number> = {};
  let byAppIdNetMbps: Record<string, number> = {};

  let longTaskBusyMs = 0;
  let eventLoopLagMs = 0;
  let lastLagCheckAt = 0;
  let lagTimer: number | null = null;

  let pendingNetRxBytes = 0;
  let pendingNetTxBytes = 0;
  let lastStorageUsageBytes: number | null = null;

  let rafId: number | null = null;
  let lastRafAt = 0;
  let frameCountInSec = 0;
  let slowFrameMsInSec = 0;

  let longTaskObserver: PerformanceObserver | null = null;
  let resourceObserver: PerformanceObserver | null = null;

  function onVisibilityChange() {
    lastLagCheckAt = performance.now();
    lastRafAt = lastLagCheckAt;
    eventLoopLagMs = 0;
    longTaskBusyMs = 0;
    slowFrameMsInSec = 0;
    frameCountInSec = 0;
  }

  function extractWowAppIdFromUrl(rawUrl?: string): string | null {
    if (!rawUrl) return null;
    const match = /\/wow\/apps\/([a-z0-9_-]+)\//i.exec(rawUrl);
    return match ? match[1] : null;
  }

  function sampleWowMemoryNow() {
    if (typeof performance === 'undefined') return;
    const perf = performance as Performance & {
      memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number };
      measureUserAgentSpecificMemory?: () => Promise<{
        bytes: number;
        breakdown?: Array<{
          bytes: number;
          attribution?: Array<{ url?: string; container?: { src?: string } }>;
        }>;
      }>;
    };
    if (typeof perf.memory?.jsHeapSizeLimit === 'number' && perf.memory.jsHeapSizeLimit > 0) {
      wowMemLimitBytes = perf.memory.jsHeapSizeLimit;
    }
    if (typeof perf.memory?.totalJSHeapSize === 'number' && perf.memory.totalJSHeapSize >= 0) {
      wowMemCommittedBytes = perf.memory.totalJSHeapSize;
    }
    if (
      typeof perf.measureUserAgentSpecificMemory === 'function' &&
      typeof self !== 'undefined' &&
      self.crossOriginIsolated
    ) {
      if (memMeasureInFlight) return;
      memMeasureInFlight = true;
      void perf
        .measureUserAgentSpecificMemory()
        .then((res) => {
          if (typeof res?.bytes === 'number' && Number.isFinite(res.bytes) && res.bytes >= 0) {
            wowMemBytes = res.bytes;
            wowMemSource = 'ua-specific';
            const nextByApp: Record<string, number> = {};
            let attributedAppBytes = 0;
            if (Array.isArray(res.breakdown)) {
              for (const item of res.breakdown) {
                if (!item || typeof item.bytes !== 'number' || item.bytes <= 0) continue;
                let matchedApp: string | null = null;
                for (const attr of item.attribution ?? []) {
                  matchedApp =
                    extractWowAppIdFromUrl(attr?.url) ?? extractWowAppIdFromUrl(attr?.container?.src);
                  if (matchedApp) break;
                }
                if (matchedApp) {
                  nextByApp[matchedApp] = (nextByApp[matchedApp] ?? 0) + item.bytes;
                  attributedAppBytes += item.bytes;
                }
              }
            }
            const formattedByApp: Record<string, number> = {};
            for (const [k, v] of Object.entries(nextByApp)) {
              formattedByApp[k] = +(v / 1024 ** 2).toFixed(1);
            }
            byAppIdMemMb = formattedByApp;
            shellMemMb = +(Math.max(0, res.bytes - attributedAppBytes) / 1024 ** 2).toFixed(1);
          }
        })
        .catch(() => {})
        .finally(() => {
          memMeasureInFlight = false;
        });
      return;
    }
    if (typeof perf.memory?.usedJSHeapSize === 'number' && perf.memory.usedJSHeapSize >= 0) {
      wowMemBytes = perf.memory.usedJSHeapSize;
      wowMemSource = 'js-heap';
      shellMemMb = +(perf.memory.usedJSHeapSize / 1024 ** 2).toFixed(1);
      byAppIdMemMb = {};
    }
  }

  function startLiveProbes() {
    if (typeof window === 'undefined') return;
    sampleWowMemoryNow();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    if (lagTimer === null) {
      lastLagCheckAt = performance.now();
      lagTimer = window.setInterval(() => {
        const now = performance.now();
        if (typeof document !== 'undefined' && document.hidden) {
          lastLagCheckAt = now;
          return;
        }
        const drift = Math.max(0, now - lastLagCheckAt - 100);
        // 超过 800ms 的单次跳变通常是标签页刚从后台冻结/节流恢复，不计入 CPU 满载
        if (drift < 800) {
          eventLoopLagMs += drift;
        }
        lastLagCheckAt = now;
      }, 100);
    }

    if (typeof PerformanceObserver !== 'undefined') {
      if (!longTaskObserver) {
        try {
          const supported = PerformanceObserver.supportedEntryTypes ?? [];
          const entryType = supported.includes('long-animation-frame')
            ? 'long-animation-frame'
            : supported.includes('longtask')
              ? 'longtask'
              : null;
          if (entryType) {
            longTaskObserver = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                longTaskBusyMs += Math.min(1000, Math.max(0, entry.duration));
              }
            });
            longTaskObserver.observe({ type: entryType, buffered: false });
          }
        } catch {}
      }
      if (!resourceObserver) {
        try {
          resourceObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
              const rx = entry.transferSize > 0 ? entry.transferSize : entry.encodedBodySize || 0;
              if (rx > 0) {
                pendingNetRxBytes += rx;
                const appId = extractWowAppIdFromUrl(entry.name);
                if (appId) {
                  pendingNetByAppBytes[appId] = (pendingNetByAppBytes[appId] ?? 0) + rx;
                }
              }
              if (entry.initiatorType === 'fetch' || entry.initiatorType === 'xmlhttprequest') {
                pendingNetTxBytes += 256;
              }
            }
          });
          resourceObserver.observe({ type: 'resource', buffered: false });
        } catch {}
      }
    }

    if (rafId === null && typeof requestAnimationFrame === 'function') {
      lastRafAt = performance.now();
      const step = (now: number) => {
        const delta = now - lastRafAt;
        lastRafAt = now;
        frameCountInSec += 1;
        if (delta > 20) {
          slowFrameMsInSec += Math.min(250, delta - 16.67);
        }
        rafId = requestAnimationFrame(step);
      };
      rafId = requestAnimationFrame(step);
    }
  }

  function stopLiveProbes() {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    if (lagTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(lagTimer);
      lagTimer = null;
    }
    if (rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    longTaskObserver?.disconnect();
    longTaskObserver = null;
    resourceObserver?.disconnect();
    resourceObserver = null;
  }

  function getLogicalCoreCount(): number {
    const raw =
      report?.cpu.hardwareConcurrency ??
      (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined) ??
      8;
    return Math.max(1, Math.min(32, raw));
  }

  function ensureCores(cores: number) {
    const count = Math.max(1, Math.min(32, cores));
    if (coreHistories.length === count) return;
    coreHistories = Array.from({ length: count }, () => Array(HISTORY_LEN).fill(0));
  }

  ensureCores(getLogicalCoreCount());

  function advanceSeries() {
    ensureCores(getLogicalCoreCount());
    const cores = coreHistories.length;
    const counts = runtimeCounts();
    const activeWorkers = Math.max(0, counts.threadCount - 1);
    procCount = Math.max(1, counts.threadCount);

    // 1. WOW 自身真实 CPU 负载（主线程 LongTask + 事件循环滞后 + 活跃 Worker 算力）
    const mainBusyPct = Math.min(100, Math.round(((longTaskBusyMs + eventLoopLagMs * 1.4) / 1000) * 100));
    longTaskBusyMs = 0;
    eventLoopLagMs = 0;

    let sum = 0;
    coreHistories.forEach((arr, idx) => {
      let val = 0;
      if (idx === 0) {
        val = mainBusyPct;
      } else if (idx <= activeWorkers) {
        val = Math.min(100, Math.max(4, Math.round(mainBusyPct * 0.55 + 12)));
      }
      arr.push(val);
      if (arr.length > HISTORY_LEN) arr.shift();
      sum += val;
    });
    const overallCpu = Math.min(100, Math.round(sum / cores));
    cpuHistory.push(overallCpu);
    if (cpuHistory.length > HISTORY_LEN) cpuHistory.shift();

    // 2. WOW 自身真实内存占用百分比
    if (sampleTick % 2 === 0 || wowMemBytes === null) {
      sampleWowMemoryNow();
    }
    const memLimit = wowMemLimitBytes ?? 4 * 1024 ** 3;
    const memPctNow =
      wowMemBytes !== null && memLimit > 0
        ? Math.min(100, +((wowMemBytes / memLimit) * 100).toFixed(2))
        : 0;
    memHistory.push(memPctNow);
    if (memHistory.length > HISTORY_LEN) memHistory.shift();

    // 3. WOW 自身真实磁盘 I/O（HAL storage 字节计数器 + storage.estimate 增量）
    const io = drainStorageIo();
    let deltaWriteBytes = io.writeBytes;
    const curStorageUsage = liveStorage?.usageBytes ?? report?.storage.usageBytes ?? null;
    if (curStorageUsage !== null) {
      if (lastStorageUsageBytes !== null && curStorageUsage > lastStorageUsageBytes) {
        deltaWriteBytes = Math.max(deltaWriteBytes, curStorageUsage - lastStorageUsageBytes);
      }
      lastStorageUsageBytes = curStorageUsage;
    }
    const readKb = +(io.readBytes / 1024).toFixed(1);
    const writeKb = +(deltaWriteBytes / 1024).toFixed(1);
    const diskActNext =
      readKb + writeKb <= 0 ? 0 : Math.min(100, Math.max(1, Math.round(((readKb + writeKb) / 2048) * 100)));
    diskActiveHistory.push(diskActNext);
    if (diskActiveHistory.length > HISTORY_LEN) diskActiveHistory.shift();
    diskReadHistory.push(readKb);
    if (diskReadHistory.length > HISTORY_LEN) diskReadHistory.shift();
    diskWriteHistory.push(writeKb);
    if (diskWriteHistory.length > HISTORY_LEN) diskWriteHistory.shift();
    diskRateHistory.push(Math.max(readKb, writeKb));
    if (diskRateHistory.length > HISTORY_LEN) diskRateHistory.shift();

    // 4. WOW 自身真实网络吞吐（PerformanceObserver resource 真实字节）
    const isNetOnline = typeof navigator !== 'undefined' ? navigator.onLine : report?.network.onLine ?? true;
    const rxKbps = isNetOnline ? +((pendingNetRxBytes * 8) / 1000).toFixed(1) : 0;
    const txKbps = isNetOnline ? +((pendingNetTxBytes * 8) / 1000).toFixed(1) : 0;
    if (isNetOnline) {
      recvBytesTotal += pendingNetRxBytes;
      sentBytesTotal += pendingNetTxBytes;
    }
    pendingNetRxBytes = 0;
    pendingNetTxBytes = 0;
    const nextNetByApp: Record<string, number> = {};
    if (isNetOnline) {
      for (const [appId, bytes] of Object.entries(pendingNetByAppBytes)) {
        nextNetByApp[appId] = +((bytes * 8) / 1_000_000).toFixed(2);
      }
    }
    byAppIdNetMbps = nextNetByApp;
    pendingNetByAppBytes = {};
    wifiRxHistory.push(rxKbps);
    if (wifiRxHistory.length > HISTORY_LEN) wifiRxHistory.shift();
    wifiTxHistory.push(txKbps);
    if (wifiTxHistory.length > HISTORY_LEN) wifiTxHistory.shift();

    // 5. WOW 自身渲染 / GPU 活跃度（基于 rAF 帧耗时与活跃游戏/画布渲染负载）
    const activeCanvases =
      typeof document !== 'undefined' ? document.querySelectorAll('canvas, iframe.w11-win-iframe').length : 0;
    const renderPressure =
      frameCountInSec > 0 ? Math.min(100, Math.round((slowFrameMsInSec / 1000) * 100)) : 0;
    const gpu3dNow =
      activeCanvases > 0
        ? Math.min(100, Math.max(renderPressure, activeWorkers > 0 ? 6 + Math.min(30, activeWorkers * 5) : 1))
        : renderPressure;
    frameCountInSec = 0;
    slowFrameMsInSec = 0;

    gpu3dHistory.push(gpu3dNow);
    if (gpu3dHistory.length > HISTORY_LEN) gpu3dHistory.shift();
    gpuCopyHistory.push(diskActNext > 0 ? Math.min(25, Math.round(diskActNext * 0.4)) : 0);
    if (gpuCopyHistory.length > HISTORY_LEN) gpuCopyHistory.shift();
    gpuEncHistory.push(0);
    if (gpuEncHistory.length > HISTORY_LEN) gpuEncHistory.shift();
    gpuDecHistory.push(0);
    if (gpuDecHistory.length > HISTORY_LEN) gpuDecHistory.shift();
    gpuZeroHistory.push(0);
    if (gpuZeroHistory.length > HISTORY_LEN) gpuZeroHistory.shift();

    const gpuMemPct = Math.min(100, +(memPctNow * 0.45).toFixed(1));
    gpuMemHistory.push(gpuMemPct);
    if (gpuMemHistory.length > HISTORY_LEN) gpuMemHistory.shift();
    gpuDedicatedMemHistory.push(gpuMemPct);
    if (gpuDedicatedMemHistory.length > HISTORY_LEN) gpuDedicatedMemHistory.shift();

    npuHistory.push(0);
    if (npuHistory.length > HISTORY_LEN) npuHistory.shift();
    npuMemHistory.push(0);
    if (npuMemHistory.length > HISTORY_LEN) npuMemHistory.shift();
  }

  function buildSnapshot(): VirtualHardwareSnapshot {
    const hp = report?.hardwareProfile;
    const logicalCores = getLogicalCoreCount();
    ensureCores(logicalCores);

    const archCode = resolveCpuArchitectureLabel(report);
    const osNameEst = extractEstimationValue(hp?.device.osName);
    const osVerEst = extractEstimationValue(hp?.device.osVersion);
    const formEst = extractEstimationValue(hp?.device.formFactor);
    const fallbackOs =
      typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
        ? 'macOS'
        : typeof navigator !== 'undefined' && /linux/i.test(navigator.platform)
          ? 'Linux'
          : 'Windows';

    // CPU
    const brandEst = extractEstimationValue(hp?.cpu.winBrandString);
    const modelEst = extractEstimationValue(hp?.cpu.model);
    const vendorEst = extractEstimationValue(hp?.cpu.vendor);
    const skuEst = extractEstimationValue(hp?.cpu.skuCandidates);
    const physEst = extractEstimationValue(hp?.cpu.physicalCores);
    const baseClkEst = extractEstimationValue(hp?.cpu.baseClockGHz);
    const cache = pickConsensusCache(hp?.cpu.cache, skuEst.value ?? undefined);
    const execEnv = hp?.meta.executionEnvironment;
    const isVmFallback = execEnv === 'virtual_or_emulated';
    const identity = brandEst.value ? brandEst : modelEst;
    const fallbackModel = ['WinOnWeb', archCode, 'Virtual CPU'].filter(Boolean).join(' ');
    const cpuDisplay: VirtualHardwareValue<string> = identity.value
      ? {
          value: identity.value,
          provenance: identity.provenance,
          tooltip: identity.provenance === 'inferred' ? '由硬件识别层根据设备信号推断' : undefined,
        }
      : {
          value: fallbackModel,
          provenance: 'simulated',
        };

    const detectedBase = baseClkEst.value ?? skuEst.value?.baseClockGHz ?? extractBrandClockGhz(hp);
    const boostClock = skuEst.value?.boostClockGHz ?? null;
    const cpuNow = cpuHistory[cpuHistory.length - 1] ?? 6;

    // The guest exposes one CPU package. When the SKU has no nominal clock,
    // use the virtual CPU default, capped at the known SKU maximum.
    const baseClock = detectedBase ?? Math.min(2.8, boostClock ?? Infinity);
    const floorClock = baseClock * 0.86;
    const ceilingClock = Math.max(baseClock, boostClock ?? baseClock);
    const currentClock = floorClock + (ceilingClock - floorClock) * Math.min(1, Math.max(0, cpuNow / 100));

    // Memory (WOW 运行时实测内存，不模拟宿主机内存)
    const memEst = extractEstimationValue(hp?.memory.browserDeviceMemoryGiB);
    const realDeviceGb =
      report && typeof report.memory.deviceMemoryGiB === 'number'
        ? report.memory.deviceMemoryGiB
        : memEst.provenance === 'real' && typeof memEst.value === 'number'
          ? memEst.value
          : null;
    const capped = memEst.provenance === 'real' ? Boolean(memEst.capped) : realDeviceGb === 8;
    const totalGb = wowMemLimitBytes ? +(wowMemLimitBytes / 1024 ** 3).toFixed(1) : 4.0;
    const usableGb = totalGb;
    const capText = Number.isInteger(totalGb) ? `${totalGb}.0 GB` : `${totalGb} GB`;
    const capTip =
      wowMemSource === 'ua-specific'
        ? `WOW 运行时实测内存（measureUserAgentSpecificMemory，含桌面、同源应用与 Worker，配额上限 ${capText}）`
        : wowMemSource === 'js-heap'
          ? `WOW 运行时实测内存（JS Heap，配额上限 ${capText}）`
          : `WOW 运行时配额上限 ${capText}（正在采样中）`;
    const usedGb = wowMemBytes !== null ? +(wowMemBytes / 1024 ** 3).toFixed(4) : 0;
    const memPct = Math.min(100, Math.round((usedGb / Math.max(0.1, usableGb)) * 100));
    const availGb = +Math.max(0, usableGb - usedGb).toFixed(2);
    const compressedMb = 0;
    const cachedText = '0 MB';
    const availableMb = Math.round(availGb * 1024);
    const modifiedMb = 0;
    const standbyMb = 0;
    const freeMb = availableMb;
    const standbyPct = 0;
    const commitLimitGb = usableGb;
    const committedGb =
      wowMemCommittedBytes !== null
        ? +(Math.max(wowMemBytes ?? 0, wowMemCommittedBytes) / 1024 ** 3).toFixed(4)
        : usedGb;
    const pagedPoolMb = 0;
    const nonPagedPoolMb = 0;
    const memSpecEst = extractEstimationValue(hp?.memory.spec);

    // GPU
    const rawGpuName = report?.gpu.webglRenderer ? cleanGpuName(report.gpu.webglRenderer) : '';
    const gpuNameEst = extractEstimationValue(hp?.gpu.name);
    const gpuVendorEst = extractEstimationValue(hp?.gpu.vendor);
    const gpuArchEst = extractEstimationValue(hp?.gpu.architecture);
    const gpuPciEst = extractEstimationValue(hp?.gpu.pciDeviceIdHex);
    const gpuEnvEst = extractEstimationValue(hp?.gpu.environment);
    const isSoftwareRenderer =
      execEnv === 'virtual_or_emulated' ||
      /^Microsoft Basic Render Driver$/i.test(rawGpuName) ||
      /swiftshader|llvmpipe/i.test(rawGpuName) ||
      gpuEnvEst.value === 'software_emulated';

    let gpuName = 'GPU 型号未知';
    let gpuProvenance: VirtualHardwareProvenance = 'unknown';
    let gpuTooltip: string | undefined;

    if (rawGpuName && !/^Microsoft Basic Render Driver$/i.test(rawGpuName)) {
      gpuName = rawGpuName;
      gpuProvenance = 'real';
      if (gpuPciEst.value && gpuPciEst.provenance === 'real') {
        gpuTooltip = `PCI ID: ${gpuPciEst.value}${gpuArchEst.value ? ` · ${gpuArchEst.value}` : ''}`;
      }
    } else if (gpuNameEst.value) {
      gpuName = gpuNameEst.value;
      gpuProvenance = gpuNameEst.provenance;
      gpuTooltip = '静态硬件指纹库推理';
    } else if (rawGpuName) {
      gpuName = rawGpuName;
      gpuProvenance = 'real';
      gpuTooltip = '软件渲染或基础驱动';
    }

    const resolvedGpuVendor = gpuVendorEst.value ?? inferGpuVendorFromText(gpuName, report?.gpu.webglVendor);
    const dedicatedTotalGb = inferDiscreteVramGb(gpuName, gpuEnvEst.value ?? undefined, resolvedGpuVendor);
    const dedPctNow = gpuDedicatedMemHistory[gpuDedicatedMemHistory.length - 1] ?? 14.2;
    const dedicatedUsedGb = dedicatedTotalGb !== undefined ? +(dedicatedTotalGb * (dedPctNow / 100)).toFixed(1) : undefined;
    const gpuNow = gpu3dHistory[gpu3dHistory.length - 1] ?? 18;
    const renderer = report?.gpu.webglRenderer ?? '';
    const driverVersion = renderer.match(/\b(?:Mesa|driver version)\s+([\d.]+)/i)?.[1];
    const direct3d = renderer.match(/\b(?:Direct3D|D3D)\s*(9|10|11|12)\b/i)?.[1];
    const sharedTotalGb = usableGb / 2;
    const memUtilPct = gpuMemHistory[gpuMemHistory.length - 1] ?? 7.4;
    const primaryGpu: VirtualHardwareGpuInfo = {
      id: 'gpu-0',
      index: 0,
      name: gpuName,
      vendor: resolvedGpuVendor,
      architecture: gpuArchEst.value ?? undefined,
      pciDeviceIdHex: gpuPciEst.value ?? undefined,
      environment: gpuEnvEst.value ?? undefined,
      isSoftwareRenderer,
      webglVersion: report?.gpu.webglVersion,
      driverVersion,
      directXVersion: direct3d && `Direct3D ${direct3d}`,
      sharedTotalGb,
      sharedUsedGb: sharedTotalGb * memUtilPct / 100,
      dedicatedTotalGb,
      dedicatedUsedGb,
      dedicatedMemPts: dedicatedTotalGb !== undefined ? [...gpuDedicatedMemHistory] : undefined,
      usagePct: gpuNow,
      ptsCompute: gpuCopyHistory.map((v, i) => Math.round(v * 0.6 + gpu3dHistory[i] * 0.25)),
      ptsPriority3d: gpu3dHistory.map(v => Math.round(v * 0.35)),
      pts3d: [...gpu3dHistory],
      ptsCopy: [...gpuCopyHistory],
      ptsEnc: [...gpuEncHistory],
      ptsDec: [...gpuDecHistory],
      zeroHistory: [...gpuZeroHistory],
      memUtilPct,
      memPts: [...gpuMemHistory],
      provenance: gpuProvenance,
      tooltip: gpuTooltip,
    };

    const gpus = [primaryGpu];

    // NPU
    const npuEst = extractEstimationValue(hp?.npu.hardware);
    const webnnEst = extractEstimationValue(hp?.npu.webnnNpuSupported);
    const webnnNote =
      webnnEst.provenance === 'real' && webnnEst.value !== null
        ? ` · WebNN NPU: ${webnnEst.value ? '已就绪' : '未就绪'}`
        : '';

    let npu: VirtualHardwareNpuInfo | null = null;
    if (npuEst.value) {
      const npuSpec = npuEst.value;
      const topsText = typeof npuSpec.topsPeak === 'number' ? ` (${npuSpec.topsPeak} TOPS)` : '';
      const tip = `静态硬件指纹库推理${topsText}${webnnNote}`;
      const display = npuSpec.winDisplayName
        ? npuSpec.winDisplayName
        : modelEst.value
          ? `${modelEst.value} - ${npuSpec.name}`
          : npuSpec.name;
      npu = {
        name: npuSpec.name,
        displayName: display,
        sidebarName: npuSpec.winDisplayName || npuSpec.name,
        vendor: npuSpec.vendor,
        topsPeak: npuSpec.topsPeak,
        webnnSupported: webnnEst.value ?? undefined,
        usagePct: npuHistory[npuHistory.length - 1] ?? 0,
        history: [...npuHistory],
        memHistory: [...npuMemHistory],
        provenance: 'inferred',
        tooltip: tip,
      };
    } else if (webnnEst.provenance === 'real' && webnnEst.value === true) {
      npu = {
        name: 'WebNN NPU',
        displayName: 'WebNN NPU',
        sidebarName: 'WebNN NPU',
        vendor: 'WebNN',
        webnnSupported: true,
        usagePct: npuHistory[npuHistory.length - 1] ?? 0,
        history: [...npuHistory],
        memHistory: [...npuMemHistory],
        provenance: 'real',
        tooltip: '通过 navigator.ml.createContext({ deviceType: "npu" }) 实测支持',
      };
    }

    // Storage
    const diskAct = diskActiveHistory[diskActiveHistory.length - 1] ?? 0;
    const diskReadKbNow = diskReadHistory[diskReadHistory.length - 1] ?? 0;
    const diskWriteKbNow = diskWriteHistory[diskWriteHistory.length - 1] ?? 0;
    const diskRespMs = diskAct === 0 && diskReadKbNow === 0 && diskWriteKbNow === 0
      ? 0
      : +(0.1 + diskAct * 0.05 + (diskReadKbNow + diskWriteKbNow > 0 ? 0.1 : 0)).toFixed(1);

    // Network
    const netOnLine = typeof navigator !== 'undefined' ? navigator.onLine : report?.network.onLine ?? true;
    const conn = report?.network.connection;
    const connObj = typeof conn === 'object' && conn !== null ? conn : null;
    const isWifiReal = connObj?.type === 'wifi';
    const interfaceNames: Record<string, string> = { ethernet: '以太网', wifi: 'Wi-Fi', cellular: '移动网络', bluetooth: '蓝牙网络' };
    const interfaceName = interfaceNames[connObj?.type ?? ''] ?? '网络';
    const netHwEst = extractEstimationValue(hp?.network.hardwareName);
    const rxNow = netOnLine ? (wifiRxHistory[wifiRxHistory.length - 1] ?? 0) : 0;
    const txNow = netOnLine ? (wifiTxHistory[wifiTxHistory.length - 1] ?? 0) : 0;

    const storageProbe = liveStorage ?? report?.storage ?? null;
    const fixedQuota = resolveFixedQuotaBytes(storageProbe);
    const opfsDisk = storageProbe?.opfsSupported !== false;
    return {
      timestamp: report?.timestamp ?? new Date().toLocaleString(),
      probed: Boolean(report),
      system: {
        osName: {
          value: osNameEst.value ?? fallbackOs,
          provenance: osNameEst.value ? osNameEst.provenance : 'simulated',
        },
        osVersion: osVerEst.value ?? '',
        architecture: {
          value: archCode || '未知',
          provenance: archCode ? 'real' : 'unknown',
        },
        formFactor: formEst.value ?? 'unknown',
      },
      cpu: {
        displayName: cpuDisplay,
        shortName: shortenCpuName(cpuDisplay.value),
        vendor: vendorEst.value ?? 'Generic',
        architecture: archCode || '未知',
        logicalCores,
        physicalCores: {
          value: physEst.value,
          provenance: physEst.provenance,
        },
        isVmFallback,
        baseClockGhz: {
          value: baseClock,
          provenance: baseClkEst.value !== null ? baseClkEst.provenance : detectedBase !== null ? 'inferred' : 'simulated',
        },
        socketCount: 1,
        uptimeSeconds: Math.floor(performance.now() / 1000),
        currentClockGhz: currentClock,
        boostClockGhz: boostClock,
        cache,
        usagePct: cpuNow,
        history: [...cpuHistory],
        kernelHistory: cpuHistory.map(v => Math.round(v * 0.32)),
        kernelCoreHistories: coreHistories.map(history => history.map(v => Math.round(v * 0.3))),
        coreHistories: coreHistories.map((arr) => [...arr]),
        procCount,
        ...runtimeCounts(),
      },
      memory: {
        totalGb,
        usableGb,
        usedGb,
        availGb,
        usagePct: memPct,
        history: [...memHistory],
        realDeviceGb,
        capped,
        hardwareReservedMb: (totalGb - usableGb) * 1024,
        capText,
        capTip,
        modifiedMb,
        standbyMb,
        freeMb,
        compressionSavedMb: Math.round(compressedMb * 1.33),
        compressedMb,
        cachedText,
        standbyPct,
        committedGb,
        commitLimitGb,
        pagedPoolMb,
        nonPagedPoolMb,
        spec: memSpecEst.value ?? undefined,
        specProvenance: memSpecEst.value ? memSpecEst.provenance : 'simulated',
      },
      gpus,
      npu,
      storage: {
        model: opfsDisk ? 'Origin Private File System' : 'Browser Storage',
        type: opfsDisk ? 'OPFS' : 'Virtual',
        capacityBytes: fixedQuota ?? storageProbe?.quotaBytes ?? 128 * 1024 ** 3,
        isSystemDisk: true,
        hasPagefile: false,
        probe: storageProbe,
        fixedQuotaBytes: fixedQuota,
        activePct: diskAct,
        responseTimeMs: diskRespMs,
        activeHistory: [...diskActiveHistory],
        rateHistory: [...diskRateHistory],
        readHistory: [...diskReadHistory],
        writeHistory: [...diskWriteHistory],
        readKb: diskReadKbNow,
        writeKb: diskWriteKbNow,
      },
      network: {
        onLine: netOnLine,
        isWifiReal,
        interfaceName,
        adapterName: {
          value: netHwEst.value ?? (interfaceName + '适配器'),
          provenance: netHwEst.value ? netHwEst.provenance : 'simulated',
          unknownReason: netHwEst.unknownReason,
        },
        connectionType: connObj?.type,
        effectiveType: connObj?.effectiveType,
        downlinkMbps: connObj?.downlinkMbps,
        rttMs: connObj?.rttMs,
        saveData: connObj?.saveData,
        rxHistory: netOnLine ? [...wifiRxHistory] : Array(HISTORY_LEN).fill(0),
        txHistory: netOnLine ? [...wifiTxHistory] : Array(HISTORY_LEN).fill(0),
        sendKbps: txNow,
        recvKbps: rxNow,
        sentBytesTotal,
        recvBytesTotal,
      },
      display: report?.display ?? null,
      battery: report?.battery ?? null,
      peripheralsAndApis: report?.peripheralsAndApis ?? null,
      processMetrics: {
        shellMemMb,
        byAppIdMemMb: { ...byAppIdMemMb },
        byAppIdNetMbps: { ...byAppIdNetMbps },
        byPid: { ...(runtimeCounts().byPid ?? {}) },
      },
    };
  }

  function notifySubscribers() {
    if (subscribers.size === 0) return;
    const snap = buildSnapshot();
    subscribers.forEach((fn) => fn(snap));
  }

  function ensureTicker() {
    if (tickTimer !== null || subscribers.size === 0) return;
    if (typeof window === 'undefined') return;
    startLiveProbes();
    tickTimer = window.setInterval(() => {
      sampleTick += 1;
      advanceSeries();
      notifySubscribers();
      if (sampleTick % 4 === 0) {
        void refreshStorage();
      }
    }, 1000);
  }

  function stopTickerIfIdle() {
    if (subscribers.size > 0 || tickTimer === null) return;
    if (typeof window !== 'undefined') {
      window.clearInterval(tickTimer);
    }
    tickTimer = null;
    stopLiveProbes();
  }

  async function refreshProbe(force = false): Promise<VirtualHardwareSnapshot> {
    if (probeInFlight && !force) {
      await probeInFlight;
      return buildSnapshot();
    }
    const task = collectDeviceHardwareReport({ confidentSingle: true })
      .then((next) => {
        report = next;
        liveStorage = next.storage;
        ensureCores(getLogicalCoreCount());
        notifySubscribers();
        return next;
      })
      .finally(() => {
        if (probeInFlight === task) {
          probeInFlight = null;
        }
      });
    probeInFlight = task;
    await task;
    return buildSnapshot();
  }

  async function refreshStorage(): Promise<StorageProbeInfo> {
    if (storageInFlight && liveStorage) return liveStorage;
    storageInFlight = true;
    try {
      const next = await collectStorageProbeInfo();
      liveStorage = next;
      if (report) {
        report = { ...report, storage: next };
      }
      notifySubscribers();
      return next;
    } finally {
      storageInFlight = false;
    }
  }

  function subscribe(listener: (snap: VirtualHardwareSnapshot) => void): () => void {
    subscribers.add(listener);
    ensureTicker();
    return () => {
      subscribers.delete(listener);
      stopTickerIfIdle();
    };
  }

  return {
    getSnapshot: buildSnapshot,
    getProbeReport: () => report,
    refreshProbe,
    refreshStorage,
    subscribe,
    tick: () => {
      sampleTick += 1;
      advanceSeries();
      notifySubscribers();
    },
    destroy: () => {
      subscribers.clear();
      stopTickerIfIdle();
    },
  };
}

export type VirtualHardwareService = ReturnType<typeof createVirtualHardwareService>;
