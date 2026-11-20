import { observeInputRelease } from '../../wow/hal/platform';
import { hasDatabase } from '../../wow/hal/storage';
import { recoverPackages } from '../../wow/kernel/package-security';
import { configureWinDesktopHost, getWinDesktopHostConfig, type WinDesktopHostConfig } from './host-config';
import { refreshGrants } from './shell/permissions';
import { refreshRegistry, subscribeRegistry } from './shell/registry';
import { type WinAppLaunchArgs } from './types';
import { createDesktopContext } from './shell/desktop-context';
import { createContextMenu } from './shell/context-menu';
import { createLockScreen } from './shell/lock-screen';
import { createDesktopSurface } from './shell/desktop-surface';
import { createWindowCompositor } from './shell/window-compositor';
import { createTaskbar } from './shell/taskbar';
import { createFlyouts } from './shell/flyouts';
export interface WinDesktopRuntimeApi {
  launchApp: (appId: string, launchArgs?: WinAppLaunchArgs) => string | null;
  sendToInstance: (instanceId: string, channel: string, payload?: unknown) => void;
  subscribeAppEvents: (
    appId: string,
    listener: (channel: string, payload: unknown, pid: number) => void,
  ) => () => void;
}

export async function initWin11Desktop(
  root: HTMLElement,
  hostConfig?: WinDesktopHostConfig,
): Promise<WinDesktopRuntimeApi> {
  if (hostConfig) {
    configureWinDesktopHost(hostConfig);
  }
  if (hasDatabase()) {
    await Promise.all([refreshRegistry(), refreshGrants()]);
    void recoverPackages().catch(console.error);
  }
  const context = createDesktopContext(root);
  const {
    store,
    virtualStorage,
    sendToInstance,
    subscribeAppEvents,
    applyDesktopScale,
    getViewport,
    renderWallpaper,
    renderOverlays,
    launchShellItem,
    syncAppBroadcasts,
  } = context;
  const menus = createContextMenu(context);
  const { closeContextMenu } = menus;
  const lockController = createLockScreen(context);
  const { renderDesktopIcons, triggerDesktopRefresh } = createDesktopSurface(context, menus);
  const { renderWindows } = createWindowCompositor(context, menus);
  const { renderTaskbar, updateClock } = createTaskbar(context, menus);
  const { renderStartMenu, renderQuickSettings, renderCalendarFlyout, renderTrayOverflow } = createFlyouts(
    context,
    lockController,
  );
  function renderAll() {
    renderWallpaper();
    renderOverlays();
    renderDesktopIcons();
    renderWindows();
    renderTaskbar();
    renderStartMenu();
    renderQuickSettings();
    renderCalendarFlyout();
    renderTrayOverflow();
    syncAppBroadcasts();
  }

  document.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('[data-context-menu]')) {
      closeContextMenu();
    }
    const insideFlyout =
      target.closest('[data-start-menu]') ||
      target.closest('[data-quick-settings]') ||
      target.closest('[data-calendar-flyout]') ||
      target.closest('[data-tray-overflow]') ||
      target.closest('[data-taskbar]');
    if (!insideFlyout) {
      store.closeFlyouts();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_' || e.key === '0')
    ) {
      e.preventDefault();
      return;
    }
    if (lockController.isLocked() && lockController.handleKeyDown(e)) {
      return;
    }
    if (e.altKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      lockController.showLock('locked');
      return;
    }
    if (e.key === 'Escape') {
      closeContextMenu();
      store.closeFlyouts();
    } else if (e.key === 'F5' && !e.ctrlKey) {
      e.preventDefault();
      triggerDesktopRefresh();
    } else if (
      e.key === 'Enter' &&
      store.state.selectedIconIds.length === 1 &&
      !document.activeElement?.matches('input')
    ) {
      launchShellItem(store.state.selectedIconIds[0]);
    }
  });

  document.addEventListener('fullscreenchange', () => {
    renderDesktopIcons();
  });

  function handleViewportChange() {
    applyDesktopScale();
    store.constrainWindowsToViewport(getViewport());
    renderDesktopIcons();
  }

  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('orientationchange', () => {
    handleViewportChange();
    window.setTimeout(handleViewportChange, 120);
  });
  window.visualViewport?.addEventListener('resize', handleViewportChange);

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => renderDesktopIcons()).observe(root);
  }

  // Bring iframe window to front and dismiss shell popups when user interacts inside an embedded app
  window.addEventListener('focus', () => context.processes.focus.focus(store.state.activeWid));
  observeInputRelease((reason) => context.processes.focus.release(reason));
  window.addEventListener('blur', () => {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLIFrameElement)) return;
      const winEl = active.closest<HTMLElement>('.w11-window');
      if (!winEl) return;
      closeContextMenu();
      store.closeFlyouts();
      store.focusWindow(Number(winEl.dataset.wid));
    }, 0);
  });

  applyDesktopScale();
  store.subscribe(renderAll);
  subscribeRegistry(() => {
    store.syncWithRegistry();
    renderAll();
  });
  void virtualStorage.restoreDriveDStatus();
  updateClock();
  window.setInterval(updateClock, 1000);
  renderAll();

  const bootAppId = getWinDesktopHostConfig().bootAppId;
  if (bootAppId) {
    store.openApp(bootAppId, getViewport());
  }

  const runtimeApi: WinDesktopRuntimeApi = {
    launchApp: (id, args) => {
      const wid = launchShellItem(id, args);
      return store.state.windows.find((w) => w.wid === wid)?.instanceId ?? null;
    },
    sendToInstance,
    subscribeAppEvents,
  };
  (root as HTMLElement & { __winOnWebApi?: WinDesktopRuntimeApi }).__winOnWebApi = runtimeApi;
  root.dispatchEvent(new CustomEvent('winonweb:ready', { detail: runtimeApi, bubbles: true }));
  return runtimeApi;
}
