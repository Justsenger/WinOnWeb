const HIGH_ENTROPY_HINTS = [
    'architecture',
    'bitness',
    'model',
    'platform',
    'platformVersion',
    'wow64',
];
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(undefined), ms)),
    ]);
}
export async function collectNavigatorSignals(timeoutMs = 500) {
    if (typeof navigator === 'undefined') {
        return {
            isSecureContext: false,
            userAgent: '',
            platform: '',
            maxTouchPoints: 0,
        };
    }
    const nav = navigator;
    const isSecureContext = typeof globalThis !== 'undefined' && 'isSecureContext' in globalThis
        ? Boolean(globalThis.isSecureContext)
        : false;
    const base = {
        isSecureContext,
        userAgent: nav.userAgent || '',
        platform: nav.platform || '',
        maxTouchPoints: typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0,
        hardwareConcurrency: typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0
            ? nav.hardwareConcurrency
            : undefined,
        deviceMemoryGiB: isSecureContext && typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0
            ? nav.deviceMemory
            : undefined,
        screen: typeof screen !== 'undefined'
            ? {
                width: screen.width,
                height: screen.height,
                devicePixelRatio: typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
                    ? window.devicePixelRatio
                    : 1,
            }
            : undefined,
    };
    if (isSecureContext && nav.userAgentData) {
        const uaData = {
            mobile: nav.userAgentData.mobile,
            platform: nav.userAgentData.platform,
            brands: nav.userAgentData.brands,
        };
        if (typeof nav.userAgentData.getHighEntropyValues === 'function') {
            try {
                const high = await withTimeout(nav.userAgentData.getHighEntropyValues(HIGH_ENTROPY_HINTS), timeoutMs);
                if (high) {
                    if (typeof high.architecture === 'string')
                        uaData.architecture = high.architecture;
                    if (typeof high.bitness === 'string')
                        uaData.bitness = high.bitness;
                    if (typeof high.model === 'string')
                        uaData.model = high.model;
                    if (typeof high.platform === 'string')
                        uaData.platform = high.platform;
                    if (typeof high.platformVersion === 'string')
                        uaData.platformVersion = high.platformVersion;
                    if (typeof high.wow64 === 'boolean')
                        uaData.wow64 = high.wow64;
                }
            }
            catch {
                // Fallback silently to low-entropy UA-CH + legacy UA
            }
        }
        base.uaData = uaData;
    }
    return base;
}
