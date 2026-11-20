import { getAppIconSvg } from './icons';
import { getManifestById } from './registry';
import type { createContextMenu } from './context-menu';
import type { DesktopContext } from './desktop-context';
export function createTaskbar(
  context: DesktopContext,
  { closeContextMenu, openContextMenu }: ReturnType<typeof createContextMenu>,
) {
  const {
    store,
    taskbarEl,
    taskbarAppsEl,
    startSearchEl,
    clockTimeEl,
    clockDateEl,
    imeBtnEl,
    sendToInstance,
    getViewport,
    launchShellItem,
    root,
  } = context;
  function renderTaskbar() {
    const startBtn = taskbarEl.querySelector<HTMLElement>('[data-taskbar-start]');
    startBtn?.classList.toggle('is-active', store.state.activeFlyout === 'start');

    const trayQuickBtn = taskbarEl.querySelector<HTMLElement>('[data-taskbar-quick]');
    trayQuickBtn?.classList.toggle('is-active', store.state.activeFlyout === 'quickSettings');

    const clockBtn = taskbarEl.querySelector<HTMLElement>('[data-taskbar-clock]');
    clockBtn?.classList.toggle('is-active', store.state.activeFlyout === 'calendar');

    const overflowBtn = taskbarEl.querySelector<HTMLElement>('[data-taskbar-overflow]');
    overflowBtn?.classList.toggle('is-active', store.state.activeFlyout === 'trayOverflow');

    imeBtnEl.textContent = store.state.imeMode;

    const orderedIds = [
      '__task-view',
      '__copilot',
      'explorer',
      '__edge',
      'app-store',
      'task-manager',
      '__rdp',
    ];
    store.state.windows.forEach((win) => {
      if (!orderedIds.includes(win.appId)) orderedIds.push(win.appId);
    });

    taskbarAppsEl.innerHTML = '';
    orderedIds.forEach((appId) => {
      const special = appId.startsWith('__');
      const manifest = special ? null : getManifestById(appId);
      if (!manifest && !special) return;
      const win = store.state.windows.find((w) => w.appId === appId);
      const isOpen = Boolean(win);
      const isFocused = Boolean(win && !win.minimized && store.state.activeWid === win.wid);

      const btn = document.createElement('button');
      btn.type = 'button';
      const specialClass =
        appId === '__task-view'
          ? ' is-task-view'
          : appId === '__copilot'
            ? ' is-copilot'
            : appId === '__edge'
              ? ' is-edge'
              : ' is-rdp';
      btn.className = `w11-tb-item${special ? ` w11-tb-special${specialClass}` : ''}${isOpen ? ' is-open' : ''}${isFocused ? ' is-focused' : ''}`;
      if (!special) btn.dataset.tbApp = appId;
      btn.title = special
        ? appId === '__task-view'
          ? '任务视图'
          : appId === '__copilot'
            ? 'Copilot'
            : appId === '__edge'
              ? 'Microsoft Edge'
              : '远程桌面'
        : manifest!.name;
      const specialGlyph =
        appId === '__copilot' ? '✦' : appId === '__edge' ? 'e' : appId === '__rdp' ? '▣' : '';
      btn.innerHTML = `
        <span class="w11-tb-glyph">${special ? specialGlyph : getAppIconSvg(manifest!.iconKey, 24)}</span>
        <span class="w11-tb-indicator"></span>
      `;
      taskbarAppsEl.appendChild(btn);
    });
  }

  const LOCK_DAYS_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  function updateClock() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    clockTimeEl.textContent = `${hh}:${mm}`;
    clockDateEl.textContent = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;

    const lockTimeEl = root.querySelector<HTMLElement>('[data-lock-time]');
    const lockDateEl = root.querySelector<HTMLElement>('[data-lock-date]');
    if (lockTimeEl) lockTimeEl.textContent = `${now.getHours()}:${mm}`;
    if (lockDateEl)
      lockDateEl.textContent = `${now.getMonth() + 1}月${now.getDate()}日, ${LOCK_DAYS_ZH[now.getDay()]}`;
  }

  taskbarEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if ((e.target as HTMLElement).closest('button, .w11-taskbar-tray')) return;
    openContextMenu(
      e.clientX,
      e.clientY,
      [
        {
          label: '任务管理器',
          icon: '<i class="w11-menu-task-manager"></i>',
          onSelect: () => launchShellItem('task-manager'),
        },
        { type: 'divider' },
        {
          label: '任务栏设置',
          icon: '<i class="w11-menu-taskbar-settings"></i>',
          onSelect: () => {
            const wid = launchShellItem('settings', { page: 'taskbar' });
            const view = store.state.windows.find((w) => w.wid === wid);
            if (view) sendToInstance(view.instanceId, 'navigate', 'taskbar');
          },
        },
      ],
      'taskbar',
    );
  });

  taskbarEl.addEventListener('click', (e) => {
    closeContextMenu();
    const target = e.target as HTMLElement;

    if (target.closest('[data-taskbar-start]')) {
      store.setActiveFlyout('start');
      return;
    }
    if (target.closest('[data-taskbar-search]')) {
      store.state.activeFlyout = 'start';
      store.notify();
      window.setTimeout(() => startSearchEl.focus(), 30);
      return;
    }
    if (target.closest('[data-taskbar-quick]')) {
      store.setActiveFlyout('quickSettings');
      return;
    }
    if (target.closest('[data-taskbar-clock]')) {
      store.setActiveFlyout('calendar');
      return;
    }
    if (target.closest('[data-taskbar-overflow]')) {
      store.setActiveFlyout('trayOverflow');
      return;
    }
    if (target.closest('[data-ime-btn]')) {
      store.toggleIme();
      return;
    }
    if (target.closest('[data-show-desktop]')) {
      store.toggleShowDesktop();
      return;
    }
    const tbApp = target.closest<HTMLElement>('[data-tb-app]');
    if (tbApp?.dataset.tbApp) {
      const manifest = getManifestById(tbApp.dataset.tbApp);
      if (manifest?.runtime === 'command') {
        launchShellItem(manifest.id);
      } else {
        store.toggleTaskbarApp(tbApp.dataset.tbApp, getViewport());
      }
    }
  });

  return { renderTaskbar, updateClock };
}
