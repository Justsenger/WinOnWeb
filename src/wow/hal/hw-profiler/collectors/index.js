import { collectNavigatorSignals } from './navigator.js';
import { collectWebGLSignals, collectWebGPUSignals } from './graphics.js';
import { collectWebNNSignals } from './webnn.js';
export async function collectAllSignals(options = {}) {
    const timeoutMs = options.timeoutMs ?? 500;
    const navSignals = await collectNavigatorSignals(timeoutMs);
    const webgl = collectWebGLSignals();
    const [webgpu, webnn] = await Promise.all([
        collectWebGPUSignals(navSignals.isSecureContext, timeoutMs),
        collectWebNNSignals(navSignals.isSecureContext, options.enableWebNNProbe ?? true, Math.min(timeoutMs, 250)),
    ]);
    return {
        ...navSignals,
        webgl,
        webgpu,
        webnn,
    };
}
