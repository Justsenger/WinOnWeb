import { collectAllSignals } from './collectors/index.js';
import { inferHardwareFromSignals } from './inference/pipeline.js';
import { loadMobileModelsDb } from './data/kb.js';
export * from './schema/profile.js';
export { collectAllSignals } from './collectors/index.js';
export { inferHardwareFromSignals } from './inference/pipeline.js';
export { loadMobileModelsDb } from './data/kb.js';
export async function inferHardwareAsync(signals, options = {}) {
    if (!options.mobileModelsDb && signals.uaData?.model?.trim()) {
        const mobileModelsDb = await loadMobileModelsDb();
        return inferHardwareFromSignals(signals, { ...options, mobileModelsDb });
    }
    return inferHardwareFromSignals(signals, options);
}
export async function probeHardware(options = {}) {
    const signals = await collectAllSignals(options);
    const profile = await inferHardwareAsync(signals, {
        confidentSingle: options.confidentSingle,
    });
    if (options.includeRawSignals) {
        profile.rawSignals = signals;
    }
    return profile;
}
