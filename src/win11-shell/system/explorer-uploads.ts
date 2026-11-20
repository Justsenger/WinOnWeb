/** Uploaded file bytes live separately from the generated C: drive skeleton. */
export interface ExplorerUpload {
  path: string;
  blob: Blob;
  modifiedText: string;
}

let connection: Promise<IDBDatabase> | undefined;

function openUploads(): Promise<IDBDatabase> {
  if (!connection) {
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('winonweb-explorer-uploads', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          connection = undefined;
        };
        resolve(db);
      };
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

export async function saveUpload(record: ExplorerUpload, replace = false): Promise<void> {
  const db = await openUploads();
  const tx = db.transaction('files', 'readwrite');
  const files = tx.objectStore('files');
  const key = record.path.toLowerCase();
  if (replace) files.put(record, key);
  else files.add(record, key);
  await completed(tx);
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
