function createWebGLContext() {
    try {
        const canvas = typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(1, 1)
            : typeof document !== 'undefined'
                ? document.createElement('canvas')
                : null;
        if (!canvas)
            return null;
        return (canvas.getContext('webgl2') ||
            canvas.getContext('webgl') ||
            canvas.getContext('experimental-webgl'));
    }
    catch {
        return null;
    }
}
export function collectWebGLSignals() {
    const gl = createWebGLContext();
    if (!gl)
        return undefined;
    try {
        const vendor = gl.getParameter(gl.VENDOR);
        const renderer = gl.getParameter(gl.RENDERER);
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const unmaskedVendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : undefined;
        const unmaskedRenderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : undefined;
        const loseExt = gl.getExtension('WEBGL_lose_context');
        loseExt?.loseContext();
        return {
            vendor: typeof vendor === 'string' ? vendor : undefined,
            renderer: typeof renderer === 'string' ? renderer : undefined,
            unmaskedVendor: typeof unmaskedVendor === 'string' ? unmaskedVendor : undefined,
            unmaskedRenderer: typeof unmaskedRenderer === 'string' ? unmaskedRenderer : undefined,
        };
    }
    catch {
        return undefined;
    }
}
export async function collectWebGPUSignals(isSecureContext, timeoutMs = 600) {
    if (!isSecureContext || typeof navigator === 'undefined') {
        return { available: false, adapters: [] };
    }
    const gpu = navigator.gpu;
    if (!gpu || typeof gpu.requestAdapter !== 'function') {
        return { available: false, adapters: [] };
    }
    const prefs = ['low-power', 'high-performance'];
    const seen = new Set();
    const adapters = [];
    const probeOne = async (powerPreference) => {
        try {
            const adapter = await Promise.race([
                gpu.requestAdapter({ powerPreference }),
                new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
            ]);
            if (!adapter)
                return;
            const legacyAdapter = adapter;
            const info = legacyAdapter.info ??
                (typeof legacyAdapter.requestAdapterInfo === 'function'
                    ? await legacyAdapter.requestAdapterInfo()
                    : undefined);
            if (!info)
                return;
            const key = `${info.vendor || ''}|${info.device || ''}|${info.description || ''}|${info.architecture || ''}`;
            if (seen.has(key))
                return;
            seen.add(key);
            adapters.push({
                powerPreference,
                vendor: info.vendor || undefined,
                architecture: info.architecture || undefined,
                device: info.device || undefined,
                description: info.description || undefined,
                isFallbackAdapter: info.isFallbackAdapter,
                subgroupMinSize: info.subgroupMinSize,
                subgroupMaxSize: info.subgroupMaxSize,
                maxBufferSize: typeof legacyAdapter.limits?.maxBufferSize === 'number'
                    ? legacyAdapter.limits.maxBufferSize
                    : undefined,
            });
        }
        catch {
            // Ignore adapter request failure
        }
    };
    await Promise.all(prefs.map(probeOne));
    return { available: true, adapters };
}
