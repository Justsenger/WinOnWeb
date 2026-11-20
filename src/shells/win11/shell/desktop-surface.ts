import { getAppIconSvg, UI_ICONS } from './icons';
import { getAppDisplayName, getAppRegistry, getManifestById } from './registry';
import { type DesktopIconSize } from '../types';
import type { createContextMenu } from './context-menu';
import type { DesktopContext } from './desktop-context';
interface GridMetrics {
  colW: number;
  rowH: number;
  iconPx: number;
  pad: number;
}

const GRID_METRICS: Record<DesktopIconSize, GridMetrics> = {
  large: { colW: 126, rowH: 136, iconPx: 96, pad: 12 },
  medium: { colW: 90, rowH: 94, iconPx: 48, pad: 10 },
  small: { colW: 76, rowH: 78, iconPx: 32, pad: 10 },
};

export function createDesktopLayout(root: HTMLElement) {
  function applyDesktopScale() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw < 1024 || vh < 580) {
      const rdpW = 1920;
      const rdpH = vw > vh ? Math.max(720, Math.round((vh * rdpW) / vw)) : 1080;
      const scale = Math.min(vw / rdpW, vh / rdpH);
      root.classList.add('is-rdp-scaled');
      root.style.setProperty('--w11-rdp-w', `${rdpW}px`);
      root.style.setProperty('--w11-rdp-h', `${rdpH}px`);
      root.style.setProperty('--w11-scale', String(scale));
    } else {
      root.classList.remove('is-rdp-scaled');
      root.style.removeProperty('--w11-rdp-w');
      root.style.removeProperty('--w11-rdp-h');
      root.style.removeProperty('--w11-scale');
    }
  }

  function getShellMetrics() {
    const rect = root.getBoundingClientRect();
    const width = root.offsetWidth || window.innerWidth;
    const height = root.offsetHeight || window.innerHeight;
    const scaleX = width > 0 ? rect.width / width : 1;
    const scaleY = height > 0 ? rect.height / height : 1;
    return { rect, width, height, scaleX: scaleX || 1, scaleY: scaleY || 1 };
  }

  function getViewport() {
    return {
      width: root.offsetWidth || window.innerWidth,
      height: root.offsetHeight || window.innerHeight,
    };
  }

  function toShellCoords(clientX: number, clientY: number) {
    const { rect, width, height, scaleX, scaleY } = getShellMetrics();
    return {
      x: (clientX - rect.left) / scaleX,
      y: (clientY - rect.top) / scaleY,
      width,
      height,
      scaleX,
      scaleY,
      rect,
    };
  }

  function getMaxGridRows(size: DesktopIconSize): number {
    const m = GRID_METRICS[size];
    const availH = Math.max(m.rowH, getViewport().height - 48 - m.pad * 2);
    return Math.max(1, Math.floor(availH / m.rowH));
  }

  function getMaxGridCols(size: DesktopIconSize): number {
    const m = GRID_METRICS[size];
    return Math.max(1, Math.floor((getViewport().width - m.pad * 2) / m.colW));
  }

  function resolveVisibleIconCell(
    rawCol: number,
    rawRow: number,
    size: DesktopIconSize,
    occupied: Set<string>,
  ) {
    const maxCols = getMaxGridCols(size);
    const maxRows = getMaxGridRows(size);
    let col = Math.max(0, rawCol);
    let row = Math.max(0, rawRow);

    if (row >= maxRows) {
      col += Math.floor(row / maxRows);
      row = row % maxRows;
    }
    col = Math.min(maxCols - 1, col);
    row = Math.min(maxRows - 1, row);

    const key = (c: number, r: number) => `${c},${r}`;
    if (!occupied.has(key(col, row))) {
      occupied.add(key(col, row));
      return { col, row };
    }

    for (let dc = 0; dc < maxCols; dc++) {
      const c = (col + dc) % maxCols;
      const startR = dc === 0 ? row : 0;
      for (let r = startR; r < maxRows; r++) {
        if (!occupied.has(key(c, r))) {
          occupied.add(key(c, r));
          return { col: c, row: r };
        }
      }
      for (let r = 0; r < startR; r++) {
        if (!occupied.has(key(c, r))) {
          occupied.add(key(c, r));
          return { col: c, row: r };
        }
      }
    }

    return { col, row };
  }

  return {
    applyDesktopScale,
    getShellMetrics,
    getViewport,
    toShellCoords,
    getMaxGridRows,
    getMaxGridCols,
    resolveVisibleIconCell,
  };
}
export function createDesktopSurface(
  context: DesktopContext,
  { closeContextMenu, openContextMenu }: ReturnType<typeof createContextMenu>,
) {
  const {
    store,
    desktopAreaEl,
    iconsLayerEl,
    marqueeEl,
    escapeHtml,
    getShellMetrics,
    getViewport,
    toShellCoords,
    getMaxGridRows,
    getMaxGridCols,
    resolveVisibleIconCell,
    launchShellItem,
  } = context;
  let showDesktopIcons = true;
  function renderDesktopIcons() {
    const { iconSize, iconPositions, selectedIconIds, autoArrange, alignToGrid } = store.state;
    const m = GRID_METRICS[iconSize];
    iconsLayerEl.setAttribute('data-size', iconSize);

    const desktopApps = getAppRegistry().filter((app) => app.onDesktop);
    const maxCols = getMaxGridCols(iconSize);
    const maxRows = getMaxGridRows(iconSize);
    const occupied = new Set<string>();
    iconsLayerEl.innerHTML = '';

    const packedPositions = new Map<string, { col: number; row: number }>();
    if (autoArrange) {
      const ordered = [...desktopApps].sort((a, b) => {
        const pa = iconPositions[a.id] ?? { col: 0, row: 0 };
        const pb = iconPositions[b.id] ?? { col: 0, row: 0 };
        if (pa.col !== pb.col) return pa.col - pb.col;
        if (pa.row !== pb.row) return pa.row - pb.row;
        return desktopApps.indexOf(a) - desktopApps.indexOf(b);
      });
      ordered.forEach((app, idx) => {
        packedPositions.set(app.id, {
          col: Math.min(maxCols - 1, Math.floor(idx / maxRows)),
          row: idx % maxRows,
        });
      });
    }

    const isFullscreen = Boolean(document.fullscreenElement);
    desktopApps.forEach((app) => {
      const rawPos = iconPositions[app.id] ?? { col: 0, row: 0 };
      let pos: { col: number; row: number };
      if (autoArrange) {
        pos = packedPositions.get(app.id) ?? { col: 0, row: 0 };
      } else if (!alignToGrid) {
        pos = {
          col: Math.max(0, Math.min(maxCols - 1, rawPos.col)),
          row: Math.max(0, Math.min(maxRows - 1, rawPos.row)),
        };
      } else {
        pos = resolveVisibleIconCell(Math.round(rawPos.col), Math.round(rawPos.row), iconSize, occupied);
      }
      const isSelected = selectedIconIds.includes(app.id);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `w11-desktop-icon${isSelected ? ' is-selected' : ''}`;
      btn.dataset.appId = app.id;
      btn.style.left = `${m.pad + pos.col * m.colW}px`;
      btn.style.top = `${m.pad + pos.row * m.rowH}px`;
      btn.style.width = `${m.colW - 6}px`;
      btn.style.height = `${m.rowH - 4}px`;
      const label = escapeHtml(getAppDisplayName(app, { isFullscreen }));
      btn.innerHTML = `
        <span class="w11-desktop-icon__glyph">${getAppIconSvg(app.iconKey, m.iconPx)}</span>
        <span class="w11-desktop-icon__label">${label}</span>
      `;
      iconsLayerEl.appendChild(btn);
    });
  }

  let refreshStartTimer = 0;
  let refreshEndTimer = 0;

  function triggerDesktopRefresh() {
    window.clearTimeout(refreshStartTimer);
    window.clearTimeout(refreshEndTimer);
    iconsLayerEl.classList.remove('is-refreshing');

    refreshStartTimer = window.setTimeout(() => {
      iconsLayerEl.classList.add('is-refreshing');
      renderDesktopIcons();
      refreshEndTimer = window.setTimeout(() => {
        iconsLayerEl.classList.remove('is-refreshing');
      }, 150);
    }, 65);
  }

  // --- Desktop Icon Selection, Drag-to-Cell, Double-click & Marquee ---
  let lastTouchTap: { appId: string; time: number } | null = null;
  let lastTouchLongPressAt = 0;

  window.addEventListener(
    'contextmenu',
    (e) => {
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
    },
    { capture: true },
  );

  desktopAreaEl.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
    },
    { passive: false },
  );

  function openIconContextMenu(appId: string, clientX: number, clientY: number) {
    if (!store.state.selectedIconIds.includes(appId)) {
      store.selectIcons([appId]);
    }
    const manifest = getManifestById(appId);
    const openLabel =
      manifest?.runtime === 'command'
        ? getAppDisplayName(manifest, { isFullscreen: Boolean(document.fullscreenElement) })
        : '打开';
    const pinned = store.state.pinnedTaskbarIds.includes(appId);
    openContextMenu(clientX, clientY, [
      { label: openLabel, onSelect: () => launchShellItem(appId) },
      {
        label: pinned ? '从任务栏取消固定' : '固定到任务栏',
        onSelect: () => store.togglePinToTaskbar(appId),
      },
      { type: 'divider' },
      {
        label: '重置图标排列',
        icon: UI_ICONS.refresh,
        onSelect: () => store.sortDesktopIcons('default', getMaxGridRows(store.state.iconSize)),
      },
    ]);
  }

  function openDesktopContextMenu(clientX: number, clientY: number) {
    openContextMenu(clientX, clientY, [
      {
        label: '查看(V)',
        submenu: [
          {
            label: '大图标(R)',
            checked: store.state.iconSize === 'large',
            onSelect: () => store.setIconSize('large', getMaxGridRows('large')),
          },
          {
            label: '中等图标(M)',
            checked: store.state.iconSize === 'medium',
            onSelect: () => store.setIconSize('medium', getMaxGridRows('medium')),
          },
          {
            label: '小图标(N)',
            checked: store.state.iconSize === 'small',
            onSelect: () => store.setIconSize('small', getMaxGridRows('small')),
          },
          { type: 'divider' },
          {
            label: '自动排列图标(A)',
            checked: store.state.autoArrange,
            checkedType: 'check',
            onSelect: () => store.toggleAutoArrange(getMaxGridRows(store.state.iconSize)),
          },
          {
            label: '将图标与网格对齐(I)',
            checked: store.state.alignToGrid,
            checkedType: 'check',
            onSelect: () =>
              store.toggleAlignToGrid(
                getMaxGridCols(store.state.iconSize),
                getMaxGridRows(store.state.iconSize),
              ),
          },
          { type: 'divider' },
          {
            label: '显示桌面图标(D)',
            checked: showDesktopIcons,
            checkedType: 'check',
            onSelect: () => {
              showDesktopIcons = !showDesktopIcons;
              iconsLayerEl.style.visibility = showDesktopIcons ? '' : 'hidden';
              iconsLayerEl.style.pointerEvents = showDesktopIcons ? '' : 'none';
            },
          },
        ],
      },
      {
        label: '排序方式(O)',
        submenu: [
          {
            label: '名称(N)',
            onSelect: () => store.sortDesktopIcons('name', getMaxGridRows(store.state.iconSize)),
          },
          {
            label: '大小',
            onSelect: () => store.sortDesktopIcons('default', getMaxGridRows(store.state.iconSize)),
          },
          {
            label: '项目类型',
            onSelect: () => store.sortDesktopIcons('default', getMaxGridRows(store.state.iconSize)),
          },
          {
            label: '修改日期',
            onSelect: () => store.sortDesktopIcons('default', getMaxGridRows(store.state.iconSize)),
          },
        ],
      },
      { label: '刷新(E)', onSelect: triggerDesktopRefresh },
      { type: 'divider' },
      { label: '粘贴(P)', disabled: true },
      {
        label: '在终端中打开(T)',
        icon: getAppIconSvg('terminal', 14),
        onSelect: () => store.openApp('terminal', getViewport()),
      },
      { type: 'divider' },
      {
        label: '新建(W)',
        submenu: [
          { label: '文件夹(F)', icon: UI_ICONS.folder, disabled: true },
          { label: '快捷方式(S)', icon: UI_ICONS.shortcut, disabled: true },
        ],
      },
      { type: 'divider' },
      {
        label: '安装 .wow 应用包',
        onSelect: () => {
          store.openApp('app-store', getViewport());
          window.setTimeout(() => window.dispatchEvent(new CustomEvent('w11-open-wow-installer')), 80);
        },
      },
      { type: 'divider' },
      {
        label: '显示设置(D)',
        icon: UI_ICONS.displaySettings,
        onSelect: () => store.openApp('settings', getViewport()),
      },
      {
        label: '个性化(R)',
        icon: UI_ICONS.personalize,
        onSelect: () => store.openApp('settings', getViewport()),
      },
    ]);
  }

  desktopAreaEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const iconBtn = target.closest<HTMLElement>('.w11-desktop-icon');

    closeContextMenu();
    store.closeFlyouts();

    if (iconBtn) {
      const appId = iconBtn.dataset.appId!;
      if (e.ctrlKey || e.metaKey) {
        store.toggleIconSelection(appId);
      } else if (!store.state.selectedIconIds.includes(appId)) {
        store.selectIcons([appId]);
      }

      const startX = e.clientX;
      const startY = e.clientY;
      const origLeft = parseFloat(iconBtn.style.left);
      const origTop = parseFloat(iconBtn.style.top);
      let moved = false;
      let longPressed = false;
      const longPressTimer =
        e.pointerType === 'touch'
          ? window.setTimeout(() => {
              if (!moved) {
                longPressed = true;
                lastTouchLongPressAt = Date.now();
                openIconContextMenu(appId, startX, startY);
              }
            }, 550)
          : 0;

      const onMove = (me: PointerEvent) => {
        if (me.pointerId !== e.pointerId || longPressed) return;
        const { scaleX, scaleY } = getShellMetrics();
        const dx = (me.clientX - startX) / scaleX;
        const dy = (me.clientY - startY) / scaleY;
        if (!moved && Math.hypot(me.clientX - startX, me.clientY - startY) < 6) return;
        moved = true;
        if (longPressTimer) window.clearTimeout(longPressTimer);
        iconBtn.classList.add('is-dragging');
        iconBtn.style.left = `${origLeft + dx}px`;
        iconBtn.style.top = `${origTop + dy}px`;
      };

      const cleanup = () => {
        if (longPressTimer) window.clearTimeout(longPressTimer);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      };

      const onCancel = (ce: PointerEvent) => {
        if (ce.pointerId !== e.pointerId) return;
        cleanup();
        if (moved) {
          iconBtn.classList.remove('is-dragging');
          iconBtn.style.left = `${origLeft}px`;
          iconBtn.style.top = `${origTop}px`;
        }
      };

      const onUp = (ue: PointerEvent) => {
        if (ue.pointerId !== e.pointerId) return;
        cleanup();
        if (longPressed) return;
        if (!moved) {
          if (ue.pointerType !== 'mouse') {
            const now = Date.now();
            if (lastTouchTap && lastTouchTap.appId === appId && now - lastTouchTap.time < 450) {
              lastTouchTap = null;
              launchShellItem(appId);
            } else {
              lastTouchTap = { appId, time: now };
            }
          }
          return;
        }
        iconBtn.classList.remove('is-dragging');
        const m = GRID_METRICS[store.state.iconSize];
        const { scaleX, scaleY } = getShellMetrics();
        const targetLeft = origLeft + (ue.clientX - startX) / scaleX;
        const targetTop = origTop + (ue.clientY - startY) / scaleY;
        const rawCol = (targetLeft - m.pad) / m.colW;
        const rawRow = (targetTop - m.pad) / m.rowH;
        store.moveIconToCell(
          appId,
          rawCol,
          rawRow,
          getMaxGridCols(store.state.iconSize),
          getMaxGridRows(store.state.iconSize),
        );
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      return;
    }

    // Marquee selection on empty desktop
    if (!e.ctrlKey && !e.metaKey) {
      store.selectIcons([]);
    }
    const startX = e.clientX;
    const startY = e.clientY;
    const startLocal = toShellCoords(startX, startY);
    let active = false;
    let longPressed = false;
    const longPressTimer =
      e.pointerType === 'touch'
        ? window.setTimeout(() => {
            if (!active) {
              longPressed = true;
              lastTouchLongPressAt = Date.now();
              openDesktopContextMenu(startX, startY);
            }
          }, 550)
        : 0;

    const onMove = (me: PointerEvent) => {
      if (me.pointerId !== e.pointerId || longPressed) return;
      const rawDx = me.clientX - startX;
      const rawDy = me.clientY - startY;
      if (!active && Math.hypot(rawDx, rawDy) < 6) return;
      active = true;
      if (longPressTimer) window.clearTimeout(longPressTimer);
      const curLocal = toShellCoords(me.clientX, me.clientY);
      const left = Math.min(startLocal.x, curLocal.x);
      const top = Math.min(startLocal.y, curLocal.y);
      const width = Math.abs(curLocal.x - startLocal.x);
      const height = Math.abs(curLocal.y - startLocal.y);
      marqueeEl.style.display = 'block';
      marqueeEl.style.left = `${left}px`;
      marqueeEl.style.top = `${top}px`;
      marqueeEl.style.width = `${width}px`;
      marqueeEl.style.height = `${height}px`;

      const vLeft = Math.min(startX, me.clientX);
      const vTop = Math.min(startY, me.clientY);
      const mRect = {
        left: vLeft,
        top: vTop,
        right: vLeft + Math.abs(rawDx),
        bottom: vTop + Math.abs(rawDy),
      };
      const hitIds: string[] = [];
      iconsLayerEl.querySelectorAll<HTMLElement>('.w11-desktop-icon').forEach((el) => {
        const r = el.getBoundingClientRect();
        const intersects = !(
          r.right < mRect.left ||
          r.left > mRect.right ||
          r.bottom < mRect.top ||
          r.top > mRect.bottom
        );
        if (intersects && el.dataset.appId) hitIds.push(el.dataset.appId);
      });
      store.selectIcons(hitIds);
    };

    const onUp = (ue: PointerEvent) => {
      if (ue.pointerId !== e.pointerId) return;
      if (longPressTimer) window.clearTimeout(longPressTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      marqueeEl.style.display = 'none';
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

  desktopAreaEl.addEventListener('dblclick', (e) => {
    const iconBtn = (e.target as HTMLElement).closest<HTMLElement>('.w11-desktop-icon');
    if (!iconBtn?.dataset.appId) return;
    launchShellItem(iconBtn.dataset.appId);
  });

  // --- Context Menus (Desktop, Icon, Taskbar) ---
  desktopAreaEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (Date.now() - lastTouchLongPressAt < 800) return;
    const iconBtn = (e.target as HTMLElement).closest<HTMLElement>('.w11-desktop-icon');
    if (iconBtn?.dataset.appId) {
      openIconContextMenu(iconBtn.dataset.appId, e.clientX, e.clientY);
      return;
    }
    openDesktopContextMenu(e.clientX, e.clientY);
  });

  const ICON_SIZE_ORDER: DesktopIconSize[] = ['small', 'medium', 'large'];
  let lastWheelZoomAt = 0;

  window.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (e.deltaY === 0) return;

      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          '.w11-window, [data-start-menu], [data-quick-settings], [data-calendar-flyout], [data-context-menu]',
        )
      ) {
        return;
      }

      const now = Date.now();
      if (now - lastWheelZoomAt < 120) return;
      lastWheelZoomAt = now;

      const idx = ICON_SIZE_ORDER.indexOf(store.state.iconSize);
      const nextIdx = e.deltaY < 0 ? Math.min(ICON_SIZE_ORDER.length - 1, idx + 1) : Math.max(0, idx - 1);
      if (nextIdx !== idx) {
        const nextSize = ICON_SIZE_ORDER[nextIdx];
        store.setIconSize(nextSize, getMaxGridRows(nextSize));
      }
    },
    { passive: false },
  );

  return { renderDesktopIcons, triggerDesktopRefresh };
}
