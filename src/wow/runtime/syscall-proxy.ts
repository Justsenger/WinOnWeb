import { ERROR, type Capability } from '../contracts';
import { permissions, type Method, type Methods } from '../contracts/wire';
import { fault } from './transport';
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 4096;
const optional = (v: unknown) => v === undefined || text(v);
const validators: Record<Method, (p: Record<string, unknown>) => boolean> = {
  'fs.pickOpen': (p) =>
    optional(p.initialPath) &&
    (p.extensions === undefined ||
      (Array.isArray(p.extensions) && p.extensions.length <= 64 && p.extensions.every(text))),
  'fs.pickSave': (p) => optional(p.initialPath) && optional(p.defaultFileName),
  'fs.listDir': (p) => text(p.path),
  'fs.readFile': (p) => text(p.path),
  'fs.writeFile': (p) => text(p.path) && typeof p.content === 'string',
  'storage.get': (p) => text(p.key),
  'storage.set': (p) => text(p.key) && Object.hasOwn(p, 'value'),
  'storage.remove': (p) => text(p.key),
  'storage.clear': (p) => !Object.keys(p).length,
  'notify.show': (p) => text(p.title) && optional(p.body),
  'hw.getSnapshot': (p) => !Object.keys(p).length,
  'hw.refresh': (p) => !Object.keys(p).length,
  'shell.openFile': (p) => text(p.path),
  'shell.openApp': (p) => text(p.appId) && (p.args === undefined || object(p.args)),
  'window.title': (p) => text(p.title),
  'window.control': (p) =>
    ['minimize', 'maximize', 'restore', 'close', 'focus'].includes(String(p.action)) &&
    typeof p.action === 'string',
  'app.send': (p) => text(p.instanceId) && text(p.channel),
  'app.call': (p) => text(p.instanceId) && text(p.method),
  'app.event': (p) => text(p.channel),
  'data.open': (p) => text(p.instanceId),
};
export type Syscalls = {
  [K in Method]: (params: Methods[K], ports: readonly MessagePort[], signal: AbortSignal) => unknown;
};
export function syscallProxy(methods: Syscalls, authorize: (cap: Capability) => Promise<boolean>) {
  return async (name: string, params: unknown, ports: readonly MessagePort[], signal: AbortSignal) => {
    if (!Object.hasOwn(validators, name)) throw fault(ERROR.unknown, '未知方法');
    const method = name as Method;
    if (!object(params) || !validators[method](params) || ports.length !== (method === 'data.open' ? 1 : 0))
      throw fault(ERROR.invalid, '无效方法参数');
    const cap = permissions[method];
    if (cap && !(await authorize(cap))) throw fault(ERROR.denied, '未声明或未获授权的能力: ' + cap);
    signal.throwIfAborted();
    return methods[method](params as never, ports, signal);
  };
}

// A built-in can retain a method reference across an await. Validate its owner at invocation time.
export function scopedApi<T extends object>(api: T, assertLive: () => void): T {
  for (const key of Object.keys(api) as (keyof T)[]) {
    const method = api[key];
    if (typeof method === 'function') {
      Object.defineProperty(api, key, {
        value: (...args: unknown[]) => {
          assertLive();
          return Reflect.apply(method, api, args);
        },
      });
    }
  }
  return api;
}
