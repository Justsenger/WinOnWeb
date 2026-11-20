import { preferences } from '../../../wow/hal/storage';
const STORAGE_KEY = 'app-kv:v1';
const MAX_APP_BYTES = 256 * 1024;

export function createIsolatedAppStorage(appId: string) {
  const namespace = STORAGE_KEY + ':' + appId;
  function read(): Record<string, unknown> {
    const raw = preferences.getItem(namespace);
    return raw ? JSON.parse(raw) : {};
  }
  function save(data: Record<string, unknown>) {
    const json = JSON.stringify(data);
    if (new TextEncoder().encode(json).length > MAX_APP_BYTES) throw Error('应用私有存储超出 256 KiB 限额');
    preferences.setItem(namespace, json);
  }
  return {
    get<T = unknown>(key: string): T | undefined {
      const data = read();
      return Object.hasOwn(data, key) ? (data[key] as T) : undefined;
    },
    set(key: string, value: unknown) {
      save({ ...read(), [key]: value });
    },
    remove(key: string) {
      const data = read();
      delete data[key];
      save(data);
    },
    clear() {
      preferences.removeItem(namespace);
    },
  };
}
export const purgeAppStorage = (appId: string) => createIsolatedAppStorage(appId).clear();
