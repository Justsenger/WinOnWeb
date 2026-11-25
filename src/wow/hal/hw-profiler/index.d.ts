import type { CollectedSignals, HardwareProfile, ProbeOptions } from './schema/profile.js';
import { type InferOptions } from './inference/pipeline.js';
export * from './schema/profile.js';
export { collectAllSignals } from './collectors/index.js';
export { inferHardwareFromSignals, type InferOptions } from './inference/pipeline.js';
export { loadMobileModelsDb } from './data/kb.js';
export declare function inferHardwareAsync(signals: CollectedSignals, options?: InferOptions): Promise<HardwareProfile>;
export declare function probeHardware(options?: ProbeOptions): Promise<HardwareProfile>;
