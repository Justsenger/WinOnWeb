import { ensureWowServiceWorker } from '../shell/wow-store';
import {
  isWin11AppToShellMessage,
  WIN11_APP_PROTOCOL,
  type Win11RpcError,
  type Win11ShellToAppMessage,
} from '../app-protocol';
import {
  hasAppCapability,
  type ThemeMode,
  type WinAppHostContext,
  type WinAppHostHooks,
  type WinAppLifecycle,
  type WinAppLaunchArgs,
  type WinNotificationSpec,
} from '../types';

function buildIframeSrc(ctx: WinAppHostContext): string {
  const iframeSpec = ctx.manifest.iframe;
  if (!iframeSpec) return 'about:blank';

  const rawUrl = iframeSpec.entryUrl;
  const shouldPassQuery = iframeSpec.passShellQuery !== false && rawUrl.startsWith('/');
  if (!shouldPassQuery) return rawUrl;

  const url = new URL(rawUrl, window.location.origin);
  url.searchParams.set('theme', ctx.shell.getTheme());
  url.searchParams.set('volume', String(ctx.shell.getVolume()));
  url.searchParams.set('appId', ctx.appId);
  url.searchParams.set('pid', String(ctx.pid));
  return `${url.pathname}${url.search}${url.hash}`;
}

function resolveExpectedOrigin(entryUrl: string): string {
  try {
    return new URL(entryUrl, window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
}

export function mountIframeApp(
  ctx: WinAppHostContext,
  hooks: WinAppHostHooks = {},
): WinAppLifecycle {
  const { container, manifest, pid, appId, shell } = ctx;
  const iframeSpec = manifest.iframe;
  if (!iframeSpec) {
    return {};
  }

  const expectedOrigin = resolveExpectedOrigin(iframeSpec.entryUrl);
  const frame = document.createElement('iframe');
  frame.className = 'w11-win-iframe';
  frame.title = manifest.name;
  const packaged = expectedOrigin === location.origin && new URL(iframeSpec.entryUrl, location.href).pathname.startsWith('/wow-apps/');
  let destroyed = false;
  if (iframeSpec.allow) {
    frame.setAttribute('allow', iframeSpec.allow);
  }
  if (iframeSpec.sandbox) {
    frame.setAttribute('sandbox', iframeSpec.sandbox);
  }

  if (packaged) {
    ctx.resources.observeGuest(() => {
      // Resolve the current document on each sample; reload and navigation discard old resources.
      try {
        const guest = frame.contentWindow as (Window & Record<symbol, { snapshot(): { workers: number; handles: number } }>) | null;
        const counts = guest?.[Symbol.for('winonweb.guest-resources.v1')]?.snapshot();
        if (counts && Number.isSafeInteger(counts.workers) && counts.workers >= 0 &&
            Number.isSafeInteger(counts.handles) && counts.handles >= 0) return counts;
      } catch {
        return undefined;
      }
    });
  }

  const gameWindow = container.closest<HTMLElement>('.w11-window');
  const controls = gameWindow?.querySelector('.w11-win-controls');
  let fullscreenButton: HTMLButtonElement | undefined;
  function setWindowFullscreen(active: boolean) {
    if (!fullscreenButton) return;
    gameWindow?.classList.toggle('is-game-fullscreen', active);
    frame.toggleAttribute('data-wow-fullscreen', active);
    fullscreenButton.setAttribute('aria-pressed', String(active));
    fullscreenButton.title = active ? '退出窗口全屏' : '窗口全屏';
    fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
    // Installed packages share the WOW origin.
    frame.contentWindow?.dispatchEvent(new Event('wow-window-fullscreen-change'));
  }
  if (packaged && manifest.category === 'game' && controls) {
    fullscreenButton = document.createElement('button');
    fullscreenButton.type = 'button';
    fullscreenButton.className = 'w11-win-ctrl w11-game-fullscreen';
    fullscreenButton.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="M2 6V2h4m4 0h4v4m0 4v4h-4m-4 0H2v-4"/></svg>';
    controls.prepend(fullscreenButton);
    setWindowFullscreen(false);
    fullscreenButton.onclick = () => setWindowFullscreen(!frame.hasAttribute('data-wow-fullscreen'));
    frame.addEventListener('wow-window-fullscreen', event => setWindowFullscreen((event as CustomEvent).detail === true));
  }

  let loaded = false;
  let ready = false;
  let lastFocused = true;
  let lastMinimized = false;
  let appRpcSeq = 1;
  const pendingMessages: Array<{ channel: string; payload: unknown; fromAppId?: string }> = [];
  const pendingAppCalls = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (err: Error) => void; timer: number }
  >();

  function postToFrame(message: Win11ShellToAppMessage) {
    if (!frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage(message, expectedOrigin);
    } catch {
      // Ignore cross-origin or detached iframe errors.
    }
  }

  function postLegacyTheme(theme: ThemeMode) {
    if (!frame.contentWindow || expectedOrigin !== window.location.origin) return;
    try {
      frame.contentWindow.postMessage({ type: 'w11-theme', theme }, expectedOrigin);
    } catch {
      // Ignore detached iframe errors.
    }
  }

  function canStreamHardwareWithoutPrompt(): boolean {
    if (!hasAppCapability(manifest, 'hardware-probe')) return false;
    if (manifest.systemTrusted) return true;
    return shell.listPermissionGrants()[manifest.id]?.['hardware-probe'] === 'granted';
  }

  function sendInit() {
    const win = shell.getWindows().find((w) => w.pid === pid);
    const volume = shell.getVolume();
    postToFrame({
      protocol: WIN11_APP_PROTOCOL,
      type: 'w11:init',
      pid,
      appId,
      theme: shell.getTheme(),
      volume,
      muted: volume === 0,
      focused: lastFocused,
      minimized: win?.minimized ?? lastMinimized,
      launchArgs: ctx.launchArgs,
      ...(canStreamHardwareWithoutPrompt() ? { hardware: shell.getVirtualHardware() } : {}),
    });
  }

  function flushPendingMessages() {
    if (!frame.contentWindow || pendingMessages.length === 0) return;
    const queued = pendingMessages.splice(0, pendingMessages.length);
    queued.forEach(({ channel, payload, fromAppId }) => {
      postToFrame({
        protocol: WIN11_APP_PROTOCOL,
        type: 'w11:app-message',
        channel,
        payload,
        fromAppId,
      });
    });
  }

  async function executeRpc(method: string, params: unknown): Promise<unknown> {
    const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
    switch (method) {
      case 'fs.pickOpen':
        return shell.showOpenFileDialog({
          extensions: Array.isArray(p.extensions) ? (p.extensions as string[]) : undefined,
          initialPath: typeof p.initialPath === 'string' ? p.initialPath : undefined,
        });
      case 'fs.pickSave':
        return shell.showSaveFileDialog({
          defaultFileName: typeof p.defaultFileName === 'string' ? p.defaultFileName : undefined,
          initialPath: typeof p.initialPath === 'string' ? p.initialPath : undefined,
        });
      case 'fs.listDir':
        return shell.listVirtualDirectory(String(p.path ?? '此电脑'));
      case 'fs.readFile':
        return shell.readVirtualFile(String(p.path ?? ''));
      case 'fs.writeFile':
        return shell.writeVirtualFile(String(p.path ?? ''), String(p.content ?? ''));
      case 'storage.get':
        return shell.getAppData(String(p.key ?? ''));
      case 'storage.set':
        shell.setAppData(String(p.key ?? ''), p.value);
        return true;
      case 'storage.remove':
        shell.removeAppData(String(p.key ?? ''));
        return true;
      case 'storage.clear':
        shell.clearAppData();
        return true;
      case 'notify.show':
        return shell.showNotification(p as unknown as WinNotificationSpec);
      case 'hw.getSnapshot': {
        const ok = await shell.ensurePermission('hardware-probe');
        if (!ok) throw Object.assign(new Error('用户拒绝或未声明硬件读取权限。'), { code: 'PERMISSION_DENIED' });
        return shell.getVirtualHardware();
      }
      case 'hw.refresh':
        return shell.refreshVirtualHardware(true);
      case 'shell.openFile':
        return shell.openFile(String(p.path ?? ''));
      case 'shell.openApp':
        return shell.openApp(String(p.appId ?? ''), p.args as WinAppLaunchArgs | undefined);
      case 'app.send':
        return shell.sendToApp(String(p.targetAppId ?? ''), String(p.channel ?? ''), p.payload);
      case 'app.call':
        return shell.callApp(
          String(p.targetAppId ?? ''),
          String(p.method ?? ''),
          p.payload,
          typeof p.timeoutMs === 'number' ? p.timeoutMs : undefined,
        );
      default:
        throw Object.assign(new Error(`未知系统调用方法：${method}`), { code: 'UNKNOWN_METHOD' });
    }
  }

  function onLoad() {
    loaded = true;
    sendInit();
    if (!ready && expectedOrigin !== window.location.origin) {
      flushPendingMessages();
    }
  }

  function onWindowMessage(event: MessageEvent) {
    if (!frame.contentWindow || event.source !== frame.contentWindow) return;
    if (event.origin !== expectedOrigin) return;

    const data = event.data;
    if (!isWin11AppToShellMessage(data)) return;

    switch (data.type) {
      case 'w11:ready':
        ready = true;
        sendInit();
        flushPendingMessages();
        break;
      case 'w11:focus-self':
        shell.focusWindow(pid);
        break;
      case 'w11:set-title':
        shell.setWindowTitle(pid, data.title);
        break;
      case 'w11:window-control':
        if (!hasAppCapability(manifest, 'window-control')) return;
        if (data.action === 'minimize') shell.minimizeWindow(pid);
        else if (data.action === 'maximize' || data.action === 'restore') shell.toggleMaximizeWindow(pid);
        else if (data.action === 'close') shell.closeWindow(pid);
        break;
      case 'w11:open-app':
        if (!hasAppCapability(manifest, 'shell-control')) return;
        shell.openApp(data.appId, data.args);
        break;
      case 'w11:request-hardware':
        void shell.ensurePermission('hardware-probe').then((allowed) => {
          if (!allowed) return;
          if (data.force) {
            void shell.refreshVirtualHardware(true).then((hardware) => {
              postToFrame({ protocol: WIN11_APP_PROTOCOL, type: 'w11:hardware', hardware });
            });
          } else {
            postToFrame({
              protocol: WIN11_APP_PROTOCOL,
              type: 'w11:hardware',
              hardware: shell.getVirtualHardware(),
            });
          }
        });
        break;
      case 'w11:app-event':
        if (!hasAppCapability(manifest, 'app-messaging')) return;
        hooks.onAppEvent?.(appId, pid, data.channel, data.payload);
        break;
      case 'w11:rpc-request': {
        void executeRpc(data.method, data.params)
          .then((result) => {
            postToFrame({
              protocol: WIN11_APP_PROTOCOL,
              type: 'w11:rpc-response',
              requestId: data.requestId,
              ok: true,
              result,
            });
          })
          .catch((err) => {
            const rpcErr: Win11RpcError = {
              code: (err as { code?: string })?.code ?? 'RPC_ERROR',
              message: err instanceof Error ? err.message : String(err),
            };
            postToFrame({
              protocol: WIN11_APP_PROTOCOL,
              type: 'w11:rpc-response',
              requestId: data.requestId,
              ok: false,
              error: rpcErr,
            });
          });
        break;
      }
      case 'w11:app-rpc-reply': {
        const entry = pendingAppCalls.get(data.requestId);
        if (!entry) return;
        pendingAppCalls.delete(data.requestId);
        window.clearTimeout(entry.timer);
        if (data.ok) entry.resolve(data.result);
        else entry.reject(new Error(data.error?.message ?? data.error?.code ?? '对端应用调用失败'));
        break;
      }
    }
  }

  frame.addEventListener('load', onLoad);
  window.addEventListener('message', onWindowMessage);
  function navigate() {
    if (destroyed) return;
    frame.src = buildIframeSrc(ctx);
    container.replaceChildren(frame);
  }
  if (packaged) {
    void ensureWowServiceWorker().then(navigate).catch(error => {
      if (!destroyed) container.textContent = error.message;
    });
  } else {
    navigate();
  }

  return {
    onThemeChange: (theme) => {
      if (!loaded && !ready) return;
      postToFrame({ protocol: WIN11_APP_PROTOCOL, type: 'w11:theme', theme });
      postLegacyTheme(theme);
    },
    onVolumeChange: (volume) => {
      if (!loaded && !ready) return;
      postToFrame({
        protocol: WIN11_APP_PROTOCOL,
        type: 'w11:volume',
        volume,
        muted: volume === 0,
      });
    },
    onFocusChange: (focused) => {
      lastFocused = focused;
      if (!loaded && !ready) return;
      postToFrame({ protocol: WIN11_APP_PROTOCOL, type: 'w11:focus', focused });
    },
    onVisibilityChange: (minimized) => {
      lastMinimized = minimized;
      if (minimized && frame.hasAttribute('data-wow-fullscreen')) setWindowFullscreen(false);
      if (!loaded && !ready) return;
      postToFrame({ protocol: WIN11_APP_PROTOCOL, type: 'w11:visibility', minimized });
    },
    onHardwareUpdate: (hardware) => {
      if (!canStreamHardwareWithoutPrompt()) return;
      if (!loaded && !ready) return;
      postToFrame({ protocol: WIN11_APP_PROTOCOL, type: 'w11:hardware', hardware });
    },
    onMessage: (channel, payload, fromAppId) => {
      if (!hasAppCapability(manifest, 'app-messaging')) return;
      if (!ready && !(loaded && expectedOrigin !== window.location.origin)) {
        pendingMessages.push({ channel, payload, fromAppId });
        return;
      }
      postToFrame({
        protocol: WIN11_APP_PROTOCOL,
        type: 'w11:app-message',
        channel,
        payload,
        fromAppId,
      });
    },
    onAppRequest: (method, payload, fromAppId) => {
      if (!ready && !loaded) {
        return Promise.reject(new Error(`应用 ${appId} 尚未就绪`));
      }
      const requestId = `appcall-${Date.now()}-${appRpcSeq++}`;
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pendingAppCalls.delete(requestId);
          reject(new Error(`向应用 ${appId} 发起协同调用 ${method} 超时`));
        }, 12000);
        pendingAppCalls.set(requestId, { resolve, reject, timer });
        postToFrame({
          protocol: WIN11_APP_PROTOCOL,
          type: 'w11:app-rpc-call',
          requestId,
          fromAppId,
          method,
          payload,
        });
      });
    },
    destroy: () => {
      destroyed = true;
      fullscreenButton?.remove();
      pendingAppCalls.forEach((p) => {
        window.clearTimeout(p.timer);
        p.reject(new Error('目标应用窗口已关闭'));
      });
      pendingAppCalls.clear();
      frame.removeEventListener('load', onLoad);
      window.removeEventListener('message', onWindowMessage);
      try {
        frame.src = 'about:blank';
      } catch {
        // Ignore teardown errors.
      }
    },
  };
}
