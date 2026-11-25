import type { CollectedSignals } from '../schema/profile.js';
export declare function collectNavigatorSignals(timeoutMs?: number): Promise<Pick<CollectedSignals, 'isSecureContext' | 'userAgent' | 'platform' | 'maxTouchPoints' | 'hardwareConcurrency' | 'deviceMemoryGiB' | 'screen' | 'uaData'>>;
