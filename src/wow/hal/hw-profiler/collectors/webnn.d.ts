import type { CollectedSignals } from '../schema/profile.js';
export declare function collectWebNNSignals(isSecureContext: boolean, enabled?: boolean, timeoutMs?: number): Promise<CollectedSignals['webnn']>;
