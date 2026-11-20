import type { ResourceOwner } from '../contracts';
import { openDatabase } from './storage';
import type { RuntimeScope } from './runtime-primitives';
export interface HostEntryItem {
  name: string;
  kind: 'file' | 'directory';
  sizeBytes: number;
  lastModified: number;
  handle: FileSystemHandle;
}

const STORE_NAME = 'handles';
const DRIVE_D_KEY = 'drive-d';

function openHandleDb(): Promise<IDBDatabase | null> {
  return openDatabase('mounts',[STORE_NAME]).catch(() => null);
}

export async function saveDriveDHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openHandleDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(handle, DRIVE_D_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function loadDriveDHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openHandleDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(DRIVE_D_KEY);
      req.onsuccess = () => {
        db.close();
        resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function clearDriveDHandle(): Promise<void> {
  const db = await openHandleDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(DRIVE_D_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

type PermTarget = FileSystemDirectoryHandle & {
  queryPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'prompt' | 'denied'>;
  requestPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'prompt' | 'denied'>;
};

export async function queryDirPermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<'granted' | 'prompt' | 'denied'> {
  const h = handle as PermTarget;
  if (typeof h.queryPermission !== 'function') return 'granted';
  try {
    return await h.queryPermission({ mode });
  } catch {
    return 'prompt';
  }
}

export async function requestDirPermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<boolean> {
  const h = handle as PermTarget;
  if (typeof h.requestPermission !== 'function') return true;
  try {
    return (await h.requestPermission({ mode })) === 'granted';
  } catch {
    return false;
  }
}

export async function listHostDirectory(dirHandle: FileSystemDirectoryHandle): Promise<HostEntryItem[]> {
  const items: HostEntryItem[] = [];
  const iter = (dirHandle as unknown as { values?: () => AsyncIterable<FileSystemHandle> }).values;
  if (typeof iter === 'function') {
    for await (const handle of iter.call(dirHandle)) {
      if (handle.kind === 'file') {
        try {
          const file = await (handle as FileSystemFileHandle).getFile();
          items.push({
            name: handle.name,
            kind: 'file',
            sizeBytes: file.size,
            lastModified: file.lastModified,
            handle,
          });
        } catch {
          items.push({ name: handle.name, kind: 'file', sizeBytes: 0, lastModified: 0, handle });
        }
      } else {
        items.push({ name: handle.name, kind: 'directory', sizeBytes: 0, lastModified: 0, handle });
      }
    }
  }
  return items.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

export async function computeHostDirStats(
  dirHandle: FileSystemDirectoryHandle,
  maxItems = 600,
): Promise<{ files: number; dirs: number; bytes: number }> {
  let files = 0;
  let dirs = 0;
  let bytes = 0;
  let visited = 0;

  async function walk(dir: FileSystemDirectoryHandle) {
    const iter = (dir as unknown as { values?: () => AsyncIterable<FileSystemHandle> }).values;
    if (typeof iter !== 'function') return;
    for await (const h of iter.call(dir)) {
      if (++visited > maxItems) return;
      if (h.kind === 'file') {
        files++;
        try {
          const f = await (h as FileSystemFileHandle).getFile();
          bytes += f.size;
        } catch {}
      } else {
        dirs++;
        try {
          await walk(h as FileSystemDirectoryHandle);
        } catch {}
      }
    }
  }

  await walk(dirHandle);
  return { files, dirs, bytes };
}

export async function resolveHostSubdir(
  rootHandle: FileSystemDirectoryHandle,
  segments: readonly string[],
  createMissing = false,
): Promise<FileSystemDirectoryHandle> {
  let cur = rootHandle;
  for (const seg of segments) {
    if (!seg) continue;
    cur = await cur.getDirectoryHandle(seg, { create: createMissing });
  }
  return cur;
}

export async function writeHostTextFile(
  rootHandle: FileSystemDirectoryHandle,
  segments: readonly string[],
  content: string,
  owner: RuntimeScope,
): Promise<{ sizeBytes: number }> {
  if (segments.length === 0) throw new Error('文件路径无效');
  const dir = await resolveHostSubdir(rootHandle, segments.slice(0, -1), true);
  const fh = await dir.getFileHandle(segments[segments.length - 1], { create: true });
  await owner.writeFile(fh, content);
  const file = await fh.getFile();
  return { sizeBytes: file.size };
}

export async function deleteHostEntry(
  rootHandle: FileSystemDirectoryHandle,
  segments: readonly string[],
): Promise<void> {
  if (segments.length === 0) throw new Error('不能删除根目录');
  const dir = await resolveHostSubdir(rootHandle, segments.slice(0, -1), false);
  await dir.removeEntry(segments[segments.length - 1], { recursive: true });
}

export async function replaceHostBytes(file:FileSystemFileHandle,chunks:readonly Uint8Array<ArrayBuffer>[],owner:ResourceOwner) {
  const stream=await file.createWritable();
  let release:(()=>void)|undefined;
  try {
    owner.assertLive();
    release=owner.manage('writers',()=>stream.abort());
    for (const bytes of chunks) {owner.assertLive();await stream.write(bytes);}
    owner.assertLive();await stream.close();
  } catch (e) {await stream.abort().catch(()=>{});throw e;}
  finally {release?.();}
}
