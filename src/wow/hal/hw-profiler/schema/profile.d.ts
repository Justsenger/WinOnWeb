export type FieldStatus = 'real' | 'inferred_exact' | 'inferred_candidates' | 'unknown';
export type UnknownReason = 'hardware_decoupled' | 'discrete_gpu_occluded' | 'insecure_context' | 'privacy_masked' | 'browser_unsupported' | 'kb_miss';
export type ConfidenceTier = 'high' | 'medium' | 'low' | 'none';
export interface SignalSource {
    signal: string;
    observed?: string;
    ruleId?: string;
}
export interface CandidateItem<T> {
    value: T;
    probability: number;
    note?: string;
}
export type FieldEstimation<T> = {
    status: 'real';
    value: T;
    confidence: number;
    tier: 'high' | 'medium';
    capped?: boolean;
    sources: SignalSource[];
} | {
    status: 'inferred_exact';
    value: T;
    confidence: number;
    tier: 'high' | 'medium';
    sources: SignalSource[];
} | {
    status: 'inferred_candidates';
    candidates: CandidateItem<T>[];
    commonFamily?: string;
    confidence: number;
    tier: 'medium' | 'low';
    sources: SignalSource[];
} | {
    status: 'unknown';
    reason: UnknownReason;
    confidence: 0;
    tier: 'none';
    detail?: string;
    /** Standardized generic/virtual fallback label owned by hw-profiler (e.g. "Virtual x64 Processor" / "x64 Processor") */
    fallbackName?: string;
    sources: SignalSource[];
};
export type CpuVendor = 'Intel' | 'AMD' | 'Apple' | 'Qualcomm' | 'MediaTek' | 'Samsung' | 'Google' | 'HiSilicon' | 'UNISOC' | 'Other';
export interface CpuCacheSpec {
    l1KB?: number;
    l1IKB?: number;
    l1DKB?: number;
    l2KB?: number;
    l3KB?: number;
    /** System Level Cache (kept separate from CPU L3, e.g. Dimensity 9300 10 MB SLC / Exynos 990 2 MB SLC) */
    slcKB?: number;
    topologyNote?: string;
    evidenceTier?: 'T1_official' | 'T1_real_device' | 'T2_arch_diagram' | 'T2_paper_table' | 'T2_oem_spec' | 'T3_unverified_clue';
    evidenceSource?: string;
}
export interface CpuSkuSpec {
    id: string;
    vendor: CpuVendor;
    model: string;
    /** Windows Registry/WMI ProcessorNameString format (e.g. "Snapdragon(R) X 12-core X1E80100 @ 3.40 GHz") */
    winBrandString?: string;
    codename?: string;
    architecture: 'x86_64' | 'arm64' | 'x86' | 'arm';
    physicalCores?: number;
    logicalCores?: number;
    baseClockGHz?: number;
    boostClockGHz?: number;
    cache?: CpuCacheSpec;
    integratedGpu?: string;
    npu?: NpuSpec;
    memorySpec?: MemorySpec;
    coupledNetworkHardware?: string;
}
export interface NpuSpec {
    vendor: string;
    name: string;
    /** Windows PnP ComputeAccelerator FriendlyName (e.g. "Snapdragon(R) X Elite - X1E80100 - Qualcomm(R) Hexagon(TM) NPU") */
    winDisplayName?: string;
    topsPeak?: number;
}
export type MemoryGeneration = 'LPDDR3' | 'LPDDR4' | 'LPDDR4X' | 'LPDDR5' | 'LPDDR5X' | 'LPDDR5T' | 'DDR4' | 'DDR5' | 'Unified';
export interface MemorySpec {
    generations: MemoryGeneration[];
    maxSpeedMTs?: number;
    channels?: number;
    formFactorHint?: string;
}
export interface CollectedSignals {
    isSecureContext: boolean;
    userAgent: string;
    platform: string;
    maxTouchPoints: number;
    hardwareConcurrency?: number;
    deviceMemoryGiB?: number;
    screen?: {
        width: number;
        height: number;
        devicePixelRatio: number;
    };
    uaData?: {
        mobile?: boolean;
        platform?: string;
        platformVersion?: string;
        architecture?: string;
        bitness?: string;
        model?: string;
        wow64?: boolean;
        brands?: Array<{
            brand: string;
            version: string;
        }>;
    };
    webgl?: {
        vendor?: string;
        renderer?: string;
        unmaskedVendor?: string;
        unmaskedRenderer?: string;
    };
    webgpu?: {
        available: boolean;
        adapters: Array<{
            powerPreference?: 'low-power' | 'high-performance' | 'default';
            vendor?: string;
            architecture?: string;
            device?: string;
            description?: string;
            isFallbackAdapter?: boolean;
            subgroupMinSize?: number;
            subgroupMaxSize?: number;
            maxBufferSize?: number;
        }>;
    };
    webnn?: {
        available: boolean;
        npuSupported?: boolean;
    };
}
export type ExecutionEnvironment = 'bare_metal_identified' | 'bare_metal_discrete_opaque' | 'virtual_or_emulated' | 'generic_unknown';
export interface HardwareProfile {
    meta: {
        schemaVersion: '1.0.0';
        kbVersion: string;
        timestampIso: string;
        isSecureContext: boolean;
        degradationMode: 'full_secure' | 'degraded_insecure';
        executionEnvironment: ExecutionEnvironment;
        collectionDurationMs: number;
    };
    device: {
        formFactor: FieldEstimation<'desktop' | 'laptop' | 'tablet' | 'smartphone' | 'unknown'>;
        osName: FieldEstimation<string>;
        osVersion: FieldEstimation<string>;
        architecture: FieldEstimation<string>;
        bitness: FieldEstimation<'64' | '32'>;
        marketingModel: FieldEstimation<{
            brand: string;
            modelName: string;
            rawCode?: string;
        }>;
    };
    cpu: {
        vendor: FieldEstimation<CpuVendor>;
        model: FieldEstimation<string>;
        winBrandString: FieldEstimation<string>;
        codename: FieldEstimation<string>;
        baseClockGHz: FieldEstimation<number>;
        physicalCores: FieldEstimation<number>;
        logicalCores: FieldEstimation<number>;
        cache: FieldEstimation<CpuCacheSpec>;
        skuCandidates: FieldEstimation<CpuSkuSpec>;
    };
    gpu: {
        environment: FieldEstimation<'integrated_only' | 'discrete_primary' | 'dual_gpu_detected' | 'software_emulated'>;
        vendor: FieldEstimation<string>;
        rendererRaw: FieldEstimation<string>;
        pciDeviceIdHex: FieldEstimation<string>;
        architecture: FieldEstimation<string>;
        name: FieldEstimation<string>;
    };
    memory: {
        browserDeviceMemoryGiB: FieldEstimation<number>;
        spec: FieldEstimation<MemorySpec>;
    };
    npu: {
        hardware: FieldEstimation<NpuSpec>;
        webnnNpuSupported: FieldEstimation<boolean>;
    };
    network: {
        hardwareName: FieldEstimation<string>;
    };
    rawSignals?: CollectedSignals;
}
export interface ProbeOptions {
    enableWebNNProbe?: boolean;
    includeRawSignals?: boolean;
    timeoutMs?: number;
    /** Force Top-1 single SKU convergence (no candidate arrays; downstream fields all derive from Top-1) */
    confidentSingle?: boolean;
}
