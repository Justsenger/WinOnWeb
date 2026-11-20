const STORAGE_KEY = 'win11-web-shell:app-kv:v1';
const MAX_APP_BYTES = 256 * 1024;

type AllAppKvMap = Record<string, Record<string, unknown>>;

function readStore(): AllAppKvMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as AllAppKvMap) : {};
  } catch {
    return {};
  }
}

function writeStore(map: AllAppKvMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore quota errors on lightweight C: origin storage
  }
}

export function createIsolatedAppStorage(appId: string) {
  function get<T = unknown>(key: string): T | undefined {
    const map = readStore();
    const ns = map[appId];
    if (!ns || !Object.prototype.hasOwnProperty.call(ns, key)) return undefined;
    try {
      return structuredClone(ns[key]) as T;
    } catch {
      return ns[key] as T;
    }
  }

  function set(key: string, value: unknown): void {
    const map = readStore();
    const ns = { ...(map[appId] ?? {}), [key]: value };
    const serialized = JSON.stringify(ns);
    if (serialized.length > MAX_APP_BYTES) {
      throw new Error(`应用 ${appId} 私有配置区超出 256 KB 限额。`);
    }
    map[appId] = JSON.parse(serialized) as Record<string, unknown>;
    writeStore(map);
  }

  function remove(key: string): void {
    const map = readStore();
    const ns = map[appId];
    if (!ns || !Object.prototype.hasOwnProperty.call(ns, key)) return;
    delete ns[key];
    map[appId] = ns;
    writeStore(map);
  }

  function clear(): void {
    const map = readStore();
    if (Object.prototype.hasOwnProperty.call(map, appId)) {
      delete map[appId];
      writeStore(map);
    }
  }

  function keys(): string[] {
    const ns = readStore()[appId];
    return ns ? Object.keys(ns) : [];
  }

  return { get, set, remove, clear, keys };
}

export function purgeAppStorage(appId: string): void {
  createIsolatedAppStorage(appId).clear();
}
