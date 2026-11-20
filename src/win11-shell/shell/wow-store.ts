import { unzipSync } from 'fflate';
import type { WinAppManifest } from '../types';

const DB_NAME = 'win11-web-shell:wow-apps:v1';
const DB_VERSION = 2;
const FILES_STORE = 'files';
const META_STORE = 'apps';
const SERVICE_WORKER_URL = '/wow-apps-sw.js?runtime=3';

export interface WowPackageManifest {
  format: number;
  id: string;
  name: string;
  version?: string;
  description?: string;
  icon?: string;
  entry?: string;
  runtime?: 'iframe';
  permissions?: string[];
  window?: { width?: number; height?: number; minWidth?: number; minHeight?: number };
}

export interface InstalledWowPackage {
  manifest: WowPackageManifest;
  installedAt: string;
  fileCount: number;
  size: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILES_STORE)) db.createObjectStore(FILES_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开 WOW 应用存储'));
  });
}

// The desktop may be outside the packaged apps' service worker scope.
const iconUrls = new Map<string, Promise<string>>();

export function getWowIconUrl(id: string, path: string): Promise<string> {
  const key = id + ':' + path;
  const cached = iconUrls.get(key);
  if (cached) return cached;
  const pending = openDb().then(async (db) => {
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        const request = db.transaction(FILES_STORE).objectStore(FILES_STORE).get(key);
        request.onsuccess = () => request.result?.data ? resolve(request.result.data) : reject(new Error('安装包缺少图标'));
        request.onerror = () => reject(request.error);
      });
      const extension = path.split('.').pop()?.toLowerCase() ?? '';
      const mime: Record<string, string> = { png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', ico: 'image/x-icon', gif: 'image/gif' };
      return URL.createObjectURL(blob.slice(0, blob.size, mime[extension] || blob.type));
    } finally {
      db.close();
    }
  });
  iconUrls.set(key, pending);
  pending.catch(() => { if (iconUrls.get(key) === pending) iconUrls.delete(key); });
  return pending;
}

function clearIconUrls(id: string) {
  for (const [key, pending] of iconUrls) {
    if (!key.startsWith(id + ':')) continue;
    iconUrls.delete(key);
    void pending.then((url) => URL.revokeObjectURL(url), () => {});
  }
}

function cleanPath(raw: string): string | null {
  const value = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!value || value.startsWith('/') || value.split('/').some((part) => part === '..')) return null;
  return value;
}

function cleanId(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 64);
}

function toAppManifest(pack: WowPackageManifest): WinAppManifest {
  const id = cleanId(pack.id);
  const entry = cleanPath(pack.entry ?? 'index.html') ?? 'index.html';
  const permissions = Array.isArray(pack.permissions) ? pack.permissions.filter((v): v is string => typeof v === 'string') : [];
  return {
    id,
    name: pack.name.trim(),
    iconKey: pack.icon ? `wow:${id}:${cleanPath(pack.icon) ?? 'icon.svg'}` : 'survivalcraft',
    description: pack.description?.trim() || `${pack.name.trim()} WOW 应用`,
    category: 'game',
    runtime: 'iframe',
    onDesktop: true,
    pinnedToStart: true,
    pinnedToTaskbar: false,
    singleton: true,
    window: {
      defaultWidth: pack.window?.width ?? 1100,
      defaultHeight: pack.window?.height ?? 700,
      minWidth: pack.window?.minWidth ?? 800,
      minHeight: pack.window?.minHeight ?? 520,
    },
    iframe: {
      entryUrl: `/wow-apps/${id}/${entry}`,
      allow: 'fullscreen; gamepad; autoplay; pointer-lock',
      passShellQuery: false,
    },
    capabilities: ['theme', 'volume', 'focus', 'visibility', 'window-control', ...permissions].filter(
      (v, index, all) => all.indexOf(v) === index,
    ) as WinAppManifest['capabilities'],
    source: 'user',
    telemetry: { publisher: 'WOW 应用包', version: pack.version, estimatedMemMb: 180 },
  };
}

export async function ensureWowServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) throw new Error('当前浏览器不支持应用包运行所需的 Service Worker');
  let registration: ServiceWorkerRegistration;
  try {
    // The narrow scope is enough for packaged apps and works on browsers that
    // reject broad root-scope registrations on LAN origins.
    registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/wow-apps/' });
  } catch (error) {
    try {
      registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' });
    } catch {
      const detail = error instanceof Error && error.message ? `：${error.message}` : '';
      throw new Error(`无法注册 WOW 应用服务。内网 HTTPS 需要浏览器信任站点证书，本机也可通过 localhost 的 HTTP 服务访问。${detail}`);
    }
  }
  const worker = registration.installing || registration.waiting || registration.active;
  if (worker?.state === 'activated') {
    worker.postMessage({ type: 'wow-sync' });
    return;
  }
  await new Promise<void>((resolve, reject) => {
    if (!worker) {
      reject(new Error('WOW 应用服务工作线程未能启动'));
      return;
    }
    const onStateChange = () => {
      if (worker.state === 'activated') {
        worker.removeEventListener('statechange', onStateChange);
        resolve();
      } else if (worker.state === 'redundant') {
        worker.removeEventListener('statechange', onStateChange);
        reject(new Error('WOW 应用服务工作线程已失效'));
      }
    };
    worker.addEventListener('statechange', onStateChange);
    onStateChange();
  });
  registration.active?.postMessage({ type: 'wow-sync' });
}

export async function installWowPackage(bytes: ArrayBuffer): Promise<{ manifest: WinAppManifest; package: InstalledWowPackage }> {
  const files = unzipSync(new Uint8Array(bytes));
  const manifestBytes = files['manifest.json'];
  if (!manifestBytes) throw new Error('WOW 包缺少 manifest.json');
  let pack: WowPackageManifest;
  try {
    pack = JSON.parse(new TextDecoder().decode(manifestBytes)) as WowPackageManifest;
  } catch {
    throw new Error('WOW 包的 manifest.json 格式错误');
  }
  const id = cleanId(pack.id);
  if (pack.format !== 1 || !id || !pack.name?.trim()) throw new Error('WOW 包清单无效');
  pack.id = id;
  const appManifest = toAppManifest(pack);
  const entry = cleanPath(pack.entry ?? 'index.html') ?? 'index.html';
  if (!files[entry]) throw new Error(`WOW 包缺少入口文件 ${entry}`);

  await ensureWowServiceWorker();
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction([FILES_STORE, META_STORE], 'readwrite');
      const fileStore = tx.objectStore(FILES_STORE);
      const metaStore = tx.objectStore(META_STORE);
      const prefix = `${id}:`;
      const cursorRequest = fileStore.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          for (const [rawPath, data] of Object.entries(files)) {
            const path = cleanPath(rawPath);
            if (!path) continue;
            fileStore.put({ key: `${prefix}${path}`, appId: id, path, data: new Blob([data]) });
          }
          metaStore.put({
            id,
            manifest: pack,
            installedAt: new Date().toISOString(),
            fileCount: Object.keys(files).length,
            size: bytes.byteLength,
          } satisfies InstalledWowPackage);
          return;
        }
        if (String(cursor.key).startsWith(prefix)) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('保存 WOW 应用失败'));
      tx.onabort = () => reject(tx.error ?? new Error('保存 WOW 应用被中止'));
    } catch (error) {
      reject(error instanceof Error ? error : new Error('保存 WOW 应用失败'));
    }
  });
  db.close();
  clearIconUrls(id);
  return {
    manifest: appManifest,
    package: {
      manifest: pack,
      installedAt: new Date().toISOString(),
      fileCount: Object.keys(files).length,
      size: bytes.byteLength,
    },
  };
}

export async function uninstallWowPackage(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([FILES_STORE, META_STORE], 'readwrite');
    const store = tx.objectStore(FILES_STORE);
    const prefix = `${cleanId(id)}:`;
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (String(cursor.key).startsWith(prefix)) cursor.delete();
      cursor.continue();
    };
    tx.objectStore(META_STORE).delete(cleanId(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('删除 WOW 应用失败'));
  });
  db.close();
  clearIconUrls(id);
}
