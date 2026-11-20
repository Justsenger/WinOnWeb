import type { PackageManifest, VersionRecord } from '../contracts';
export function stageArchive(
  bytes: ArrayBuffer,
  version: VersionRecord,
): Promise<{ manifest: PackageManifest; paths: string[] }> {
  const worker = new Worker(new URL('./unpack.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(data.result);
    };
    worker.postMessage({ bytes, version }, [bytes]);
  });
}
