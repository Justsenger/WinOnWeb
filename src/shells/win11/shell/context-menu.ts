import type { DesktopContext } from './desktop-context';
interface ContextMenuItem {
  type?: 'divider';
  label?: string;
  icon?: string;
  checked?: boolean;
  checkedType?: 'dot' | 'check';
  disabled?: boolean;
  onSelect?: () => void;
  submenu?: ContextMenuItem[];
}

export function createContextMenu(context: DesktopContext) {
  const { store, contextMenuEl, getShellMetrics, getViewport, toShellCoords } = context;
  function closeContextMenu() {
    contextMenuEl.classList.remove('is-open');
    contextMenuEl.classList.remove('is-taskbar-menu');
    contextMenuEl.innerHTML = '';
  }

  function renderMenuItems(items: ContextMenuItem[]): HTMLElement {
    const list = document.createElement('div');
    list.className = 'w11-ctx-list';
    let lastMenuPointerType = 'mouse';

    items.forEach((item) => {
      if (item.type === 'divider') {
        const div = document.createElement('div');
        div.className = 'w11-ctx-divider';
        list.appendChild(div);
        return;
      }

      const row = document.createElement('div');
      row.className = `w11-ctx-item${item.submenu ? ' has-sub' : ''}${item.disabled ? ' is-disabled' : ''}`;
      const checkGlyph = item.checked
        ? item.checkedType === 'check'
          ? '<span class="w11-ctx-checkglyph">✓</span>'
          : '<span class="w11-ctx-dot">•</span>'
        : '';
      const leftGlyph = item.icon ?? checkGlyph;
      const iconEl = document.createElement('span');
      iconEl.className = 'w11-ctx-icon';
      iconEl.innerHTML = leftGlyph;
      const labelEl = document.createElement('span');
      labelEl.className = 'w11-ctx-label';
      labelEl.textContent = item.label ?? '';
      const arrowEl = document.createElement('span');
      arrowEl.className = 'w11-ctx-arrow';
      arrowEl.textContent = item.submenu ? '›' : '';
      row.append(iconEl, labelEl, arrowEl);

      const closeSiblingSubmenus = () => {
        list
          .querySelectorAll('.w11-ctx-item.is-sub-open')
          .forEach((el) => el.classList.remove('is-sub-open'));
      };

      const positionSubmenu = (sub: HTMLElement) => {
        sub.style.left = '';
        sub.style.right = '';
        sub.style.top = '';
        const { rect: shellRect, scaleX, scaleY } = getShellMetrics();
        const rect = sub.getBoundingClientRect();
        if (rect.right > shellRect.right - 8 * scaleX) {
          sub.style.left = 'auto';
          sub.style.right = 'calc(100% + 2px)';
          const flippedRect = sub.getBoundingClientRect();
          if (flippedRect.left < shellRect.left + 8 * scaleX) {
            sub.style.right = 'auto';
            const rowRect = row.getBoundingClientRect();
            const clampedLeft =
              (Math.max(shellRect.left + 8 * scaleX, shellRect.right - flippedRect.width - 8 * scaleX) -
                rowRect.left) /
              scaleX;
            sub.style.left = `${clampedLeft}px`;
          }
        }
        const maxBottom = shellRect.bottom - 54 * scaleY;
        if (rect.bottom > maxBottom) {
          const shift = (rect.bottom - maxBottom) / scaleY;
          sub.style.top = `${-3 - shift}px`;
        }
      };

      row.addEventListener('pointerdown', (e) => {
        lastMenuPointerType = e.pointerType || 'mouse';
      });

      row.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'mouse') return;
        closeSiblingSubmenus();
        if (item.submenu) {
          row.classList.add('is-sub-open');
          const sub = row.querySelector<HTMLElement>(':scope > .w11-ctx-submenu');
          if (sub) positionSubmenu(sub);
        }
      });

      if (item.submenu) {
        const sub = renderMenuItems(item.submenu);
        sub.classList.add('w11-ctx-submenu');
        row.appendChild(sub);
        row.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.w11-ctx-submenu')) return;
          e.stopPropagation();
          const wasOpen = row.classList.contains('is-sub-open');
          closeSiblingSubmenus();
          if (lastMenuPointerType === 'mouse' || !wasOpen) {
            row.classList.add('is-sub-open');
            positionSubmenu(sub);
          }
        });
      } else if (!item.disabled) {
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          closeContextMenu();
          item.onSelect?.();
        });
      }

      list.appendChild(row);
    });

    return list;
  }

  function openContextMenu(
    x: number,
    y: number,
    items: ContextMenuItem[],
    variant: 'default' | 'taskbar' = 'default',
  ) {
    store.closeFlyouts();
    contextMenuEl.innerHTML = '';
    contextMenuEl.classList.toggle('is-taskbar-menu', variant === 'taskbar');
    contextMenuEl.appendChild(renderMenuItems(items));
    if (variant === 'taskbar') {
      contextMenuEl.setAttribute('role', 'menu');
      contextMenuEl.tabIndex = -1;
      for (const row of contextMenuEl.querySelectorAll<HTMLElement>('.w11-ctx-item')) {
        row.setAttribute('role', 'menuitem');
        row.tabIndex = -1;
      }
    } else {
      contextMenuEl.removeAttribute('role');
    }
    contextMenuEl.classList.add('is-open');

    const localPos = toShellCoords(x, y);
    const menuW = contextMenuEl.offsetWidth || 174;
    const menuH = contextMenuEl.offsetHeight || 203;
    const { width: vw, height } = getViewport();
    const vh = height - 48;
    const clampedX = Math.max(8, Math.min(localPos.x, Math.max(8, vw - menuW - 8)));
    if (variant === 'taskbar') {
      // The native flyout opens upwards with its bottom-left corner at the pointer.
      contextMenuEl.style.left = `${Math.max(0, Math.min(localPos.x, vw - menuW))}px`;
      contextMenuEl.style.top = `${Math.max(0, Math.min(localPos.y, height) - menuH)}px`;
      contextMenuEl.focus({ preventScroll: true });
      return;
    }
    contextMenuEl.style.left = `${clampedX}px`;
    contextMenuEl.style.top = `${Math.max(8, Math.min(localPos.y, vh - menuH - 8))}px`;
  }

  contextMenuEl.addEventListener('keydown', (event) => {
    if (!contextMenuEl.classList.contains('is-taskbar-menu')) return;
    const rows = Array.from(contextMenuEl.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const current = rows.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const next = event.key === 'ArrowDown' ? current + 1 : current < 0 ? rows.length - 1 : current - 1;
      rows[(next + rows.length) % rows.length].focus();
    } else if ((event.key === 'Enter' || event.key === ' ') && current >= 0) {
      rows[current].click();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  // --- Window Interactions (Focus, Controls, Drag/Snap, 8-way Resize) ---
  return { openContextMenu, closeContextMenu };
}
