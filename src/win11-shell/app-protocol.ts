import type { VirtualHardwareSnapshot } from './system/virtual-hardware';
import type {
  PickedFileResult,
  PickedSaveTarget,
  ThemeMode,
  VfsEntryInfo,
  WinAppLaunchArgs,
  WinNotificationSpec,
} from './types';

export const WIN11_APP_PROTOCOL = 'win11-app/v1' as const;

export type Win11WindowControlAction = 'minimize' | 'maximize' | 'restore' | 'close';

export type Win11RpcMethod =
  | 'fs.pickOpen'
  | 'fs.pickSave'
  | 'fs.listDir'
  | 'fs.readFile'
  | 'fs.writeFile'
  | 'storage.get'
  | 'storage.set'
  | 'storage.remove'
  | 'storage.clear'
  | 'notify.show'
  | 'hw.getSnapshot'
  | 'hw.refresh'
  | 'shell.openFile'
  | 'shell.openApp'
  | 'app.send'
  | 'app.call';

export interface Win11RpcError {
  code: string;
  message: string;
}

export type Win11ShellToAppMessage =
  | {
      protocol: typeof WIN11_APP_PROTOCOL;
      type: 'w11:init';
      pid: number;
      appId: string;
      theme: ThemeMode;
      volume: number;
      muted: boolean;
      focused: boolean;
      minimized: boolean;
      launchArgs?: WinAppLaunchArgs;
      hardware?: VirtualHardwareSnapshot;
    }
  | {
      protocol: typeof WIN11_APP_PROTOCOL;
      type: 'w11:theme';
      theme: ThemeMode;
    }
  | {
      protocol: typeof WIN11_APP_PROTOCOL;
      type: 'w11:volume';
      volume: number;
      muted: boolean;
    }
  | {
      protocol: typeof WIN11_APP_PROTOCOL;
      type: 'w11:focus';
      focused: boolean;
    }
  | {
      protocol: typeof WIN11_APP_PROTOCOL;
      type: 'w11:visibility';
      minimized: boolean;
    }
  | {
      protocol: typeof WIN11_APP_PROTOCOL;
      type: 'w11:hardware';
      hardware: VirtualHardwareSnapshot;
    }
  | {
      protocol: typeof WIN11_APP_PROTOCOL;
      type: 'w11:app-message';
      channel: string;
      payload?: unknown;
      fromAppId?: string;
    }
  | {
      protocol: typeof WIN11_APP_PROTOCOL;
      type: 'w11:rpc-response';
      requestId: string;
      ok: boolean;
      result?: unknown;
      error?: Win11RpcError;
    }
  | {
      protocol: typeof WIN11_APP_PROTOCOL;
      type: 'w11:app-rpc-call';
      requestId: string;
      fromAppId: string;
      method: string;
      payload?: unknown;
    };

export type Win11AppToShellMessage =
  | {
      protocol: typeof WIN11_APP_PROTOCOL;
      type: 'w11:ready';
    }
  | {
      protocol: typeof WIN11_APP_PROTOCOL;
      type: 'w11:set-title';
      title: string;
    }
  | {
      protocol: typeof WIN11_APP_PROTOCOL;
      type: 'w11:focus-self';
    }
  | {
      protocol: typeof WIN11_APP_PROTOCOL;
      type: 'w11:window-control';
      action: Win11WindowControlAction;
    }
  | {
      protocol: typeof WIN11_APP_PROTOCOL;
      type: 'w11:open-app';
      appId: string;
      args?: WinAppLaunchArgs;
    }
  | {
      protocol: typeof WIN11_APP_PROTOCOL;
      type: 'w11:request-hardware';
      force?: boolean;
    }
  | {
      protocol: typeof WIN11_APP_PROTOCOL;
      type: 'w11:app-event';
      channel: string;
      payload?: unknown;
    }
  | {
      protocol: typeof WIN11_APP_PROTOCOL;
      type: 'w11:rpc-request';
      requestId: string;
      method: Win11RpcMethod;
      params?: unknown;
    }
  | {
      protocol: typeof WIN11_APP_PROTOCOL;
      type: 'w11:app-rpc-reply';
      requestId: string;
      ok: boolean;
      result?: unknown;
      error?: Win11RpcError;
    };

const VALID_SHELL_MESSAGE_TYPES = new Set([
  'w11:init',
  'w11:theme',
  'w11:volume',
  'w11:focus',
  'w11:visibility',
  'w11:hardware',
  'w11:app-message',
  'w11:rpc-response',
  'w11:app-rpc-call',
]);

const VALID_APP_MESSAGE_TYPES = new Set([
  'w11:ready',
  'w11:set-title',
  'w11:focus-self',
  'w11:window-control',
  'w11:open-app',
  'w11:request-hardware',
  'w11:app-event',
  'w11:rpc-request',
  'w11:app-rpc-reply',
]);

export function isWin11ShellToAppMessage(data: unknown): data is Win11ShellToAppMessage {
  if (!data || typeof data !== 'object') return false;
  const candidate = data as { protocol?: unknown; type?: unknown };
  return (
    candidate.protocol === WIN11_APP_PROTOCOL &&
    typeof candidate.type === 'string' &&
    VALID_SHELL_MESSAGE_TYPES.has(candidate.type)
  );
}

export function isWin11AppToShellMessage(data: unknown): data is Win11AppToShellMessage {
  if (!data || typeof data !== 'object') return false;
  const candidate = data as { protocol?: unknown; type?: unknown };
  return (
    candidate.protocol === WIN11_APP_PROTOCOL &&
    typeof candidate.type === 'string' &&
    VALID_APP_MESSAGE_TYPES.has(candidate.type)
  );
}

export interface Win11AppBootQuery {
  theme: ThemeMode | null;
  volume: number | null;
  appId: string | null;
  pid: number | null;
}

export function readWin11BootQuery(search: string): Win11AppBootQuery {
  const params = new URLSearchParams(search);
  const rawTheme = params.get('theme');
  const rawVolume = params.get('volume');
  const rawPid = params.get('pid');
  const parsedVol = rawVolume !== null ? Number(rawVolume) : Number.NaN;
  const parsedPid = rawPid !== null ? Number(rawPid) : Number.NaN;

  return {
    theme: rawTheme === 'light' || rawTheme === 'dark' ? rawTheme : null,
    volume: Number.isFinite(parsedVol) ? Math.max(0, Math.min(100, parsedVol)) : null,
    appId: params.get('appId'),
    pid: Number.isFinite(parsedPid) ? parsedPid : null,
  };
}

export interface Win11AppClientOptions {
  shellOrigin?: string;
  autoReady?: boolean;
  onInit?: (payload: Extract<Win11ShellToAppMessage, { type: 'w11:init' }>) => void;
  onThemeChange?: (theme: ThemeMode) => void;
  onVolumeChange?: (volume: number, muted: boolean) => void;
  onFocusChange?: (focused: boolean) => void;
  onVisibilityChange?: (minimized: boolean) => void;
  onHardwareUpdate?: (hardware: VirtualHardwareSnapshot) => void;
  onAppMessage?: (channel: string, payload: unknown, fromAppId?: string) => void;
  onAppRequest?: (method: string, payload: unknown, fromAppId: string) => unknown | Promise<unknown>;
}

export interface Win11AppClient {
  readonly isEmbedded: boolean;
  readonly bootQuery: Win11AppBootQuery;
  ready(): void;
  setTitle(title: string): void;
  focusSelf(): void;
  windowControl(action: Win11WindowControlAction): void;
  openApp(appId: string, args?: WinAppLaunchArgs): void;
  openFile(path: string): Promise<number | null>;
  requestHardware(force?: boolean): void;
  getHwSnapshot(): Promise<VirtualHardwareSnapshot>;
  refreshHwSnapshot(): Promise<VirtualHardwareSnapshot>;
  pickOpenFile(opts?: { extensions?: string[]; initialPath?: string }): Promise<PickedFileResult | null>;
  pickSaveFile(opts?: { defaultFileName?: string; initialPath?: string }): Promise<PickedSaveTarget | null>;
  listDir(path: string): Promise<VfsEntryInfo[]>;
  readFile(path: string): Promise<PickedFileResult>;
  writeFile(path: string, content: string): Promise<{ path: string; name: string; sizeBytes: number }>;
  kvGet<T = unknown>(key: string): Promise<T | undefined>;
  kvSet(key: string, value: unknown): Promise<void>;
  kvRemove(key: string): Promise<void>;
  notify(spec: WinNotificationSpec): Promise<boolean>;
  sendToApp(targetAppId: string, channel: string, payload?: unknown): Promise<boolean>;
  callApp<T = unknown>(targetAppId: string, method: string, payload?: unknown, timeoutMs?: number): Promise<T>;
  emitEvent(channel: string, payload?: unknown): void;
  destroy(): void;
}

export function createWin11AppClient(options: Win11AppClientOptions = {}): Win11AppClient {
  const isEmbedded = typeof window !== 'undefined' && window.parent !== window;
  const targetOrigin =
    options.shellOrigin ?? (typeof window !== 'undefined' ? window.location.origin : '*');
  const bootQuery = readWin11BootQuery(typeof window !== 'undefined' ? window.location.search : '');
  let rpcSeq = 1;
  const pendingRpc = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (err: Error) => void; timer: number }
  >();

  if (bootQuery.theme) {
    options.onThemeChange?.(bootQuery.theme);
  }
  if (bootQuery.volume !== null) {
    options.onVolumeChange?.(bootQuery.volume, bootQuery.volume === 0);
  }

  function postToShell(message: Win11AppToShellMessage) {
    if (!isEmbedded) return;
    try {
      window.parent.postMessage(message, targetOrigin);
    } catch {
      // Ignore detached or cross-origin postMessage errors.
    }
  }

  function sendRpc<T = unknown>(method: Win11RpcMethod, params?: unknown, timeoutMs = 45000): Promise<T> {
    if (!isEmbedded) {
      return Promise.reject(new Error('当前未运行在 WinOnWeb 桌面环境中。'));
    }
    const requestId = `rpc-${Date.now()}-${rpcSeq++}`;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingRpc.delete(requestId);
        reject(new Error(`系统调用 ${method} 超时`));
      }, timeoutMs);
      pendingRpc.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      postToShell({
        protocol: WIN11_APP_PROTOCOL,
        type: 'w11:rpc-request',
        requestId,
        method,
        params,
      });
    });
  }

  function handleMessage(event: MessageEvent) {
    if (!isEmbedded || event.source !== window.parent) return;
    if (targetOrigin !== '*' && event.origin !== targetOrigin) return;

    const data = event.data;
    if (isWin11ShellToAppMessage(data)) {
      switch (data.type) {
        case 'w11:init':
          options.onInit?.(data);
          options.onThemeChange?.(data.theme);
          options.onVolumeChange?.(data.volume, data.muted);
          options.onFocusChange?.(data.focused);
          options.onVisibilityChange?.(data.minimized);
          if (data.hardware) options.onHardwareUpdate?.(data.hardware);
          break;
        case 'w11:theme':
          options.onThemeChange?.(data.theme);
          break;
        case 'w11:volume':
          options.onVolumeChange?.(data.volume, data.muted);
          break;
        case 'w11:focus':
          options.onFocusChange?.(data.focused);
          break;
        case 'w11:visibility':
          options.onVisibilityChange?.(data.minimized);
          break;
        case 'w11:hardware':
          options.onHardwareUpdate?.(data.hardware);
          break;
        case 'w11:app-message':
          options.onAppMessage?.(data.channel, data.payload, data.fromAppId);
          break;
        case 'w11:rpc-response': {
          const entry = pendingRpc.get(data.requestId);
          if (!entry) return;
          pendingRpc.delete(data.requestId);
          window.clearTimeout(entry.timer);
          if (data.ok) entry.resolve(data.result);
          else entry.reject(new Error(data.error?.message ?? data.error?.code ?? 'RPC failed'));
          break;
        }
        case 'w11:app-rpc-call': {
          if (!options.onAppRequest) {
            postToShell({
              protocol: WIN11_APP_PROTOCOL,
              type: 'w11:app-rpc-reply',
              requestId: data.requestId,
              ok: false,
              error: { code: 'NOT_HANDLED', message: '应用未注册协同请求处理器。' },
            });
            return;
          }
          Promise.resolve(options.onAppRequest(data.method, data.payload, data.fromAppId))
            .then((result) =>
              postToShell({
                protocol: WIN11_APP_PROTOCOL,
                type: 'w11:app-rpc-reply',
                requestId: data.requestId,
                ok: true,
                result,
              }),
            )
            .catch((err) =>
              postToShell({
                protocol: WIN11_APP_PROTOCOL,
                type: 'w11:app-rpc-reply',
                requestId: data.requestId,
                ok: false,
                error: { code: 'HANDLER_ERROR', message: err instanceof Error ? err.message : String(err) },
              }),
            );
          break;
        }
      }
      return;
    }

    if (
      data &&
      typeof data === 'object' &&
      (data as { type?: unknown }).type === 'w11-theme' &&
      ((data as { theme?: unknown }).theme === 'dark' || (data as { theme?: unknown }).theme === 'light')
    ) {
      options.onThemeChange?.((data as { theme: ThemeMode }).theme);
    }
  }

  if (typeof window !== 'undefined' && isEmbedded) {
    window.addEventListener('message', handleMessage);
    if (options.autoReady !== false) {
      postToShell({ protocol: WIN11_APP_PROTOCOL, type: 'w11:ready' });
    }
  }

  return {
    isEmbedded,
    bootQuery,
    ready: () => postToShell({ protocol: WIN11_APP_PROTOCOL, type: 'w11:ready' }),
    setTitle: (title) => postToShell({ protocol: WIN11_APP_PROTOCOL, type: 'w11:set-title', title }),
    focusSelf: () => postToShell({ protocol: WIN11_APP_PROTOCOL, type: 'w11:focus-self' }),
    windowControl: (action) => postToShell({ protocol: WIN11_APP_PROTOCOL, type: 'w11:window-control', action }),
    openApp: (appId, args) => postToShell({ protocol: WIN11_APP_PROTOCOL, type: 'w11:open-app', appId, args }),
    openFile: (path) => sendRpc<number | null>('shell.openFile', { path }),
    requestHardware: (force) => postToShell({ protocol: WIN11_APP_PROTOCOL, type: 'w11:request-hardware', force }),
    getHwSnapshot: () => sendRpc<VirtualHardwareSnapshot>('hw.getSnapshot'),
    refreshHwSnapshot: () => sendRpc<VirtualHardwareSnapshot>('hw.refresh'),
    pickOpenFile: (opts) => sendRpc<PickedFileResult | null>('fs.pickOpen', opts, 180000),
    pickSaveFile: (opts) => sendRpc<PickedSaveTarget | null>('fs.pickSave', opts, 180000),
    listDir: (path) => sendRpc<VfsEntryInfo[]>('fs.listDir', { path }),
    readFile: (path) => sendRpc<PickedFileResult>('fs.readFile', { path }),
    writeFile: (path, content) => sendRpc('fs.writeFile', { path, content }),
    kvGet: (key) => sendRpc('storage.get', { key }),
    kvSet: (key, value) => sendRpc('storage.set', { key, value }),
    kvRemove: (key) => sendRpc('storage.remove', { key }),
    notify: (spec) => sendRpc<boolean>('notify.show', spec),
    sendToApp: (targetAppId, channel, payload) => sendRpc<boolean>('app.send', { targetAppId, channel, payload }),
    callApp: <T = unknown>(targetAppId: string, method: string, payload?: unknown, timeoutMs = 15000) =>
      sendRpc<T>('app.call', { targetAppId, method, payload, timeoutMs }, timeoutMs + 2000),
    emitEvent: (channel, payload) => postToShell({ protocol: WIN11_APP_PROTOCOL, type: 'w11:app-event', channel, payload }),
    destroy: () => {
      pendingRpc.forEach((p) => {
        window.clearTimeout(p.timer);
        p.reject(new Error('客户端已销毁'));
      });
      pendingRpc.clear();
      if (typeof window !== 'undefined') {
        window.removeEventListener('message', handleMessage);
      }
    },
  };
}
