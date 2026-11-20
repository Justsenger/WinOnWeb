import './overlays.css';

export interface OverlayMenuItem {
  type?: 'divider';
  label?: string;
  shortcut?: string;
  iconHtml?: string;
  checked?: boolean;
  checkedType?: 'check' | 'radio';
  disabled?: boolean;
  onSelect?: () => void;
  submenu?: OverlayMenuItem[];
}

export interface OverlayTooltipData {
  title: string;
  body?: string;
  flat?: boolean;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function createMenuController(hostEl: HTMLElement) {
  let activeMenuEl: HTMLElement | null = null;
  let cleanupFns: Array<() => void> = [];

  function close() {
    cleanupFns.forEach((fn) => fn());
    cleanupFns = [];
    if (activeMenuEl) {
      activeMenuEl.remove();
      activeMenuEl = null;
    }
  }

  function clientToHost(clientX: number, clientY: number) {
    const rect = hostEl.getBoundingClientRect();
    const scaleX = rect.width > 0 ? rect.width / (hostEl.offsetWidth || rect.width) : 1;
    const scaleY = rect.height > 0 ? rect.height / (hostEl.offsetHeight || rect.height) : 1;
    return {
      x: (clientX - rect.left) / scaleX,
      y: (clientY - rect.top) / scaleY,
      w: hostEl.offsetWidth || rect.width,
      h: hostEl.offsetHeight || rect.height,
      scaleX,
      scaleY,
    };
  }

  function positionSubmenu(row: HTMLElement, sub: HTMLElement) {
    sub.style.left = '';
    sub.style.right = '';
    sub.style.top = '';
    sub.style.bottom = '';
    const hostRect = hostEl.getBoundingClientRect();
    const scaleX = hostRect.width > 0 ? hostRect.width / (hostEl.offsetWidth || hostRect.width) : 1;
    const scaleY = hostRect.height > 0 ? hostRect.height / (hostEl.offsetHeight || hostRect.height) : 1;
    const rect = sub.getBoundingClientRect();
    if (rect.right > hostRect.right - 8 * scaleX) {
      sub.style.left = 'auto';
      sub.style.right = 'calc(100% + 2px)';
    }
    if (rect.bottom > hostRect.bottom - 8 * scaleY) {
      sub.style.top = 'auto';
      sub.style.bottom = '-4px';
    }
    void row;
  }

  function buildList(items: OverlayMenuItem[]): HTMLElement {
    const list = document.createElement('div');
    list.className = 'w11-tm-menu';

    items.forEach((item) => {
      if (item.type === 'divider') {
        const div = document.createElement('div');
        div.className = 'w11-tm-menu-sep';
        list.appendChild(div);
        return;
      }

      const row = document.createElement('div');
      row.className = `w11-tm-menu-item${item.submenu ? ' has-sub' : ''}${item.disabled ? ' is-disabled' : ''}`;
      const mark = item.checked
        ? item.checkedType === 'radio'
          ? '<span class="w11-tm-menu-dot">•</span>'
          : '<span class="w11-tm-menu-check">✓</span>'
        : (item.iconHtml ?? '');

      row.innerHTML = `
        <span class="w11-tm-menu-mark">${mark}</span>
        <span class="w11-tm-menu-label">${escapeHtml(item.label ?? '')}</span>
        ${item.shortcut ? `<span class="w11-tm-menu-key">${escapeHtml(item.shortcut)}</span>` : ''}
        ${item.submenu ? '<span class="w11-tm-menu-arrow">›</span>' : ''}
      `;

      const closeSiblingSubs = () => {
        list.querySelectorAll(':scope > .w11-tm-menu-item.is-sub-open').forEach((el) => el.classList.remove('is-sub-open'));
      };

      row.addEventListener('pointerenter', () => {
        closeSiblingSubs();
        if (item.submenu && !item.disabled) {
          row.classList.add('is-sub-open');
          const sub = row.querySelector<HTMLElement>(':scope > .w11-tm-menu-sub');
          if (sub) positionSubmenu(row, sub);
        }
      });

      if (item.submenu && !item.disabled) {
        const subWrap = document.createElement('div');
        subWrap.className = 'w11-tm-menu-sub';
        subWrap.appendChild(buildList(item.submenu));
        row.appendChild(subWrap);
      }

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (item.disabled || item.submenu) return;
        close();
        item.onSelect?.();
      });

      list.appendChild(row);
    });

    return list;
  }

  function openAt(clientX: number, clientY: number, items: OverlayMenuItem[]) {
    close();
    const wrap = document.createElement('div');
    wrap.className = 'w11-tm-menu-layer';
    wrap.appendChild(buildList(items));
    hostEl.appendChild(wrap);
    activeMenuEl = wrap;

    const pt = clientToHost(clientX, clientY);
    const mw = wrap.offsetWidth || 188;
    const mh = wrap.offsetHeight || 160;
    wrap.style.left = `${Math.max(6, Math.min(pt.w - mw - 6, pt.x))}px`;
    wrap.style.top = `${Math.max(6, Math.min(pt.h - mh - 6, pt.y))}px`;

    const onDown = (e: PointerEvent) => {
      if (!wrap.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };

    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    cleanupFns.push(
      () => window.removeEventListener('pointerdown', onDown, true),
      () => window.removeEventListener('keydown', onKey, true),
    );
  }

  function openBelowElement(anchor: HTMLElement, items: OverlayMenuItem[]) {
    const r = anchor.getBoundingClientRect();
    openAt(r.left, r.bottom + 4, items);
  }

  return { openAt, openBelowElement, close, destroy: close };
}

function getTipKey(el: HTMLElement | null): string {
  if (!el) return '';
  if (el.dataset.tmTipKey) return el.dataset.tmTipKey;
  if (el.dataset.perfKey) return `perf:${el.dataset.perfKey}`;
  const procRow = el.closest<HTMLElement>('[data-proc-id]');
  if (procRow?.dataset.procId) return `proc:${procRow.dataset.procId}:${el.dataset.tmTip ?? ''}`;
  return el.dataset.tmTip ?? '';
}

function readTipData(el: HTMLElement): OverlayTooltipData {
  return {
    title: el.dataset.tmTip ?? '',
    body: el.dataset.tmTipBody || undefined,
    flat: el.dataset.tmTipFlat === 'true',
  };
}

export function createTooltipController(hostEl: HTMLElement) {
  const tipEl = document.createElement('div');
  tipEl.className = 'w11-tm-tooltip';
  tipEl.hidden = true;
  hostEl.appendChild(tipEl);

  let timer: number | null = null;
  let currentTarget: HTMLElement | null = null;
  let currentKey = '';
  let lastPointer: { x: number; y: number } | null = null;
  let shownAnchor: { x: number; y: number } | null = null;
  let renderedTitle = '';
  let renderedBody = '';
  let isReconciling = false;

  function place(clientX: number, clientY: number) {
    const rect = hostEl.getBoundingClientRect();
    const scaleX = rect.width > 0 ? rect.width / (hostEl.offsetWidth || rect.width) : 1;
    const scaleY = rect.height > 0 ? rect.height / (hostEl.offsetHeight || rect.height) : 1;
    const hostW = hostEl.offsetWidth || rect.width;
    const hostH = hostEl.offsetHeight || rect.height;
    const x0 = (clientX - rect.left) / scaleX;
    const y0 = (clientY - rect.top) / scaleY;
    const tw = tipEl.offsetWidth || 160;
    const th = tipEl.offsetHeight || 36;
    const left = Math.max(6, Math.min(hostW - tw - 6, x0 + 12));
    const top = y0 + 20 + th > hostH - 6 ? Math.max(6, y0 - th - 10) : y0 + 18;
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${top}px`;
  }

  function renderTipContent(data: OverlayTooltipData): boolean {
    const nextTitle = data.title;
    const nextBody = data.body ?? '';
    const isFlat = Boolean(data.flat);
    if (
      nextTitle === renderedTitle &&
      nextBody === renderedBody &&
      tipEl.classList.contains('is-flat') === isFlat &&
      tipEl.childElementCount > 0
    ) {
      return false;
    }
    renderedTitle = nextTitle;
    renderedBody = nextBody;
    tipEl.classList.toggle('is-flat', isFlat);
    tipEl.innerHTML = nextBody
      ? `<div class="w11-tm-tip-title">${escapeHtml(nextTitle)}</div><div class="w11-tm-tip-body${isFlat ? ' is-flat' : ''}">${escapeHtml(nextBody)}</div>`
      : `<div class="w11-tm-tip-title">${escapeHtml(nextTitle)}</div>`;
    return true;
  }

  function show(clientX: number, clientY: number, data: OverlayTooltipData) {
    if (!data.title) return;
    shownAnchor = { x: clientX, y: clientY };
    renderTipContent(data);
    tipEl.hidden = false;
    place(clientX, clientY);
  }

  function hide() {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    currentTarget = null;
    currentKey = '';
    shownAnchor = null;
    renderedTitle = '';
    renderedBody = '';
    tipEl.hidden = true;
  }

  function scheduleShow(el: HTMLElement, clientX: number, clientY: number) {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    currentTarget = el;
    currentKey = getTipKey(el);
    const fallbackPos = { x: clientX, y: clientY };
    timer = window.setTimeout(() => {
      timer = null;
      if (!currentTarget || !currentTarget.isConnected) return;
      const data = readTipData(currentTarget);
      if (!data.title) return;
      const pos = lastPointer ?? fallbackPos;
      show(pos.x, pos.y, data);
    }, 320);
  }

  function findReplacementTarget(savedKey: string): { target: HTMLElement | null; blockedByOtherUi: boolean } {
    if (lastPointer && typeof document.elementFromPoint === 'function') {
      const rawHit = document.elementFromPoint(lastPointer.x, lastPointer.y) as HTMLElement | null;
      if (rawHit) {
        if (!hostEl.contains(rawHit)) {
          return { target: null, blockedByOtherUi: true };
        }
        return { target: rawHit.closest<HTMLElement>('[data-tm-tip]'), blockedByOtherUi: false };
      }
    }
    const candidates = hostEl.querySelectorAll<HTMLElement>('[data-tm-tip]');
    for (const candidate of candidates) {
      if (getTipKey(candidate) === savedKey) {
        return { target: candidate, blockedByOtherUi: false };
      }
    }
    return { target: null, blockedByOtherUi: false };
  }

  /**
   * Preserves an active or pending tooltip across synchronous DOM rebuilds and updates text in place.
   */
  function preserveDuring(rebuild: () => void) {
    const prevTarget = currentTarget;
    const prevKey = currentKey;
    const wasVisible = !tipEl.hidden;
    const hasPending = timer !== null;
    const prevAnchor = shownAnchor;

    isReconciling = true;
    try {
      rebuild();
    } finally {
      isReconciling = false;
    }

    if (!prevTarget) return;
    if (prevTarget.isConnected) {
      if (wasVisible) {
        const changed = renderTipContent(readTipData(prevTarget));
        if (changed && prevAnchor) place(prevAnchor.x, prevAnchor.y);
      }
      return;
    }

    const { target: nextEl, blockedByOtherUi } = findReplacementTarget(prevKey);
    if (blockedByOtherUi || !nextEl) {
      hide();
      return;
    }

    const nextKey = getTipKey(nextEl);
    if (nextKey === prevKey) {
      currentTarget = nextEl;
      if (wasVisible) {
        const changed = renderTipContent(readTipData(nextEl));
        tipEl.hidden = false;
        if (changed && prevAnchor) place(prevAnchor.x, prevAnchor.y);
      } else if (!hasPending) {
        hide();
      }
      return;
    }

    if (wasVisible && prevKey.startsWith('mem-') && nextKey.startsWith('mem-')) {
      currentTarget = nextEl;
      currentKey = nextKey;
      const changed = renderTipContent(readTipData(nextEl));
      tipEl.hidden = false;
      if (changed && prevAnchor) place(prevAnchor.x, prevAnchor.y);
      return;
    }

    hide();
    if (lastPointer) scheduleShow(nextEl, lastPointer.x, lastPointer.y);
  }

  const onOver = (e: PointerEvent) => {
    if (isReconciling) return;
    lastPointer = { x: e.clientX, y: e.clientY };
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-tm-tip]');
    if (!el || el === currentTarget) return;
    hide();
    scheduleShow(el, e.clientX, e.clientY);
  };

  const onMove = (e: PointerEvent) => {
    lastPointer = { x: e.clientX, y: e.clientY };
  };

  const onOut = (e: PointerEvent) => {
    if (isReconciling || !currentTarget) return;
    const from = (e.target as HTMLElement | null)?.closest?.('[data-tm-tip]');
    if (from !== currentTarget) return;
    const next = (e.relatedTarget as HTMLElement | null)?.closest?.('[data-tm-tip]');
    if (next !== currentTarget) hide();
  };

  const onLeave = () => {
    lastPointer = null;
    hide();
  };

  const onDown = () => {
    hide();
  };

  const onScroll = () => {
    if (isReconciling) return;
    if (currentTarget || timer !== null) hide();
  };

  hostEl.addEventListener('pointerover', onOver);
  hostEl.addEventListener('pointermove', onMove);
  hostEl.addEventListener('pointerout', onOut);
  hostEl.addEventListener('pointerleave', onLeave);
  hostEl.addEventListener('pointerdown', onDown);
  hostEl.addEventListener('scroll', onScroll, true);

  return {
    show,
    hide,
    preserveDuring,
    destroy() {
      hide();
      hostEl.removeEventListener('pointerover', onOver);
      hostEl.removeEventListener('pointermove', onMove);
      hostEl.removeEventListener('pointerout', onOut);
      hostEl.removeEventListener('pointerleave', onLeave);
      hostEl.removeEventListener('pointerdown', onDown);
      hostEl.removeEventListener('scroll', onScroll, true);
      tipEl.remove();
    },
  };
}

export function showModal(
  hostEl: HTMLElement,
  opts: {
    title: string;
    bodyHtml: string;
    width?: number;
    footerButtons: Array<{ label: string; primary?: boolean; onClick: (modalEl: HTMLElement, close: () => void) => void }>;
    onMount?: (modalEl: HTMLElement, close: () => void) => void;
  },
) {
  const backdrop = document.createElement('div');
  backdrop.className = 'w11-tm-modal-backdrop';
  const dialog = document.createElement('div');
  dialog.className = 'w11-tm-modal';
  dialog.style.width = `${opts.width ?? 420}px`;

  dialog.innerHTML = `
    <div class="w11-tm-modal-head">
      <span>${escapeHtml(opts.title)}</span>
      <button type="button" class="w11-tm-modal-x" aria-label="关闭">✕</button>
    </div>
    <div class="w11-tm-modal-body">${opts.bodyHtml}</div>
    <div class="w11-tm-modal-foot"></div>
  `;

  const foot = dialog.querySelector<HTMLElement>('.w11-tm-modal-foot')!;
  const close = () => {
    window.removeEventListener('keydown', onKey);
    backdrop.remove();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener('keydown', onKey);

  dialog.querySelector('.w11-tm-modal-x')?.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  opts.footerButtons.forEach((btnSpec) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `w11-tm-btn${btnSpec.primary ? ' is-primary' : ''}`;
    btn.textContent = btnSpec.label;
    btn.addEventListener('click', () => btnSpec.onClick(dialog, close));
    foot.appendChild(btn);
  });

  backdrop.appendChild(dialog);
  hostEl.appendChild(backdrop);
  opts.onMount?.(dialog, close);
  return { close };
}
