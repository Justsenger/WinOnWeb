import type { CpuCacheSpec, CpuSkuSpec, FieldEstimation, HardwareProfile, MemorySpec, UnknownReason } from 'hw-profiler';
import {
  collectDeviceHardwareReport,
  collectStorageProbeInfo,
  type DeviceProbeReport,
  type StorageProbeInfo,
} from './device-probe';
import legacySuspectCacheBackfillRaw from './legacy-cache-backfill.json';

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

  const prov = sku?.cacheProvenance;
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

export function createVirtualHardwareService(runtimeCounts: () => { threadCount: number; handleCount: number }) {
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

  let coreHistories: number[][] = [
    [12, 14, 17, 19, 17, 12, 9, 15, 12, 9, 14, 21, 25, 20, 20, 16, 17, 17, 20, 20, 17, 13, 19, 19, 24, 32, 27, 34, 20, 17, 17, 15, 18, 26, 20, 20, 16, 14, 42, 40, 31, 26, 22, 16, 15, 13, 13, 13, 12, 10, 15, 21, 99, 84, 40, 30, 20, 26, 40, 40],
    [13, 12, 10, 10, 7, 9, 12, 14, 14, 12, 21, 22, 21, 14, 13, 15, 21, 31, 16, 15, 9, 7, 11, 13, 21, 36, 40, 47, 24, 25, 26, 20, 26, 34, 20, 21, 20, 20, 45, 40, 21, 18, 15, 15, 20, 21, 19, 16, 13, 17, 16, 40, 60, 56, 50, 32, 20, 31, 50, 40],
    [10, 7, 9, 9, 9, 11, 10, 7, 5, 7, 9, 21, 23, 7, 10, 11, 21, 24, 12, 13, 6, 10, 9, 9, 27, 32, 41, 40, 17, 20, 18, 12, 17, 22, 22, 24, 24, 19, 40, 21, 32, 24, 12, 13, 18, 17, 17, 9, 5, 9, 12, 23, 100, 79, 50, 24, 13, 30, 53, 40],
    [21, 10, 10, 15, 10, 20, 22, 16, 9, 9, 6, 12, 24, 9, 11, 9, 8, 10, 9, 11, 8, 9, 17, 17, 12, 30, 40, 41, 25, 24, 23, 20, 18, 26, 22, 20, 18, 25, 50, 50, 23, 18, 15, 9, 12, 12, 19, 16, 15, 9, 12, 60, 100, 84, 53, 40, 20, 17, 50, 40],
    [11, 12, 12, 13, 4, 7, 11, 9, 8, 20, 25, 20, 15, 6, 7, 6, 6, 16, 12, 21, 11, 20, 25, 31, 42, 50, 31, 24, 30, 23, 30, 21, 12, 13, 13, 17, 14, 11, 17, 16, 22, 21, 20, 23, 20, 16, 17, 14, 14, 11, 23, 21, 60, 45, 25, 21, 21, 32, 32, 21],
    [24, 30, 30, 20, 26, 30, 16, 18, 20, 15, 33, 37, 32, 27, 33, 25, 31, 32, 30, 24, 22, 30, 30, 31, 31, 30, 31, 24, 26, 32, 30, 40, 39, 38, 39, 36, 40, 49, 39, 30, 40, 41, 32, 33, 42, 40, 33, 30, 26, 30, 28, 30, 81, 60, 42, 35, 31, 36, 36, 33],
    [12, 10, 7, 6, 12, 13, 12, 10, 11, 12, 11, 14, 17, 20, 14, 12, 20, 21, 12, 13, 16, 20, 17, 17, 13, 14, 16, 16, 13, 10, 9, 14, 17, 15, 21, 30, 34, 31, 57, 56, 50, 20, 21, 20, 15, 22, 21, 18, 16, 15, 20, 60, 100, 70, 43, 40, 20, 23, 31, 30],
    [17, 12, 15, 17, 11, 6, 7, 10, 9, 12, 11, 12, 12, 7, 5, 6, 7, 9, 12, 12, 21, 26, 20, 20, 20, 15, 12, 14, 12, 13, 20, 9, 17, 13, 9, 6, 11, 12, 28, 23, 33, 20, 18, 18, 20, 20, 30, 22, 20, 16, 17, 60, 99, 71, 31, 20, 15, 20, 20, 8],
    [20, 26, 30, 20, 20, 20, 9, 7, 5, 7, 11, 9, 10, 11, 11, 9, 11, 15, 20, 16, 14, 11, 13, 20, 25, 30, 30, 39, 30, 30, 25, 14, 17, 20, 9, 7, 10, 11, 11, 11, 24, 21, 18, 16, 13, 16, 15, 14, 16, 30, 30, 30, 80, 70, 37, 30, 24, 31, 37, 37],
    [26, 20, 21, 31, 32, 24, 22, 18, 12, 11, 16, 30, 32, 20, 20, 20, 16, 20, 16, 17, 17, 20, 20, 20, 21, 23, 20, 25, 22, 20, 20, 30, 39, 43, 42, 46, 43, 35, 59, 32, 39, 33, 20, 20, 17, 16, 21, 20, 24, 20, 20, 61, 98, 72, 30, 22, 20, 35, 39, 30],
    [20, 25, 24, 13, 20, 30, 33, 36, 39, 35, 39, 41, 32, 34, 31, 21, 20, 20, 20, 20, 28, 31, 25, 22, 20, 20, 14, 11, 10, 10, 11, 7, 10, 11, 11, 10, 11, 6, 9, 26, 34, 30, 22, 25, 22, 25, 30, 30, 24, 30, 30, 60, 100, 71, 33, 31, 32, 39, 34, 25],
    [4, 6, 11, 5, 6, 11, 13, 12, 7, 8, 12, 11, 11, 7, 15, 21, 30, 30, 30, 30, 26, 26, 30, 34, 27, 21, 30, 20, 9, 9, 9, 16, 16, 13, 11, 10, 17, 10, 39, 36, 39, 20, 16, 16, 14, 20, 26, 22, 20, 20, 16, 50, 80, 73, 60, 20, 16, 16, 20, 14],
  ];
  const cpuHistory: number[] = [11.1, 11.1, 11.1, 11.1, 11.1, 11.1, 11.1, 11.1, 6.2, 11.1, 13.6, 13.6, 11.1, 11.1, 8.6, 11.1, 11.1, 13.6, 16.0, 8.6, 13.6, 13.6, 18.5, 16.0, 18.5, 23.5, 23.5, 13.6, 13.6, 13.6, 13.6, 13.6, 16.0, 16.0, 13.6, 16.0, 13.6, 11.1, 18.5, 23.5, 21.0, 23.5, 16.0, 13.6, 13.6, 13.6, 16.0, 16.0, 13.6, 13.6, 13.6, 13.6, 16.0, 23.5, 23.5, 28.4, 13.6, 18.5, 23.5, 30];
  let procCount = 359;
  const memHistory: number[] = Array.from({ length: HISTORY_LEN }, (_, i) =>
    +(25.0 + Math.sin(i / 10) * 0.25 + ((i % 5) - 2) * 0.05).toFixed(1),
  );
  const diskActiveHistory: number[] = [0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 4, 2, 1, 2, 3, 1, 0, 0, 3, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0];
  const diskReadHistory: number[] = [0, 0, 0, 0, 12, 68, 8, 0, 0, 0, 0, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 18, 26, 94, 42, 10, 0, 16, 4, 0, 0, 56, 0, 0, 0, 0, 0, 0, 12, 8, 0, 0, 0, 0, 0, 0];
  const diskWriteHistory: number[] = [18, 0, 0, 0, 0, 24, 0, 0, 0, 0, 0, 8, 22, 10, 0, 0, 0, 0, 0, 0, 14, 28, 36, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 22, 16, 52, 24, 8, 26, 38, 12, 0, 0, 42, 0, 0, 0, 0, 0, 0, 16, 10, 0, 0, 0, 0, 0, 0];
  const diskRateHistory: number[] = diskReadHistory.map((v, i) => Math.max(v, diskWriteHistory[i] ?? 0));
  const wifiRxHistory: number[] = [12.4, 8.2, 4.0, 0, 0, 6.5, 2.0, 0, 0, 14.8, 32.5, 18.2, 6.0, 0, 0, 0, 4.2, 12.6, 8.4, 0, 0, 2.5, 16.4, 8.0, 0, 0, 0, 4.5, 18.2, 38.6, 22.4, 6.0, 0, 0, 44.2, 28.5, 8.2, 0, 0, 12.0, 8.5, 16.4, 10.2, 0, 0, 4.0, 0, 18.6, 24.2, 6.4, 0, 0, 14.2, 48.0, 21.5, 6.2, 0, 16.8, 8.4, 0];
  const wifiTxHistory: number[] = [6.2, 3.0, 1.5, 0, 0, 4.0, 1.0, 0, 0, 8.2, 14.0, 9.5, 2.0, 0, 0, 0, 2.0, 5.4, 3.2, 0, 0, 1.0, 7.2, 3.5, 0, 0, 0, 2.0, 9.1, 18.4, 10.2, 2.4, 0, 0, 19.6, 12.0, 3.5, 0, 0, 5.5, 3.2, 7.8, 4.6, 0, 0, 2.0, 0, 8.4, 11.2, 2.5, 0, 0, 6.1, 21.4, 9.6, 2.4, 0, 7.2, 3.8, 0];
  let sentBytesTotal = 0;
  let recvBytesTotal = 0;
  const npuHistory: number[] = Array(HISTORY_LEN).fill(0);
  const npuMemHistory: number[] = Array(HISTORY_LEN).fill(0);
  const gpu3dHistory: number[] = [18.7, 14.3, 7.7, 1.1, 3.3, 7.7, 1.1, 3.3, 5.5, 16.5, 14.3, 12.1, 7.7, 5.5, 5.5, 5.5, 12.1, 7.7, 3.3, 7.7, 7.7, 7.7, 7.7, 9.9, 16.5, 7.7, 20.9, 9.9, 3.3, 3.3, 3.3, 9.9, 16.5, 18.7, 20.9, 14.3, 9.9, 7.7, 9.9, 7.7, 12.1, 7.7, 7.7, 7.7, 7.7, 7.7, 7.7, 7.7, 7.7, 7.7, 7.7, 12.1, 58.2, 40.7, 25.3, 5.5, 12.1, 34.1, 18.7, 7];
  const gpuCopyHistory: number[] = seedSpikyHistory(3, 8, 0.12);
  const gpuEncHistory: number[] = Array(HISTORY_LEN).fill(0);
  const gpuDecHistory: number[] = seedSpikyHistory(5, 14, 0.15);
  const gpuZeroHistory: number[] = Array(HISTORY_LEN).fill(0);
  const gpuMemHistory: number[] = Array.from({ length: HISTORY_LEN }, (_, i) => +(7.2 + Math.sin(i / 14) * 0.6).toFixed(1));
  const gpuDedicatedMemHistory: number[] = Array.from({ length: HISTORY_LEN }, (_, i) => +(14.2 + Math.sin(i / 12) * 0.8).toFixed(1));

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
    coreHistories = Array.from({ length: count }, (_, idx) => {
      if (idx < Math.ceil(count * 0.42)) return seedSpikyHistory(16, 48, 0.24);
      if (idx < Math.ceil(count * 0.67)) return seedSpikyHistory(6, 36, 0.16);
      return seedSpikyHistory(2, 26, 0.09);
    });
  }

  ensureCores(getLogicalCoreCount());

  function advanceSeries() {
    ensureCores(getLogicalCoreCount());
    const cores = coreHistories.length;
    let sum = 0;

    coreHistories.forEach((arr, idx) => {
      const prev = arr[arr.length - 1] ?? 6;
      let target: number;
      if (idx < Math.ceil(cores * 0.42)) {
        target = Math.random() < 0.24 ? 26 + Math.random() * 44 : 5 + Math.random() * 18;
      } else if (idx < Math.ceil(cores * 0.67)) {
        target = Math.random() < 0.16 ? 18 + Math.random() * 34 : 2 + Math.random() * 9;
      } else {
        target = Math.random() < 0.1 ? 10 + Math.random() * 26 : 1 + Math.random() * 3;
      }
      const next = Math.max(1, Math.min(95, Math.round(prev * 0.22 + target * 0.78)));
      arr.push(next);
      if (arr.length > HISTORY_LEN) arr.shift();
      sum += next;
    });

    cpuHistory.push(Math.round(sum / coreHistories.length));
    if (cpuHistory.length > HISTORY_LEN) cpuHistory.shift();

    procCount = Math.max(350, Math.min(368, procCount + Math.round((Math.random() - 0.5) * 2)));

    const memPrev = memHistory[memHistory.length - 1] ?? 25.0;
    const memPull = (25.0 - memPrev) * 0.08;
    const memNext = Math.max(22, Math.min(28, +(memPrev + memPull + (Math.random() - 0.5) * 0.18).toFixed(1)));
    memHistory.push(memNext);
    if (memHistory.length > HISTORY_LEN) memHistory.shift();

    const diskSpike = Math.random() < 0.14;
    const diskActNext = diskSpike ? Math.round(2 + Math.random() * 14) : (Math.random() < 0.25 ? 1 : 0);
    diskActiveHistory.push(diskActNext);
    if (diskActiveHistory.length > HISTORY_LEN) diskActiveHistory.shift();

    const readNext = diskSpike
      ? +(12 + Math.random() * 110).toFixed(1)
      : diskActNext > 0
        ? +(4 + Math.random() * 22).toFixed(1)
        : (Math.random() < 0.2 ? +(1.2 + Math.random() * 8).toFixed(1) : 0);
    const writeNext = diskSpike
      ? +(18 + Math.random() * 140).toFixed(1)
      : diskActNext > 0
        ? +(6 + Math.random() * 28).toFixed(1)
        : (Math.random() < 0.25 ? +(1.5 + Math.random() * 12).toFixed(1) : 0);
    diskReadHistory.push(readNext);
    if (diskReadHistory.length > HISTORY_LEN) diskReadHistory.shift();
    diskWriteHistory.push(writeNext);
    if (diskWriteHistory.length > HISTORY_LEN) diskWriteHistory.shift();
    diskRateHistory.push(Math.max(readNext, writeNext));
    if (diskRateHistory.length > HISTORY_LEN) diskRateHistory.shift();

    const isNetOnline = typeof navigator !== 'undefined' ? navigator.onLine : report?.network.onLine ?? true;
    const netSpike = isNetOnline && Math.random() < 0.16;
    const rxNext = !isNetOnline
      ? 0
      : netSpike
        ? +(18 + Math.random() * 54).toFixed(1)
        : (Math.random() < 0.45 ? +(1.2 + Math.random() * 14).toFixed(1) : 0);
    const txNext = !isNetOnline
      ? 0
      : netSpike
        ? +(8 + Math.random() * 26).toFixed(1)
        : (rxNext > 0 ? +(rxNext * (0.3 + Math.random() * 0.28)).toFixed(1) : 0);
    wifiRxHistory.push(rxNext);
    if (wifiRxHistory.length > HISTORY_LEN) wifiRxHistory.shift();
    wifiTxHistory.push(txNext);
    if (wifiTxHistory.length > HISTORY_LEN) wifiTxHistory.shift();
    if (typeof navigator === 'undefined' || navigator.onLine) {
      sentBytesTotal += Math.round((txNext * 1000) / 8);
      recvBytesTotal += Math.round((rxNext * 1000) / 8);
    }

    const gPrev = gpu3dHistory[gpu3dHistory.length - 1] ?? 18;
    gpu3dHistory.push(Math.max(2, Math.min(58, Math.round(gPrev * 0.4 + (6 + Math.random() * 28) * 0.6))));
    if (gpu3dHistory.length > HISTORY_LEN) gpu3dHistory.shift();

    gpuCopyHistory.push(Math.max(0, Math.min(25, Math.round(1 + Math.random() * 6))));
    if (gpuCopyHistory.length > HISTORY_LEN) gpuCopyHistory.shift();

    gpuEncHistory.push(0);
    if (gpuEncHistory.length > HISTORY_LEN) gpuEncHistory.shift();

    gpuDecHistory.push(Math.max(0, Math.min(30, Math.round(2 + Math.random() * 9))));
    if (gpuDecHistory.length > HISTORY_LEN) gpuDecHistory.shift();

    gpuZeroHistory.push(0);
    if (gpuZeroHistory.length > HISTORY_LEN) gpuZeroHistory.shift();

    const shmPrev = gpuMemHistory[gpuMemHistory.length - 1] ?? 7.4;
    gpuMemHistory.push(Math.max(4.5, Math.min(11.5, +(shmPrev + (Math.random() - 0.5) * 0.4).toFixed(1))));
    if (gpuMemHistory.length > HISTORY_LEN) gpuMemHistory.shift();

    const dedPrev = gpuDedicatedMemHistory[gpuDedicatedMemHistory.length - 1] ?? 14.2;
    gpuDedicatedMemHistory.push(Math.max(10.0, Math.min(22.0, +(dedPrev + (Math.random() - 0.5) * 0.5).toFixed(1))));
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

    // Memory
    const memEst = extractEstimationValue(hp?.memory.browserDeviceMemoryGiB);
    const realDeviceGb =
      report && typeof report.memory.deviceMemoryGiB === 'number'
        ? report.memory.deviceMemoryGiB
        : memEst.provenance === 'real' && typeof memEst.value === 'number'
          ? memEst.value
          : null;
    const capped = memEst.provenance === 'real' ? Boolean(memEst.capped) : realDeviceGb === 8;
    const totalGb = realDeviceGb ?? 16;
    const usableGb = totalGb;
    const capText = Number.isInteger(totalGb) ? `${totalGb}.0 GB` : `${totalGb} GB`;
    const capTip = realDeviceGb
      ? capped
        ? `navigator.deviceMemory 在 ${capText} 处封顶（实际物理内存可能 ≥ ${capText}，按读数 ${capText} 展示）`
        : `navigator.deviceMemory 实测容量：${capText}`
      : undefined;
    const rawMemPct = memHistory[memHistory.length - 1] ?? 25.0;
    const usedGb = +((usableGb * rawMemPct) / 100).toFixed(1);
    const memPct = Math.round((usedGb / Math.max(0.1, usableGb)) * 100);
    const availGb = +Math.max(0, usableGb - usedGb).toFixed(1);
    const compressedMb = Math.round(Math.max(24, usedGb * 32 + 12));
    const cachedGbRaw = Math.min(availGb * 0.55, Math.max(0.4, totalGb * 0.18 + usedGb * 0.12));
    const cachedText =
      cachedGbRaw < 1
        ? `${Math.max(16, Math.round(cachedGbRaw * 1024))} MB`
        : `${cachedGbRaw.toFixed(1)} GB`;
    const availableMb = Math.round(availGb * 1024);
    const modifiedMb = Math.min(Math.round(cachedGbRaw * 1024), Math.round(usedGb * 1024 * 0.04));
    const standbyMb = Math.min(availableMb, Math.max(0, Math.round(cachedGbRaw * 1024) - modifiedMb));
    const freeMb = availableMb - standbyMb;
    const standbyPct = Math.max(0, Math.min(100 - memPct, (standbyMb / (usableGb * 1024)) * 100));
    const commitLimitGb = +(usableGb * 1.15 + 2.4).toFixed(1);
    const committedGb = Math.min(+(commitLimitGb - 0.3).toFixed(1), +(usedGb * 1.12 + 0.6).toFixed(1));
    const pagedPoolMb = Math.round(165 + totalGb * 28);
    const nonPagedPoolMb = Math.round(115 + totalGb * 14);
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
    const dedicatedTotalGb = inferDiscreteVramGb(gpuName, gpuEnvEst.value, resolvedGpuVendor);
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
    tickTimer = window.setInterval(() => {
      sampleTick += 1;
      if (sampleTick > 3) {
        advanceSeries();
      }
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
