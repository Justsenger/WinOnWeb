import type { CollectedSignals } from '../schema/profile.js';
export declare function collectWebGLSignals(): CollectedSignals['webgl'];
export declare function collectWebGPUSignals(isSecureContext: boolean, timeoutMs?: number): Promise<CollectedSignals['webgpu']>;
