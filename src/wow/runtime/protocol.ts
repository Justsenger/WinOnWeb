import {
  ERROR,
  MAX_PENDING,
  WOW_PROTOCOL,
  type FileResult,
  type DirectoryEntry,
  type HardwareSummary,
} from '../contracts';
import type { BootInfo, ClientEvents, Methods, Method } from '../contracts/wire';
import { connectPort, fault, type Peer } from './transport';
export { WOW_PROTOCOL };
export interface ClientOptions {
  shellOrigin?: string;
  onInit?: (info: BootInfo) => void;
  onThemeChange?: (theme: 'light' | 'dark') => void;
  onEvent?: <K extends keyof ClientEvents>(name: K, value: ClientEvents[K]) => void;
  onAppRequest?: (method: string, payload: unknown, from: string, signal: AbortSignal) => unknown;
  onDataPort?: (port: MessagePort, from: string) => void;
}
export function createWowClient(options: ClientOptions = {}) {
  const isEmbedded = parent !== window;
  const origin =
    options.shellOrigin ?? (document.referrer ? new URL(document.referrer).origin : location.origin);
  const documentId = crypto.randomUUID();
  let peer: Peer | undefined,
    generation = '',
    instanceId = '';
  let waiting = 0,
    destroyed = false;
  const listeners = new Set<() => void>();
  const dataPorts = new Set<MessagePort>();
  function track(port: MessagePort) {
    dataPorts.add(port);
    const close = port.close.bind(port);
    port.close = () => {
      dataPorts.delete(port);
      close();
    };
    return port;
  }
  function handshake(e: MessageEvent) {
    const d = e.data;
    if (
      destroyed ||
      e.source !== parent ||
      e.origin !== origin ||
      d?.protocol !== WOW_PROTOCOL ||
      typeof d.generation !== 'string' ||
      typeof d.instanceId !== 'string'
    )
      return;
    if (d.type === 'challenge') {
      if (peer && d.generation === generation) return;
      peer?.close();
      peer = undefined;
      generation = d.generation;
      instanceId = d.instanceId;
      parent.postMessage(
        { protocol: WOW_PROTOCOL, type: 'hello', instanceId, generation, documentId },
        origin,
      );
    } else if (
      d.type === 'connected' &&
      !peer &&
      d.documentId === documentId &&
      d.generation === generation &&
      d.instanceId === instanceId &&
      e.ports.length === 1
    ) {
      peer = connectPort(
        e.ports[0],
        (method, p, _, signal) => {
          if (method !== 'app.invoke' || !options.onAppRequest) throw fault(ERROR.unknown, '无协同处理器');
          const args = p as { method: string; payload: unknown; from: string };
          return options.onAppRequest(args.method, args.payload, args.from, signal);
        },
        (name, value, ports) => {
          if (name === 'init') {
            const boot = value as BootInfo;
            options.onInit?.(boot);
            options.onThemeChange?.(boot.theme);
          }
          if (name === 'theme') options.onThemeChange?.(value as 'light' | 'dark');
          if (name === 'data' && ports[0]) {
            if (options.onDataPort) options.onDataPort(track(ports[0]), (value as { from: string }).from);
            else ports[0].close();
          }
          options.onEvent?.(name as keyof ClientEvents, value as ClientEvents[keyof ClientEvents]);
        },
        () => {
          peer = undefined;
          for (const port of dataPorts) port.close();
        },
      );
      listeners.forEach((fn) => fn());
    }
  }
  function destroy() {
    destroyed = true;
    peer?.close();
    listeners.forEach((fn) => fn());
    window.removeEventListener('message', handshake);
    window.removeEventListener('pagehide', destroy);
  }
  if (isEmbedded) {
    window.addEventListener('message', handshake);
    window.addEventListener('pagehide', destroy);
    parent.postMessage({ protocol: WOW_PROTOCOL, type: 'knock' }, origin);
  }
  async function request<T>(
    method: Method,
    params: Methods[Method] = {},
    opts: { timeout?: number; signal?: AbortSignal; transfer?: Transferable[] } = {},
  ) {
    if (opts.signal?.aborted) throw fault(ERROR.cancelled, '请求已取消');
    if (!isEmbedded || destroyed) throw fault(ERROR.revoked, '未连接桌面');
    if (!peer) {
      if (waiting >= MAX_PENDING) throw fault(ERROR.busy, '握手队列已满');
      waiting++;
      try {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            listeners.delete(done);
            opts.signal?.removeEventListener('abort', abort);
          };
          const done = () => {
            cleanup();
            resolve();
          };
          const abort = () => {
            cleanup();
            reject(fault(ERROR.cancelled, '请求已取消'));
          };
          const timer = setTimeout(
            () => {
              cleanup();
              reject(fault(ERROR.timeout, '桌面握手超时'));
            },
            Math.min(5000, opts.timeout ?? 5000),
          );
          opts.signal?.addEventListener('abort', abort, { once: true });
          listeners.add(done);
        });
      } finally {
        waiting--;
      }
    }
    if (!peer) throw fault(ERROR.revoked, '端口已吊销');
    return peer.request<T>(method, params, opts);
  }
  return {
    isEmbedded,
    destroy,
    request,
    openApp: (appId: string, args?: Record<string, unknown>) =>
      request<string | null>('shell.openApp', { appId, args }),
    openFile: (path: string) => request('shell.openFile', { path }),
    setTitle: (title: string) => request('window.title', { title }),
    windowControl: (action: Methods['window.control']['action']) => request('window.control', { action }),
    readFile: (path: string) => request<FileResult>('fs.readFile', { path }),
    writeFile: (path: string, content: string) =>
      request<Omit<FileResult, 'content'>>('fs.writeFile', { path, content }),
    listDir: (path: string) => request<DirectoryEntry[]>('fs.listDir', { path }),
    pickOpenFile: (opts: Methods['fs.pickOpen'] = {}) =>
      request<FileResult | null>('fs.pickOpen', opts, { timeout: 180000 }),
    pickSaveFile: (opts: Methods['fs.pickSave'] = {}) =>
      request<{ name: string; path: string } | null>('fs.pickSave', opts, { timeout: 180000 }),
    kvSet: (key: string, value: unknown) => request('storage.set', { key, value }),
    kvGet: <T>(key: string) => request<T>('storage.get', { key }),
    notify: (spec: Methods['notify.show']) => request('notify.show', spec),
    getHwSnapshot: () => request<HardwareSummary>('hw.getSnapshot'),
    sendToApp: (instanceId: string, channel: string, payload?: unknown) =>
      request('app.send', { instanceId, channel, payload }),
    callApp: <T = unknown>(instanceId: string, method: string, payload?: unknown) =>
      request<T>('app.call', { instanceId, method, payload }),
    connectData: async (instanceId: string) => {
      const channel = new MessageChannel();
      try {
        await request('data.open', { instanceId }, { transfer: [channel.port2] });
        return track(channel.port1);
      } catch (error) {
        channel.port1.close();
        channel.port2.close();
        throw error;
      }
    },
  };
}
