import type { ResourceOwner } from '../contracts';
import { openDatabase } from './storage';
/** Uploaded file bytes live separately from the generated C: drive skeleton. */
export interface ExplorerUpload {
  path: string;
  blob: Blob;
  modifiedText: string;
}

let connection: Promise<IDBDatabase> | undefined;

function openUploads(): Promise<IDBDatabase> {
  if (!connection) {
    connection = openDatabase('vfs',['files']).then(db => {
      db.onversionchange = () => { db.close(); connection = undefined; };
      return db;
    }).catch((error) => {
      connection = undefined;
      throw error;
    });
  }
  return connection;
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('保存文件失败'));
  });
}

export async function listUploads(): Promise<ExplorerUpload[]> {
  const db = await openUploads();
  const tx = db.transaction('files');
  const request = tx.objectStore('files').getAll();
  await completed(tx);
  return request.result;
}

export async function saveUpload(record: ExplorerUpload, replace = false, owner?: ResourceOwner): Promise<void> {
  const db = await openUploads();
  const tx = db.transaction('files', 'readwrite');
  owner?.assertLive();
  const release=owner?.manage('writers',()=>tx.abort());
  const files = tx.objectStore('files');
  const key = record.path.toLowerCase();
  if (replace) files.put(record, key);
  else files.add(record, key);
  try {await completed(tx);} finally {release?.();}
}

/** Keep uploaded files attached to their Explorer paths when an item or parent changes. */
export async function relocateUploads(from: string, to?: string, copy = false): Promise<void> {
  if (typeof indexedDB === 'undefined' || from === to) return;
  const db = await openUploads();
  const tx = db.transaction('files', 'readwrite');
  const files = tx.objectStore('files');
  const key = from.toLowerCase();
  const request = files.getAll(IDBKeyRange.bound(key, key + '\uffff'));
  request.onsuccess = () => {
    for (const record of request.result as ExplorerUpload[]) {
      const oldKey = record.path.toLowerCase();
      if (oldKey !== key && !oldKey.startsWith(key + '\\')) continue;
      if (!copy) files.delete(oldKey);
      if (to) {
        const path = to + record.path.slice(from.length);
        files.add({ ...record, path }, path.toLowerCase());
      }
    }
  };
  await completed(tx);
}
