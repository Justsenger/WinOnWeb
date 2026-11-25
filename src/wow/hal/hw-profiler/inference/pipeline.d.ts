import type { CollectedSignals, HardwareProfile } from '../schema/profile.js';
import { type MobileModelEntry } from '../data/kb.js';
export interface InferOptions {
    mobileModelsDb?: Record<string, MobileModelEntry>;
    /** Force Top-1 single SKU convergence (no candidate arrays; downstream fields all derive from Top-1) */
    confidentSingle?: boolean;
}
export declare function inferHardwareFromSignals(signals: CollectedSignals, options?: InferOptions): HardwareProfile;
