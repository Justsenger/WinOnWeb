import { scopedApi } from '../../../wow/runtime/syscall-proxy';
import { isHostFullscreen, toggleHostFullscreen } from '../../../wow/hal/platform';
import { createProcessManager, ControlBus, Telemetry } from '../../../wow/kernel';
import { executeCommandApp } from '../apps';
import type { DeviceProbeReport } from '../../../wow/hal/capabilities';
import { getWinDesktopHostConfig } from '../host-config';
import { createIsolatedAppStorage, purgeAppStorage } from './app-storage';
import { openSystemFileDialog } from './system-dialogs';
import { getAppIconSvg } from './icons';
import { createPermissionManager, refreshGrants, subject } from './permissions';
import {
  getAppRegistry,
  getFileAssociations,
  getManifestById,
  installUserApp,
  resolveAppForFile,
  setFileAssociation,
  subscribeRegistry,
  uninstallUserApp,
} from './registry';
import { createShellStore } from './store';
import {
  hasAppCapability,
  type DesktopIconSize,
  type PickedFileResult,
  type PickedSaveTarget,
  type WinAppCapability,
  type WinAppLaunchArgs,
  type WinAppLifecycle,
  type WinAppManifest,
  type WinAppShellApi,
} from '../types';
import { createRuntimeResources } from '../../../wow/hal/runtime-primitives';
import { createVirtualHardwareService } from '../../../wow/hal/hardware';
import { createVirtualStorageService } from '../system/virtual-storage';
import { createWallpaper } from './wallpaper';
import { createDesktopLayout } from './desktop-surface';
export interface MountedWindowApp {
  authorize?: (capability: WinAppCapability) => Promise<boolean>;
  pid: number;
  appId: string;
  manifest: WinAppManifest;
  lifecycle: WinAppLifecycle;
  unbind?: () => void;
  lastFocused: boolean;
  lastMinimized: boolean;
}

export function createDesktopContext(root: HTMLElement) {
  const mountedApps = new Map<number, MountedWindowApp>();
  const processes = createProcessManager((wid, reason) =>
    mountedApps.get(wid)?.lifecycle.onInputRelease?.(reason),
  );
  const bus = new ControlBus<AbortSignal>();
  const store = createShellStore(processes);
  const {
    applyDesktopScale,
    getShellMetrics,
    getViewport,
    toShellCoords,
    getMaxGridRows,
    getMaxGridCols,
    resolveVisibleIconCell,
  } = createDesktopLayout(root);
  const { renderWallpaper, renderOverlays } = createWallpaper(root, store, (theme) =>
    mountedApps.forEach((entry) => entry.lifecycle.onThemeChange?.(theme)),
  );

  const desktopAreaEl = root.querySelector<HTMLElement>('[data-desktop-area]')!;
  const iconsLayerEl = root.querySelector<HTMLElement>('[data-icons-layer]')!;
  const marqueeEl = root.querySelector<HTMLElement>('[data-marquee]')!;
  const windowsLayerEl = root.querySelector<HTMLElement>('[data-windows-layer]')!;
  const snapPreviewEl = root.querySelector<HTMLElement>('[data-snap-preview]')!;
  const taskbarEl = root.querySelector<HTMLElement>('[data-taskbar]')!;
  const taskbarAppsEl = root.querySelector<HTMLElement>('[data-taskbar-apps]')!;
  const startMenuEl = root.querySelector<HTMLElement>('[data-start-menu]')!;
  const startSearchEl = root.querySelector<HTMLInputElement>('[data-start-search]')!;
  const startGridEl = root.querySelector<HTMLElement>('[data-start-grid]')!;
  const quickSettingsEl = root.querySelector<HTMLElement>('[data-quick-settings]')!;
  const calendarFlyoutEl = root.querySelector<HTMLElement>('[data-calendar-flyout]')!;
  const trayOverflowEl = root.querySelector<HTMLElement>('[data-tray-overflow]')!;
  const contextMenuEl = root.querySelector<HTMLElement>('[data-context-menu]')!;
  const clockTimeEl = root.querySelector<HTMLElement>('[data-clock-time]')!;
  const clockDateEl = root.querySelector<HTMLElement>('[data-clock-date]')!;
  const imeBtnEl = root.querySelector<HTMLElement>('[data-ime-btn]')!;

  let lastRenderedVolume: number = store.state.volume;
  let lastPrefsSignature: string | null = null;
  let lastWindowsSignature: string | null = null;
  const runtime = createRuntimeResources();
  const virtualHw = createVirtualHardwareService(processes.snapshot);
  const telemetry = new Telemetry(virtualHw.subscribe);
  const systemResources = runtime.attach(0);
  const virtualStorage = createVirtualStorageService({
    resources: systemResources,
    getDesktopShortcuts: () => getWinDesktopHostConfig().desktopShortcuts ?? [],
  });
  const permManager = createPermissionManager(root);
  let virtualHwUnsub: (() => void) | null = null;
  let initialHwProbeStarted = false;
  let toastStackEl: HTMLElement | null = null;

  function showDesktopToast(sourceName: string, title: string, body?: string) {
    if (!toastStackEl) {
      toastStackEl = document.createElement('div');
      toastStackEl.className = 'w11-toast-stack';
      root.appendChild(toastStackEl);
    }
    const card = document.createElement('div');
    card.className = 'w11-toast-card';
    card.innerHTML = `
      <div class="w11-toast-head">
        <span>${escapeHtml(sourceName)}</span>
        <button type="button" class="w11-toast-x" aria-label="关闭通知">✕</button>
      </div>
      <div class="w11-toast-title">${escapeHtml(title)}</div>
      ${body ? `<div class="w11-toast-body">${escapeHtml(body)}</div>` : ''}
    `;
    const remove = () => card.remove();
    card.querySelector('.w11-toast-x')?.addEventListener('click', remove);
    toastStackEl.appendChild(card);
    window.setTimeout(remove, 4200);
  }

  function hasGrantedHardwareCapability(entry: MountedWindowApp): boolean {
    if (!hasAppCapability(entry.manifest, 'hardware-probe')) return false;
    if (!processes.allows(entry.pid, 'hardware-probe')) return false;
    const explicit = permManager.listPermissionGrants()[entry.appId]?.['hardware-probe'];
    if (explicit === 'granted') return true;
    if (explicit === 'denied') return false;
    return Boolean(entry.manifest.systemTrusted);
  }

  function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const windowElements = new Map<number, HTMLElement>();
  const appEventListeners = new Map<string, Set<(channel: string, payload: unknown, pid: number) => void>>();

  function syncVirtualHardwareSubscription() {
    let needsHw = false;
    mountedApps.forEach((entry) => {
      if (entry.lifecycle.onHardwareUpdate && hasGrantedHardwareCapability(entry)) {
        needsHw = true;
      }
    });

    if (needsHw && !virtualHwUnsub) {
      virtualHwUnsub = telemetry.subscribe((snapshot) => {
        mountedApps.forEach((entry) => {
          if (entry.lifecycle.onHardwareUpdate && hasGrantedHardwareCapability(entry)) {
            entry.lifecycle.onHardwareUpdate?.(snapshot);
          }
        });
      });
      if (!initialHwProbeStarted) {
        initialHwProbeStarted = true;
        void virtualHw.refreshProbe();
      }
    } else if (!needsHw && virtualHwUnsub) {
      virtualHwUnsub();
      virtualHwUnsub = null;
    }
  }

  function sendToInstance(instanceId: string, channel: string, payload?: unknown) {
    bus.route(instanceId).message(channel, payload, 'host');
  }
  function subscribeAppEvents(
    instanceId: string,
    listener: (channel: string, payload: unknown, pid: number) => void,
  ): () => void {
    let set = appEventListeners.get(instanceId);
    if (!set) {
      set = new Set();
      appEventListeners.set(instanceId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  async function runHardwareProbe(force = false): Promise<DeviceProbeReport> {
    const snap = await virtualHw.refreshProbe(force);
    const report = virtualHw.getProbeReport();
    if (report) {
      mountedApps.forEach((entry) => {
        if (hasGrantedHardwareCapability(entry)) entry.lifecycle.onHardwareReport?.(report);
      });
    }
    return (
      report ?? {
        timestamp: snap.timestamp,
        context: {
          origin: window.location.origin,
          isSecureContext: window.isSecureContext,
          language: navigator.language,
          languages: navigator.languages,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          userAgent: navigator.userAgent,
          platformLegacy: navigator.platform,
        },
        cpu: { hardwareConcurrency: snap.cpu.logicalCores, computePressureSupport: false },
        memory: { deviceMemoryGiB: snap.memory.realDeviceGb ?? 'unknown' },
        gpu: { webgpuSupported: false },
        display: snap.display ?? {
          screenResolution: '',
          availableScreen: '',
          viewport: '',
          devicePixelRatio: 1,
          colorDepth: 24,
          orientation: 'unknown',
          hdrSupported: false,
          p3GamutSupported: false,
          maxTouchPoints: 0,
          coarsePointer: false,
        },
        battery: snap.battery ?? 'unknown',
        network: { onLine: snap.network.onLine, sessionResourcesCount: 0, sessionTransferKB: 0 },
        storage: snap.storage.probe ?? {
          supported: false,
          isSecureContext: window.isSecureContext,
          quotaBytes: null,
          usageBytes: null,
          quotaGiB: null,
          quotaGB: null,
          usageMB: null,
          usageDetails: null,
          persisted: null,
          opfsSupported: false,
          opfsReady: null,
          fsAccessSupported: false,
        },
        peripheralsAndApis: snap.peripheralsAndApis ?? {},
      }
    );
  }

  function toggleDesktopFullscreen() {
    void toggleHostFullscreen(root).catch(() => {});
  }

  function createBoundShellApi(
    callerManifest: WinAppManifest | undefined,
    resources?: ReturnType<typeof runtime.attach>,
    instanceId = 'host',
    wid?: number,
  ): WinAppShellApi {
    const manifest: WinAppManifest = callerManifest ?? {
      id: '__shell__',
      name: '桌面外壳',
      iconKey: 'start',
      description: 'Shell',
      category: 'system',
      runtime: 'builtin',
      systemTrusted: true,
      capabilities: [
        'theme',
        'volume',
        'virtual-fs',
        'hardware-probe',
        'notifications',
        'shell-control',
        'app-messaging',
      ],
    };
    const identity = subject(manifest);
    function assertLive() {
      resources?.assertLive();
      if (wid !== undefined && !processes.focus.get(wid))
        throw Object.assign(Error('窗口已关闭'), { code: 'REVOKED' });
    }
    async function authorize(capability: WinAppCapability) {
      assertLive();
      if (resources && !processes.allows(resources.pid, capability)) return false;
      const granted = await permManager.ensurePermission(manifest, capability);
      assertLive();
      return granted;
    }
    async function assertCap(capability: WinAppCapability) {
      if (!(await authorize(capability)))
        throw Object.assign(Error('缺少权限: ' + capability), { code: 'PERMISSION_DENIED' });
    }
    function requireSystemComponent() {
      assertLive();
      if (
        callerManifest &&
        !(manifest.source === 'core' && manifest.runtime === 'builtin' && manifest.systemTrusted)
      )
        throw Object.assign(Error('需要受信系统组件权限'), { code: 'PERMISSION_DENIED' });
    }
    const kv = createIsolatedAppStorage(identity);
    const storage = scopedApi<typeof virtualStorage>(
      {
        ...virtualStorage,
        openBinaryFile: (path) => virtualStorage.openBinaryFile(path, resources),
        createWriter: (path) => virtualStorage.createWriter(path, resources),
        openTextFile: (path) => virtualStorage.openTextFile(path, resources),
        readTextFile: (path) => virtualStorage.readTextFile(path, resources),
        writeTextFile: (path, content) => virtualStorage.writeTextFile(path, content, resources),
        importFile: (parent, file) => virtualStorage.importFile(parent, file, resources),
        createEntryInNode: (parent, kind, name) =>
          virtualStorage.createEntryInNode(parent, kind, name, resources),
      },
      assertLive,
    );

    return scopedApi<WinAppShellApi>(
      {
        getTheme: () => store.state.theme,
        setTheme: (theme) => store.setTheme(theme),
        getVolume: () => store.state.volume,
        setVolume: (value) => store.setVolume(value),
        getBrightness: () => store.state.brightness,
        setBrightness: (value) => store.setBrightness(value),
        getIconSize: () => store.state.iconSize,
        setIconSize: (size) => store.setIconSize(size, getMaxGridRows(size)),
        resetDesktopLayout: () => store.resetDesktopLayout(),
        getMachineName: () => getWinDesktopHostConfig().machineName || 'WINONWEB-PC',
        getHostBootAppId: () => getWinDesktopHostConfig().bootAppId ?? null,
        getStartupHostItems: () => getWinDesktopHostConfig().startupItems ?? [],
        getInstalledApps: () => getAppRegistry(),
        getAppManifest: (appId) => getManifestById(appId),
        renderAppIcon: (iconKey, size) => getAppIconSvg(iconKey, size),
        getAppUsageHistory: store.getAppUsageHistory,
        clearAppUsageHistory: store.clearAppUsageHistory,
        getWindows: () => store.state.windows,
        openApp: (appId, args) => launchShellItem(appId, args),
        terminateProcess: (pid) => {
          requireSystemComponent();
          return store.terminateProcess(pid);
        },
        getProcesses: processes.list,
        closeWindow: (pid) => store.closeWindow(pid),
        focusWindow: (pid) => store.focusWindow(pid),
        minimizeWindow: (pid) => store.minimizeWindow(pid),
        toggleMaximizeWindow: (pid) => store.toggleMaximizeWindow(pid, getViewport()),
        setWindowTitle: (pid, title) => store.setWindowTitle(pid, title),
        isFullscreen: isHostFullscreen,
        toggleFullscreen: () => toggleDesktopFullscreen(),
        getVirtualStorage: () => storage,
        getVirtualHardware: () => virtualHw.getSnapshot(),
        refreshVirtualHardware: async (force) => {
          await assertCap('hardware-probe');
          const snap = await virtualHw.refreshProbe(force);
          syncVirtualHardwareSubscription();
          return snap;
        },
        refreshVirtualStorage: () =>
          virtualStorage.requestPersistence().then(() => virtualHw.refreshStorage()),
        getHardwareReport: () => virtualHw.getProbeReport(),
        refreshHardwareReport: async (force) => {
          await assertCap('hardware-probe');
          return runHardwareProbe(force);
        },
        openFile: async (path) => {
          const cleanName = path.split('\\').pop() ?? path;
          const targetApp = resolveAppForFile(cleanName);
          if (!targetApp) {
            showDesktopToast(
              '桌面内核',
              `未关联文件类型：${cleanName}`,
              '可在“应用中心 -> 文件默认打开方式”中配置对应软件。',
            );
            return null;
          }
          return launchShellItem(targetApp, { openPath: path });
        },
        listVirtualDirectory: async (path) => {
          await assertCap('virtual-fs');
          return virtualStorage.listDirectory(path);
        },
        openVirtualFile: async (path) => {
          await assertCap('virtual-fs');
          return storage.openTextFile(path);
        },
        readVirtualFile: async (path) => {
          await assertCap('virtual-fs');
          return storage.readTextFile(path);
        },
        writeVirtualFile: async (path, content, signal) => {
          await assertCap('virtual-fs');
          signal?.throwIfAborted();
          return virtualStorage.writeTextFile(path, content, resources, signal);
        },
        showOpenFileDialog: async (opts, signal) => {
          await assertCap('virtual-fs');
          return (await openSystemFileDialog(root, storage, {
            mode: 'open',
            signal,
            extensions: opts?.extensions,
            initialPath: opts?.initialPath,
          })) as PickedFileResult | null;
        },
        showSaveFileDialog: async (opts, signal) => {
          await assertCap('virtual-fs');
          return (await openSystemFileDialog(root, storage, {
            mode: 'save',
            signal,
            defaultFileName: opts?.defaultFileName,
            initialPath: opts?.initialPath,
          })) as PickedSaveTarget | null;
        },
        getAppData: (key) => kv.get(key),
        setAppData: (key, value) => kv.set(key, value),
        removeAppData: (key) => kv.remove(key),
        clearAppData: () => kv.clear(),
        showNotification: async (spec) => {
          await assertCap('notifications');
          showDesktopToast(manifest.name, spec.title, spec.body);
          return true;
        },
        sendToApp: async (targetInstanceId, channel, payload) => {
          await assertCap('app-messaging');
          bus.route(targetInstanceId).message(channel, payload, instanceId);
          return true;
        },
        callApp: async (targetInstanceId, method, payload, timeoutMs = 12000, signal) => {
          await assertCap('app-messaging');
          signal?.throwIfAborted();
          const target = bus.route(targetInstanceId);
          let timerId = 0;
          return Promise.race([
            Promise.resolve(target.call(method, payload, instanceId, signal)),
            new Promise((_, reject) => {
              timerId = window.setTimeout(
                () => reject(new Error(`协同请求 ${targetInstanceId}.${method} 超时`)),
                timeoutMs,
              );
            }),
          ]).finally(() => {
            if (timerId) window.clearTimeout(timerId);
          });
        },
        ensurePermission: async (capability) => {
          const ok = await authorize(capability);
          if (ok && capability === 'hardware-probe') syncVirtualHardwareSubscription();
          return ok;
        },
        listPermissionGrants: () => permManager.listPermissionGrants(),
        setPermissionDecision: async (appId, capability, decision) => {
          requireSystemComponent();
          await permManager.setPermissionDecision(appId, capability, decision);
          syncVirtualHardwareSubscription();
        },
        installUserApp: (nextManifest) => {
          requireSystemComponent();
          return installUserApp(nextManifest);
        },
        uninstallUserApp: async (appId) => {
          requireSystemComponent();
          const removed = await uninstallUserApp(appId);
          if (removed) {
            await refreshGrants();
            purgeAppStorage(appId);
          }
          return removed;
        },
        getFileAssociations: () => getFileAssociations(),
        setFileAssociation: (ext, appId) => setFileAssociation(ext, appId),
        subscribeRegistry: (listener) => subscribeRegistry(listener),
      },
      assertLive,
    );
  }

  const shellApi = createBoundShellApi(undefined);

  function launchShellItem(appId: string, launchArgs?: WinAppLaunchArgs): number | null {
    const manifest = getManifestById(appId);
    if (!manifest) return null;
    store.closeFlyouts();
    if (manifest.runtime === 'command') {
      executeCommandApp(appId, shellApi, launchArgs);
      return null;
    }
    return store.openApp(appId, getViewport(), launchArgs);
  }

  function syncAppBroadcasts() {
    if (lastRenderedVolume !== store.state.volume) {
      lastRenderedVolume = store.state.volume;
      mountedApps.forEach((entry) => {
        entry.lifecycle.onVolumeChange?.(store.state.volume);
      });
    }

    const prefsSig = `${store.state.theme}|${store.state.iconSize}|${store.state.autoArrange}|${store.state.alignToGrid}`;
    if (lastPrefsSignature !== prefsSig) {
      lastPrefsSignature = prefsSig;
      mountedApps.forEach((entry) => {
        entry.lifecycle.onShellPrefsChange?.();
      });
    }

    const winSig = store.state.windows.map((w) => `${w.wid}:${w.minimized ? 1 : 0}:${w.title}`).join('|');
    if (lastWindowsSignature !== winSig) {
      lastWindowsSignature = winSig;
      mountedApps.forEach((entry) => {
        entry.lifecycle.onWindowsChanged?.();
      });
    }
  }

  return {
    processes,
    bus,
    store,
    desktopAreaEl,
    iconsLayerEl,
    marqueeEl,
    windowsLayerEl,
    snapPreviewEl,
    taskbarEl,
    taskbarAppsEl,
    startMenuEl,
    startSearchEl,
    startGridEl,
    quickSettingsEl,
    calendarFlyoutEl,
    trayOverflowEl,
    contextMenuEl,
    clockTimeEl,
    clockDateEl,
    imeBtnEl,
    virtualStorage,
    escapeHtml,
    windowElements,
    mountedApps,
    appEventListeners,
    syncVirtualHardwareSubscription,
    sendToInstance,
    subscribeAppEvents,
    applyDesktopScale,
    getShellMetrics,
    getViewport,
    toShellCoords,
    getMaxGridRows,
    getMaxGridCols,
    resolveVisibleIconCell,
    renderWallpaper,
    renderOverlays,
    createBoundShellApi,
    launchShellItem,
    syncAppBroadcasts,
    root,
  };
}
export type DesktopContext = ReturnType<typeof createDesktopContext>;
