import type { CollectedSignals } from '../schema/profile.js';
import { type GpuPciEntry } from '../data/kb.js';
export interface ParsedGpuContext {
    environment: 'integrated_only' | 'discrete_primary' | 'dual_gpu_detected' | 'software_emulated';
    vendor: string;
    rendererRaw: string;
    vendorHex?: string;
    deviceHex?: string;
    pciEntry?: GpuPciEntry;
    architecture?: string;
    normalizedMobileKey?: string;
    isSoftwareRenderer: boolean;
    isVirtualOrSoftware: boolean;
    isPrivacyMaskedAppleGpu: boolean;
    igpuRendererForInference: string;
    igpuDeviceHexForInference?: string;
    igpuVendorHexForInference?: string;
    igpuPciEntryForInference?: GpuPciEntry;
}
export declare function normalizeMobileGpuKey(name: string): string | undefined;
export declare function parseAngleOrRenderer(rendererRaw: string, vendorHint?: string): {
    vendor: string;
    vendorHex?: string;
    deviceHex?: string;
};
export declare function parseGpuContext(signals: CollectedSignals): ParsedGpuContext;
