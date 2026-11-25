import type { CpuSkuSpec } from '../schema/profile.js';
export interface GpuPciEntry {
    vendor: string;
    kind: 'igpu' | 'dgpu';
    gen: string;
    chip: string;
    name: string;
}
export interface PcCpuEntry extends CpuSkuSpec {
    igpuPciIds?: string[];
    igpuTokens?: string[];
}
export interface MobileSocEntry extends CpuSkuSpec {
    gpuKeys?: string[];
}
export interface MobileModelEntry {
    brand: string;
    modelName: string;
    socIds?: string[];
}
export declare const KB_VERSION = "2026.11.16";
export declare const gpuPciDb: Record<string, GpuPciEntry>;
export declare const pcCpusDb: PcCpuEntry[];
export declare const mobileSocsDb: {
    socs: Record<string, MobileSocEntry>;
    gpuToSocs: Record<string, string[]>;
};
export declare const mobileModelSocOverrides: Record<string, MobileModelEntry>;
export declare function getCachedMobileModelsDb(): Record<string, MobileModelEntry> | undefined;
/**
 * Lazy-load the full 44k+ Google Play device marketing-name dictionary (~2.5 MB).
 * Desktop/PC environments never trigger this chunk unless a non-empty mobile uaData.model is observed.
 */
export declare function loadMobileModelsDb(): Promise<Record<string, MobileModelEntry>>;
