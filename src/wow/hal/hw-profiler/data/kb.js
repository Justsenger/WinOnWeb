import gpuPciDbRaw from './generated/gpu_pci_db.json' with { type: 'json' };
import pcCpusDbRaw from './generated/pc_cpus_db.json' with { type: 'json' };
import mobileSocsDbRaw from './generated/mobile_socs_db.json' with { type: 'json' };
import mobileModelSocOverridesRaw from './generated/mobile_model_soc_overrides.json' with { type: 'json' };
export const KB_VERSION = '2026.11.20';
export const gpuPciDb = gpuPciDbRaw;
export const pcCpusDb = pcCpusDbRaw;
export const mobileSocsDb = mobileSocsDbRaw;
export const mobileModelSocOverrides = mobileModelSocOverridesRaw;
let cachedMobileModelsDb;
export function getCachedMobileModelsDb() {
    return cachedMobileModelsDb;
}
/**
 * Lazy-load the full 44k+ Google Play device marketing-name dictionary (~2.5 MB).
 * Desktop/PC environments never trigger this chunk unless a non-empty mobile uaData.model is observed.
 */
export async function loadMobileModelsDb() {
    if (cachedMobileModelsDb)
        return cachedMobileModelsDb;
    const mod = await import('./generated/mobile_models_db.json', {
        with: { type: 'json' },
    });
    cachedMobileModelsDb = (mod.default ?? mod);
    return cachedMobileModelsDb;
}
