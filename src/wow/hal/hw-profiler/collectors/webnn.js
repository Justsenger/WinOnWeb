export async function collectWebNNSignals(isSecureContext, enabled = true, timeoutMs = 250) {
    if (!enabled || !isSecureContext || typeof navigator === 'undefined') {
        return { available: false };
    }
    const ml = navigator.ml;
    if (!ml || typeof ml.createContext !== 'function') {
        return { available: false };
    }
    try {
        const ctx = await Promise.race([
            ml.createContext({ deviceType: 'npu' }),
            new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
        ]);
        return {
            available: true,
            npuSupported: Boolean(ctx),
        };
    }
    catch {
        return {
            available: true,
            npuSupported: false,
        };
    }
}
