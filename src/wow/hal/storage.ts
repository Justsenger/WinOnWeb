import type { VersionRecord, InstalledPackage, GrantRow, Capability, PermissionDecision } from '../contracts';

export const preferences = {
  removeItem: (key: string) => localStorage.removeItem('wow:kv:' + key),
  getItem: (key: string) => localStorage.getItem('wow:kv:' + key),
  setItem: (key: string, value: string) => localStorage.setItem('wow:kv:' + key, value),
};
const storageManager = () => navigator.storage;
let pendingReadBytes = 0;
let pendingWriteBytes = 0;
export function recordStorageRead(bytes: number) {
  if (Number.isFinite(bytes) && bytes > 0) pendingReadBytes += bytes;
}
export function recordStorageWrite(bytes: number) {
  if (Number.isFinite(bytes) && bytes > 0) pendingWriteBytes += bytes;
}
export function drainStorageIo(): { readBytes: number; writeBytes: number } {
  const result = { readBytes: pendingReadBytes, writeBytes: pendingWriteBytes };
  pendingReadBytes = 0;
  pendingWriteBytes = 0;
  return result;
}
export const directoryPicker = () =>
  (
    window as Window & {
      showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker?.bind(window);

export function openDatabase(name: string, stores: readonly string[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('wow:db:' + name, 1);
    request.onupgradeneeded = () => {
      for (const store of stores) request.result.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const stores = ['apps', 'versions', 'files', 'grants', 'links'] as const;
type Store = (typeof stores)[number];
export async function transaction<T>(
  names: Store[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => () => T,
): Promise<T> {
  const db = await openDatabase('packages', stores);
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(names, mode);
      tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted'));
      try {
        const result = run(tx);
        tx.oncomplete = () => resolve(result());
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  } finally {
    db.close();
  }
}
export function getRecord<T>(store: Store, key: IDBValidKey): Promise<T | undefined> {
  return transaction([store], 'readonly', (tx) => {
    const r = tx.objectStore(store).get(key);
    return () => r.result;
  });
}
export function records<T>(store: Store): Promise<T[]> {
  return transaction([store], 'readonly', (tx) => {
    const r = tx.objectStore(store).getAll();
    return () => r.result;
  });
}
export function putRecord(store: Store, key: IDBValidKey, value: unknown) {
  return transaction([store], 'readwrite', (tx) => {
    tx.objectStore(store).put(value, key);
    return () => {};
  });
}
export async function contentBackend(): Promise<VersionRecord['backend']> {
  try {
    if (typeof FileSystemFileHandle === 'undefined' || !FileSystemFileHandle.prototype.createWritable)
      return 'idb';
    await navigator.storage.getDirectory();
    return 'opfs';
  } catch {
    return 'idb';
  }
}
async function versionDirectory(v: VersionRecord, create: boolean) {
  let dir = await navigator.storage.getDirectory();
  for (const name of ['wow-apps', v.id, v.versionHash]) dir = await dir.getDirectoryHandle(name, { create });
  return dir;
}
async function fileAt(v: VersionRecord, path: string, create: boolean) {
  let dir = await versionDirectory(v, create);
  const parts = path.split('/');
  const name = parts.pop()!;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return dir.getFileHandle(name, { create });
}
export async function writeContent(v: VersionRecord, path: string, blob: Blob) {
  recordStorageWrite(blob.size);
  if (v.backend === 'idb') return putRecord('files', [v.id, v.versionHash, path], blob);
  const writer = await (await fileAt(v, path, true)).createWritable();
  try {
    await writer.write(blob);
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
}
export async function readContent(v: VersionRecord, path: string): Promise<Blob> {
  if (v.backend === 'opfs') {
    const file = await (await fileAt(v, path, false)).getFile();
    recordStorageRead(file.size);
    return file;
  }
  const blob = await getRecord<Blob>('files', [v.id, v.versionHash, path]);
  if (!blob) throw new Error('Missing package file: ' + path);
  recordStorageRead(blob.size);
  return blob;
}
export async function discardVersion(v: VersionRecord) {
  if (v.backend === 'opfs') {
    try {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('wow-apps');
      await (await root.getDirectoryHandle(v.id)).removeEntry(v.versionHash, { recursive: true });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
    }
  }
  await transaction(['files', 'versions'], 'readwrite', (tx) => {
    tx.objectStore('files').delete(IDBKeyRange.bound([v.id, v.versionHash], [v.id, v.versionHash, []]));
    tx.objectStore('versions').delete([v.id, v.versionHash]);
    return () => {};
  });
}

export function exclusive<T>(key: string, work: () => Promise<T>) {
  if (!navigator.locks) throw new Error('安装和写入需要安全上下文及 Web Locks 支持');
  return navigator.locks.request('wow:' + key, work);
}
// A shared version lock lives as long as the iframe. Browser teardown releases it on crashes.
export function pinVersion(id: string, hash: string): Promise<() => void> {
  return new Promise((resolve, reject) => {
    navigator.locks
      .request(
        'wow:version:' + id + ':' + hash,
        { mode: 'shared' },
        () => new Promise<void>((release) => resolve(release)),
      )
      .catch(reject);
  });
}
export function ifUnpinned(v: VersionRecord, collect: () => Promise<void>) {
  return navigator.locks.request(
    'wow:version:' + v.id + ':' + v.versionHash,
    { ifAvailable: true },
    async (lock) => {
      if (lock) await collect();
    },
  );
}

export const hasDatabase = () => typeof indexedDB !== 'undefined';
export const sessionPreferences = {
  getItem: (key: string) => sessionStorage.getItem('wow:kv:' + key),
  setItem: (key: string, value: string) => sessionStorage.setItem('wow:kv:' + key, value),
  removeItem: (key: string) => sessionStorage.removeItem('wow:kv:' + key),
};

export async function* versionFiles(v: VersionRecord, paths: readonly string[]) {
  for (const path of paths) yield { path, bytes: await (await readContent(v, path)).arrayBuffer() };
}
export function commitPackage(committed: InstalledPackage, version: VersionRecord, resetGrants: boolean) {
  return transaction(['apps', 'versions', 'grants'], 'readwrite', (tx) => {
    tx.objectStore('versions').put({ ...version, state: 'verified', package: committed }, [
      committed.id,
      committed.versionHash,
    ]);
    tx.objectStore('apps').put(committed, committed.id);
    if (resetGrants) tx.objectStore('grants').delete(committed.id);
    return () => {};
  });
}
export function forgetPackage(id: string) {
  return transaction(['apps', 'links', 'grants'], 'readwrite', (tx) => {
    for (const name of ['apps', 'links', 'grants']) tx.objectStore(name).delete(id);
    return () => {};
  });
}
export function decideGrant(
  id: string,
  capability: Capability,
  decision: PermissionDecision | null,
  versionHash?: string,
) {
  return transaction(['grants', 'apps'], 'readwrite', (tx) => {
    const store = tx.objectStore('grants');
    const app = tx.objectStore('apps').get(id);
    const row = store.get(id);
    row.onsuccess = () => {
      if (versionHash && app.result?.versionHash !== versionHash) {
        tx.abort();
        return;
      }
      const grants: GrantRow = row.result?.grants ?? {};
      if (decision) grants[capability] = decision;
      else delete grants[capability];
      store.put({ id, grants }, id);
    };
    return () => {};
  });
}

export interface OpfsEntrySummary {
  name: string;
  kind: 'file' | 'directory';
  sizeBytes: number;
}
export async function listOpfsEntries(): Promise<OpfsEntrySummary[]> {
  if (typeof navigator === 'undefined' || !storageManager()?.getDirectory) return [];
  try {
    const root = await storageManager().getDirectory();
    const list: OpfsEntrySummary[] = [];
    const iter = (root as unknown as { values?: () => AsyncIterable<FileSystemHandle> }).values;
    if (typeof iter === 'function') {
      for await (const handle of iter.call(root)) {
        if (handle.kind === 'file') {
          const file = await (handle as FileSystemFileHandle).getFile();
          list.push({ name: handle.name, kind: 'file', sizeBytes: file.size });
        } else {
          list.push({ name: handle.name, kind: 'directory', sizeBytes: 0 });
        }
      }
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function clearOpfsTestBlocks(prefix = 'opfs-block-'): Promise<number> {
  if (typeof navigator === 'undefined' || !storageManager()?.getDirectory) return 0;
  const root = await storageManager().getDirectory();
  const current = await listOpfsEntries();
  let removed = 0;
  for (const item of current) {
    if (item.name.startsWith(prefix)) {
      await root.removeEntry(item.name);
      removed++;
    }
  }
  return removed;
}

export async function requestPersistence(): Promise<{ supported: boolean; granted: boolean }> {
  if (typeof navigator === 'undefined' || !storageManager()?.persist) {
    return { supported: false, granted: false };
  }
  const granted = await storageManager().persist();
  return { supported: true, granted };
}

export const supportsOpfs = () => typeof navigator.storage?.getDirectory === 'function';
export const supportsPersistence = () => typeof navigator.storage?.persist === 'function';
