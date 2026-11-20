import { mountAppInstance } from '../apps';
import { getAppIconSvg, UI_ICONS } from './icons';
import { getManifestById } from './registry';
import { type SnapZone } from '../types';
import type { createContextMenu } from './context-menu';
import type { DesktopContext, MountedWindowApp } from './desktop-context';
export function createWindowCompositor(
  context: DesktopContext,
  { closeContextMenu }: ReturnType<typeof createContextMenu>,
) {
  const {
    processes,
    bus,
    store,
    windowsLayerEl,
    snapPreviewEl,
    escapeHtml,
    windowElements,
    mountedApps,
    appEventListeners,
    syncVirtualHardwareSubscription,
    getShellMetrics,
    getViewport,
    toShellCoords,
    createBoundShellApi,
    root,
  } = context;
  function renderWindows() {
    const activeSet = new Set(store.state.windows.map((w) => w.wid));
    for (const [wid, el] of windowElements.entries()) {
      if (!activeSet.has(wid)) {
        mountedApps.get(wid)?.unbind?.();
        mountedApps.get(wid)?.lifecycle.destroy?.();
        mountedApps.delete(wid);
        el.remove();
        windowElements.delete(wid);
      }
    }

    store.state.windows.forEach((win) => {
      let winEl = windowElements.get(win.wid);
      if (!winEl) {
        winEl = document.createElement('section');
        winEl.className = 'w11-window';
        winEl.dataset.wid = String(win.wid);
        winEl.dataset.pid = String(win.pid);
        winEl.dataset.instanceId = win.instanceId;
        winEl.dataset.app = win.appId;
        winEl.innerHTML = `
          <header class="w11-win-titlebar" data-win-drag="${win.wid}">
            <div class="w11-win-title">
              <span class="w11-win-title-icon">${getAppIconSvg(win.iconKey, 16)}</span>
              <span class="w11-win-title-text">${escapeHtml(win.title)}</span>
            </div>
            <div class="w11-win-controls">
              <button type="button" class="w11-win-ctrl" data-win-min="${win.wid}" aria-label="最小化">${UI_ICONS.minimize}</button>
              <button type="button" class="w11-win-ctrl" data-win-max="${win.wid}" aria-label="最大化">${UI_ICONS.maximize}</button>
              <button type="button" class="w11-win-ctrl is-close" data-win-close="${win.wid}" aria-label="关闭">${UI_ICONS.close}</button>
            </div>
          </header>
          <div class="w11-win-body" data-win-body="${win.wid}"></div>
          <div class="w11-resize-handle is-n" data-resize="n"></div>
          <div class="w11-resize-handle is-s" data-resize="s"></div>
          <div class="w11-resize-handle is-e" data-resize="e"></div>
          <div class="w11-resize-handle is-w" data-resize="w"></div>
          <div class="w11-resize-handle is-nw" data-resize="nw"></div>
          <div class="w11-resize-handle is-ne" data-resize="ne"></div>
          <div class="w11-resize-handle is-sw" data-resize="sw"></div>
          <div class="w11-resize-handle is-se" data-resize="se"></div>
        `;
        windowsLayerEl.appendChild(winEl);
        windowElements.set(win.wid, winEl);
      }

      const isActive = store.state.activeWid === win.wid;
      winEl.classList.toggle('is-active', isActive);
      winEl.classList.toggle('is-minimized', win.minimized);
      winEl.classList.toggle('is-maximized', win.maximized);
      winEl.classList.toggle('is-seamless-app', Boolean(win.seamlessTitlebar));
      winEl.classList.toggle('is-non-resizable', !win.resizable);

      winEl.style.left = `${win.x}px`;
      winEl.style.top = `${win.y}px`;
      winEl.style.width = `${win.width}px`;
      winEl.style.height = `${win.height}px`;
      winEl.style.zIndex = String(win.zIndex);

      const titleTextEl = winEl.querySelector<HTMLElement>('.w11-win-title-text');
      if (titleTextEl && titleTextEl.textContent !== win.title) {
        titleTextEl.textContent = win.title;
      }

      const maxBtn = winEl.querySelector<HTMLElement>(`[data-win-max="${win.wid}"]`);
      if (maxBtn) {
        maxBtn.hidden = !win.maximizable;
        maxBtn.innerHTML = win.maximized ? UI_ICONS.restore : UI_ICONS.maximize;
        maxBtn.setAttribute('aria-label', win.maximized ? '向下还原' : '最大化');
      }

      const bodyEl = winEl.querySelector<HTMLElement>(`[data-win-body="${win.wid}"]`);
      if (bodyEl) {
        if (!mountedApps.has(win.wid)) {
          if (win.background) {
            bodyEl.style.background = win.background;
          }
          const manifest = getManifestById(win.appId);
          if (manifest) {
            const resources = processes.scope(win.pid);
            const entry: MountedWindowApp = {
              pid: win.pid,
              appId: win.appId,
              manifest,
              lifecycle: {},
              lastFocused: isActive,
              lastMinimized: win.minimized,
            };
            const boundShell = createBoundShellApi(manifest, resources, win.instanceId, win.wid);
            entry.authorize = boundShell.ensurePermission;
            // A mount can synchronously update its title and re-enter renderWindows.
            mountedApps.set(win.wid, entry);
            const button = manifest.window?.fullscreen ? document.createElement('button') : null;
            function setFullscreen(active: boolean) {
              if (!button) return;
              winEl!.classList.toggle('is-game-fullscreen', active);
              button.setAttribute('aria-pressed', String(active));
              button.title = active ? '退出窗口全屏' : '窗口全屏';
              button.setAttribute('aria-label', button.title);
              entry.lifecycle.onFullscreenChange?.(active);
            }
            if (button) {
              button.type = 'button';
              button.className = 'w11-win-ctrl w11-game-fullscreen';
              button.innerHTML = UI_ICONS.maximize;
              button.onclick = () => setFullscreen(button.getAttribute('aria-pressed') !== 'true');
              winEl.querySelector('.w11-win-controls')?.prepend(button);
              setFullscreen(false);
            }
            try {
              entry.lifecycle = mountAppInstance(
                {
                  pid: win.pid,
                  wid: win.wid,
                  instanceId: win.instanceId,
                  appId: win.appId,
                  manifest,
                  container: bodyEl,
                  launchArgs: win.launchArgs,
                  resources,
                  shell: boundShell,
                },
                {
                  ownPort: (close) => processes.ownPort(win.pid, close),
                  setFullscreen,
                  isFocused: () => store.state.activeWid === win.wid,
                  releaseInput: () => {
                    if (store.state.activeWid === win.wid) processes.focus.release('disconnect');
                  },
                  connectData: async (id, port) => {
                    const target = store.state.windows.find((w) => w.instanceId === id);
                    if (!target || !processes.allows(target.pid, 'app-messaging'))
                      throw Error('目标实例未声明协同权限');
                    const targetApp = mountedApps.get(target.wid);
                    if (!targetApp || !(await targetApp.authorize?.('app-messaging')))
                      throw Error('目标实例未授予协同权限');
                    if (!processes.focus.get(win.wid) || targetApp !== mountedApps.get(target.wid))
                      throw Error('实例已断开');
                    const receive = targetApp.lifecycle.onDataPort;
                    if (!receive) throw Error('目标实例未注册数据通道');
                    receive(port, win.instanceId);
                  },
                  onAppEvent: (appId, pid, channel, payload) => {
                    appEventListeners.get(win.instanceId)?.forEach((fn) => fn(channel, payload, pid));
                  },
                },
              );
              if (mountedApps.get(win.wid) !== entry) entry.lifecycle.destroy?.();
              else {
                const unbind = bus.bind(win.instanceId, {
                  message: (channel, payload, from) => entry.lifecycle.onMessage?.(channel, payload, from),
                  call: (method, payload, from, signal) => {
                    if (!entry.lifecycle.onAppRequest) throw Error('目标实例未注册协同处理器');
                    return entry.lifecycle.onAppRequest(method, payload, from, signal);
                  },
                });
                entry.unbind = unbind;
              }
            } catch (error) {
              store.closeWindow(win.wid);
              mountedApps.delete(win.wid);
              throw error;
            }
          }
        } else {
          const mounted = mountedApps.get(win.wid)!;
          if (mounted.lastFocused !== isActive) {
            mounted.lastFocused = isActive;
            mounted.lifecycle.onFocusChange?.(isActive);
          }
          if (mounted.lastMinimized !== win.minimized) {
            if (win.minimized && winEl.classList.contains('is-game-fullscreen'))
              winEl.querySelector<HTMLButtonElement>('.w11-game-fullscreen')?.click();
            mounted.lastMinimized = win.minimized;
            mounted.lifecycle.onVisibilityChange?.(win.minimized);
          }
        }
      }
    });
    const taskManagerFillsShell = store.state.windows.some(
      (win) => win.appId === 'task-manager' && win.maximized && !win.minimized,
    );
    root.classList.toggle('is-task-manager-maximized', taskManagerFillsShell);
    syncVirtualHardwareSubscription();
  }

  function updateSnapOverlay(zone: SnapZone) {
    if (zone === 'none') {
      snapPreviewEl.classList.remove('is-visible');
      return;
    }
    const { width: vw, height } = getViewport();
    const vh = height - 48;
    snapPreviewEl.classList.add('is-visible');
    if (zone === 'maximize') {
      snapPreviewEl.style.left = '8px';
      snapPreviewEl.style.top = '8px';
      snapPreviewEl.style.width = `${vw - 16}px`;
      snapPreviewEl.style.height = `${vh - 16}px`;
    } else if (zone === 'left') {
      snapPreviewEl.style.left = '8px';
      snapPreviewEl.style.top = '8px';
      snapPreviewEl.style.width = `${Math.round(vw / 2) - 12}px`;
      snapPreviewEl.style.height = `${vh - 16}px`;
    } else {
      snapPreviewEl.style.left = `${Math.round(vw / 2) + 4}px`;
      snapPreviewEl.style.top = '8px';
      snapPreviewEl.style.width = `${Math.round(vw / 2) - 12}px`;
      snapPreviewEl.style.height = `${vh - 16}px`;
    }
  }

  windowsLayerEl.addEventListener('pointerdown', (e) => {
    closeContextMenu();
    const target = e.target as HTMLElement;
    const winEl = target.closest<HTMLElement>('.w11-window');
    if (!winEl) return;
    const wid = Number(winEl.dataset.wid);
    store.focusWindow(wid);

    if (
      winEl.classList.contains('is-game-fullscreen') ||
      target.closest('.w11-win-controls, [data-no-drag], input, button, select, textarea')
    )
      return;

    const resizeHandle = target.closest<HTMLElement>('.w11-resize-handle');
    if (resizeHandle) {
      const dir = resizeHandle.dataset.resize ?? '';
      const win = store.state.windows.find((w) => w.wid === wid);
      if (!win || win.maximized || !win.resizable) return;
      e.preventDefault();

      const startX = e.clientX;
      const startY = e.clientY;
      const orig = { x: win.x, y: win.y, w: win.width, h: win.height };
      const { width: workW, height: rawH } = getViewport();
      const workH = Math.max(280, rawH - 48);
      const minW = Math.min(win.minWidth, Math.max(240, workW - 24));
      const minH = Math.min(win.minHeight, Math.max(200, workH - 24));
      windowsLayerEl.classList.add('is-interacting');

      const onMove = (me: PointerEvent) => {
        const { scaleX, scaleY } = getShellMetrics();
        const dx = (me.clientX - startX) / scaleX;
        const dy = (me.clientY - startY) / scaleY;
        let { x, y, w, h } = orig;

        if (dir.includes('e')) w = Math.max(minW, orig.w + dx);
        if (dir.includes('s')) h = Math.max(minH, orig.h + dy);
        if (dir.includes('w')) {
          const nw = Math.max(minW, orig.w - dx);
          x = orig.x + (orig.w - nw);
          w = nw;
        }
        if (dir.includes('n')) {
          const nh = Math.max(minH, orig.h - dy);
          y = Math.max(0, orig.y + (orig.h - nh));
          h = nh;
        }

        win.x = x;
        win.y = y;
        win.width = w;
        win.height = h;
        winEl.style.left = `${x}px`;
        winEl.style.top = `${y}px`;
        winEl.style.width = `${w}px`;
        winEl.style.height = `${h}px`;
      };

      const onUp = () => {
        windowsLayerEl.classList.remove('is-interacting');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      return;
    }

    const dragBar = target.closest<HTMLElement>('[data-win-drag]');
    if (!dragBar || e.button !== 0) return;
    if (e.pointerType !== 'mouse') e.preventDefault();

    const win = store.state.windows.find((w) => w.wid === wid);
    if (!win) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let origX = win.x;
    let origY = win.y;
    let moved = false;
    let snapZone: SnapZone = 'none';

    const onMove = (me: PointerEvent) => {
      if (!moved && Math.hypot(me.clientX - startX, me.clientY - startY) < 4) return;
      if (!moved) {
        moved = true;
        windowsLayerEl.classList.add('is-interacting');
      }

      const localPtr = toShellCoords(me.clientX, me.clientY);
      const dx = (me.clientX - startX) / localPtr.scaleX;
      const dy = (me.clientY - startY) / localPtr.scaleY;
      const { width: vw, height } = getViewport();

      if (win.maximized) {
        const restoreW = win.restoreBounds?.width ?? 820;
        const restoreH = win.restoreBounds?.height ?? 520;
        const ratio = localPtr.x / Math.max(1, vw);
        win.maximized = false;
        win.width = restoreW;
        win.height = restoreH;
        origX = Math.round(localPtr.x - restoreW * ratio);
        origY = Math.max(0, localPtr.y - 18);
        winEl.classList.remove('is-maximized');
        winEl.style.width = `${restoreW}px`;
        winEl.style.height = `${restoreH}px`;
      }

      win.x = origX + dx;
      win.y = Math.max(0, Math.min(height - 84, origY + dy));
      winEl.style.left = `${win.x}px`;
      winEl.style.top = `${win.y}px`;

      if (localPtr.y <= 8) snapZone = 'maximize';
      else if (localPtr.x <= 10) snapZone = 'left';
      else if (localPtr.x >= vw - 10) snapZone = 'right';
      else snapZone = 'none';

      updateSnapOverlay(snapZone);
    };

    const onUp = () => {
      windowsLayerEl.classList.remove('is-interacting');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      updateSnapOverlay('none');
      if (!moved) return;

      const { width: vw, height } = getViewport();
      const vh = height - 48;
      if (snapZone === 'maximize') {
        store.toggleMaximizeWindow(wid, getViewport());
      } else if (snapZone === 'left') {
        win.restoreBounds = { x: origX, y: origY, width: win.width, height: win.height };
        win.x = 0;
        win.y = 0;
        win.width = Math.round(vw / 2);
        win.height = vh;
        store.notify();
      } else if (snapZone === 'right') {
        win.restoreBounds = { x: origX, y: origY, width: win.width, height: win.height };
        win.x = Math.round(vw / 2);
        win.y = 0;
        win.width = vw - Math.round(vw / 2);
        win.height = vh;
        store.notify();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

  windowsLayerEl.addEventListener('dblclick', (e) => {
    const target = e.target as HTMLElement;
    const dragBar = target.closest<HTMLElement>('[data-win-drag]');
    if (!dragBar || target.closest('.is-game-fullscreen, .w11-win-controls, [data-no-drag], input, button'))
      return;
    store.toggleMaximizeWindow(Number(dragBar.dataset.winDrag), getViewport());
  });

  windowsLayerEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const minBtn = target.closest<HTMLElement>('[data-win-min]');
    if (minBtn) {
      store.minimizeWindow(Number(minBtn.dataset.winMin));
      return;
    }
    const maxBtn = target.closest<HTMLElement>('[data-win-max]');
    if (maxBtn) {
      store.toggleMaximizeWindow(Number(maxBtn.dataset.winMax), getViewport());
      return;
    }
    const closeBtn = target.closest<HTMLElement>('[data-win-close]');
    if (closeBtn) {
      store.closeWindow(Number(closeBtn.dataset.winClose));
      return;
    }
  });

  // --- Taskbar & Flyout Events ---
  return { renderWindows };
}
