import type { InstalledPackage, VersionRecord } from '../contracts';
import { activateVhost, deployment } from '../hal/vhost';
import { stageArchive } from '../hal/archive';
import { uniqueId, sha256 } from '../hal/platform';
import {
  commitPackage,
  forgetPackage,
  versionFiles,
  records,
  getRecord,
  putRecord,
  exclusive,
  ifUnpinned,
  discardVersion,
  contentBackend,
  pinVersion,
} from '../hal/storage';

export type InstallSource =
  { kind: 'catalog'; id: string; sha256: string } | { kind: 'sideload'; trusted: boolean };
const packageLock = (id: string) => 'package:' + id;
export const listPackages = () => records<InstalledPackage>('apps');

async function collect(id: string) {
  const active = await getRecord<InstalledPackage>('apps', id);
  for (const v of await records<VersionRecord>('versions')) {
    if (v.id !== id || active?.versionHash === v.versionHash) continue;
    await ifUnpinned(v, async () => {
      const mode = deployment();
      if (mode.mode === 'isolated') await mode.bridge.removeVersion(id, v.versionHash);
      await discardVersion(v);
    });
  }
}
export async function recoverPackages() {
  for (const id of new Set((await records<VersionRecord>('versions')).map((v) => v.id))) {
    try {
      await exclusive(packageLock(id), () => collect(id));
    } catch (error) {
      console.warn('[wow] package recovery cleanup deferred:', id, error);
    }
  }
}
export async function acquireVersion(id: string, hash: string) {
  return exclusive(packageLock(id), async () => {
    const version = await getRecord<VersionRecord>('versions', [id, hash]);
    if (version?.state !== 'verified') throw Error('应用版本已经卸载');
    const release = await pinVersion(id, hash);
    return () => {
      release();
      void exclusive(packageLock(id), () => collect(id)).catch(console.error);
    };
  });
}
export async function installPackage(bytes: ArrayBuffer, source: InstallSource) {
  const size = bytes.byteLength;
  if (!size || size > 512 * 1024 ** 2) throw Error('包大小超限');
  const hash = await sha256(bytes);
  if (source.kind === 'catalog' && (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(source.id) || source.sha256 !== hash))
    throw Error('商店包摘要或身份不匹配');
  const topology = deployment();
  if (source.kind === 'sideload' && topology.mode === 'single-trusted' && !source.trusted)
    throw Error('单域模式仅可安装受信包');
  const id = source.kind === 'catalog' ? 'official-' + source.id : 'local-' + uniqueId();
  const publisher = source.kind === 'catalog' ? 'official' : id;
  return exclusive(packageLock(id), async () => {
    await collect(id);
    const previous = await getRecord<InstalledPackage>('apps', id);
    if (previous && previous.publisher !== publisher) throw Error('发布者不匹配');
    if (previous?.versionHash === hash) return previous;
    // A downgrade can target an immutable version still pinned by a running view.
    let version = await getRecord<VersionRecord & { package?: InstalledPackage }>('versions', [id, hash]);
    let next = version?.package;
    if (!next || version?.state !== 'verified') {
      version = { id, versionHash: hash, backend: await contentBackend(), state: 'staging' };
      await putRecord('versions', [id, hash], version);
      try {
        const { manifest, paths } = await stageArchive(bytes, version);
        if (source.kind === 'catalog' && manifest.id !== source.id) throw Error('清单应用标识不匹配');
        await activateVhost(id);
        if (topology.mode === 'isolated') {
          await topology.bridge.writeVersion(id, hash, versionFiles(version, paths));
        }
        next = {
          id,
          publisher,
          versionHash: hash,
          manifest,
          installedAt: new Date().toISOString(),
          size,
          fileCount: paths.length,
        };
      } catch (error) {
        await collect(id);
        throw error;
      }
    }
    const committed = next;
    await commitPackage(
      committed,
      version!,
      Boolean(
        previous && committed.manifest.permissions?.some((p) => !previous.manifest.permissions?.includes(p)),
      ),
    );
    try {
      await collect(id);
    } catch (error) {
      console.warn('[wow] post-commit gc deferred:', id, error);
    }
    return committed;
  });
}
export function removePackage(id: string) {
  return exclusive(packageLock(id), async () => {
    await forgetPackage(id);
    await collect(id);
  });
}
export { decideGrant } from '../hal/storage';

export function principalId(id: string, source: 'system' | 'host' | 'installed') {
  if (source === 'installed') {
    if (!/^(official|local|link)-[a-z0-9_-]+$/.test(id)) throw Error('无效安装身份');
    return id;
  }
  return source + ':' + id;
}
