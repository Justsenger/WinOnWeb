import { getAppIconSvg } from './icons';
import { getAppRegistry } from './registry';
import type { createLockScreen } from './lock-screen';
import type { DesktopContext } from './desktop-context';
export function createFlyouts(context: DesktopContext, lockController: ReturnType<typeof createLockScreen>) {
  const {
    store,
    startMenuEl,
    startSearchEl,
    startGridEl,
    quickSettingsEl,
    calendarFlyoutEl,
    trayOverflowEl,
    getViewport,
    launchShellItem,
  } = context;
  let searchQuery = '';
  function renderStartMenu() {
    const open = store.state.activeFlyout === 'start';
    startMenuEl.classList.toggle('is-open', open);

    const q = searchQuery.trim().toLowerCase();
    const list = getAppRegistry().filter((app) => {
      if (q) {
        return app.name.toLowerCase().includes(q) || app.id.toLowerCase().includes(q);
      }
      return app.pinnedToStart !== false;
    });

    startGridEl.innerHTML = '';
    if (list.length === 0) {
      startGridEl.innerHTML = `<div class="w11-start-empty">未找到匹配的项目</div>`;
      return;
    }

    list.forEach((app) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'w11-start-item';
      btn.dataset.launchApp = app.id;
      const iconEl = document.createElement('span');
      iconEl.className = 'w11-start-item__icon';
      iconEl.innerHTML = getAppIconSvg(app.iconKey, 32);
      const nameEl = document.createElement('span');
      nameEl.className = 'w11-start-item__name';
      nameEl.textContent = app.name;
      btn.append(iconEl, nameEl);
      startGridEl.appendChild(btn);
    });
  }

  function renderQuickSettings() {
    const open = store.state.activeFlyout === 'quickSettings';
    quickSettingsEl.classList.toggle('is-open', open);

    const toggleMap: Record<string, boolean> = {
      wifi: store.state.toggles.wifi,
      bluetooth: store.state.toggles.bluetooth,
      airplane: store.state.toggles.airplane,
      nightLight: store.state.toggles.nightLight,
      theme: store.state.theme === 'dark',
    };

    quickSettingsEl.querySelectorAll<HTMLElement>('[data-qs-toggle]').forEach((el) => {
      const key = el.dataset.qsToggle ?? '';
      el.classList.toggle('is-active', Boolean(toggleMap[key]));
    });

    const brightInput = quickSettingsEl.querySelector<HTMLInputElement>('[data-qs-brightness]');
    if (brightInput) {
      brightInput.value = String(store.state.brightness);
      const pct = ((store.state.brightness - 35) / 65) * 100;
      brightInput.style.setProperty('--track-pct', `${pct}%`);
    }
    const volInput = quickSettingsEl.querySelector<HTMLInputElement>('[data-qs-volume]');
    if (volInput) {
      volInput.value = String(store.state.volume);
      volInput.style.setProperty('--track-pct', `${store.state.volume}%`);
    }
  }

  function renderCalendarFlyout() {
    const open = store.state.activeFlyout === 'calendar';
    calendarFlyoutEl.classList.toggle('is-open', open);
    if (!open) return;

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const today = now.getDate();

    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();

    const cells: string[] = [];
    for (let i = firstWeekday - 1; i >= 0; i -= 1) {
      cells.push(`<span class="w11-cal-day is-muted">${daysInPrev - i}</span>`);
    }
    for (let d = 1; d <= daysInMonth; d += 1) {
      cells.push(`<span class="w11-cal-day${d === today ? ' is-today' : ''}">${d}</span>`);
    }
    const remainder = (7 - (cells.length % 7)) % 7;
    for (let d = 1; d <= remainder; d += 1) {
      cells.push(`<span class="w11-cal-day is-muted">${d}</span>`);
    }

    const weekdayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    calendarFlyoutEl.innerHTML = `
      <div class="w11-cal-header">
        <div class="w11-cal-today">${year}年${month + 1}月${today}日 ${weekdayNames[now.getDay()]}</div>
        <div class="w11-cal-month">${year}年${month + 1}月</div>
      </div>
      <div class="w11-cal-weekdays">
        <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
      </div>
      <div class="w11-cal-grid">${cells.join('')}</div>
    `;
  }

  function renderTrayOverflow() {
    trayOverflowEl.classList.toggle('is-open', store.state.activeFlyout === 'trayOverflow');
  }

  startSearchEl.addEventListener('input', () => {
    searchQuery = startSearchEl.value;
    renderStartMenu();
  });

  startMenuEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const appBtn = target.closest<HTMLElement>('[data-launch-app]');
    if (appBtn?.dataset.launchApp) {
      searchQuery = '';
      startSearchEl.value = '';
      store.closeFlyouts();
      launchShellItem(appBtn.dataset.launchApp);
      return;
    }
    const startPowerBtn = target.closest<HTMLElement>('[data-start-power]');
    if (startPowerBtn) {
      const menu = startMenuEl.querySelector<HTMLElement>('[data-start-power-menu]');
      if (menu) {
        menu.hidden = !menu.hidden;
        startPowerBtn.setAttribute('aria-expanded', String(!menu.hidden));
      }
      return;
    }
    const powerActionBtn = target.closest<HTMLElement>('[data-power-action]');
    if (powerActionBtn) {
      const action = powerActionBtn.dataset.powerAction;
      const menu = startMenuEl.querySelector<HTMLElement>('[data-start-power-menu]');
      if (menu) menu.hidden = true;
      store.closeFlyouts();
      if (action === 'reset-layout') {
        store.resetDesktopLayout();
      } else if (action === 'lock') {
        lockController.showLock('locked');
      } else if (action === 'signout') {
        lockController.showLock('signin');
      } else if (action === 'restart') {
        lockController.restartCycle();
      }
      return;
    }
    const menu = startMenuEl.querySelector<HTMLElement>('[data-start-power-menu]');
    if (menu && !menu.hidden && !target.closest('.w11-start-power-wrap')) {
      menu.hidden = true;
    }
  });

  quickSettingsEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const toggleBtn = target.closest<HTMLElement>('[data-qs-toggle]');
    if (toggleBtn) {
      const key = toggleBtn.dataset.qsToggle;
      if (key === 'theme') {
        store.setTheme(store.state.theme === 'dark' ? 'light' : 'dark');
      } else if (key === 'wifi' || key === 'bluetooth' || key === 'airplane' || key === 'nightLight') {
        store.toggleQuickSetting(key);
      }
      return;
    }
    if (target.closest('[data-qs-open-settings]')) {
      store.openApp('settings', getViewport());
    }
  });

  quickSettingsEl.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.matches('[data-qs-brightness]')) {
      store.setBrightness(Number(target.value));
    } else if (target.matches('[data-qs-volume]')) {
      store.setVolume(Number(target.value));
    }
  });

  // Dismiss flyouts / context menus when clicking outside
  return { renderStartMenu, renderQuickSettings, renderCalendarFlyout, renderTrayOverflow };
}
