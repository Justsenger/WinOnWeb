import './magnifier.css';
import { preferences } from '../../../wow/hal/storage';

type MagnifierViewMode = 'follow' | 'center';

interface MagnifierPrefs {
  step: 25 | 50 | 100;
  mode: MagnifierViewMode;
  invertColors: boolean;
}

const PREFS_KEY = 'shell:magnifier:v1';
const MIN_ZOOM = 100;
const MAX_ZOOM = 400;

const MAG_ICONS = {
  app: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="2.5" width="10.5" height="8" rx="1.2" fill="#0078d4"/><circle cx="9.5" cy="8.5" r="3.4" fill="#e0f2fe" stroke="#005ba1" stroke-width="1.3"/><path d="M12.2 11.2L14.6 13.6" stroke="#005ba1" stroke-width="1.5" stroke-linecap="round"/></svg>',
  viewFull:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><rect x="2.2" y="3" width="11.6" height="10" rx="1.4"/><path d="M4.6 6.4V5h1.4M10 5h1.4v1.4M11.4 9.6V11H10M6 11H4.6V9.6" stroke-linecap="round"/></svg>',
  viewCenter:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><circle cx="7.4" cy="7.4" r="4.4"/><path d="M10.8 10.8L13.8 13.8M5.8 7.4h3.2M7.4 5.8v3.2" stroke-linecap="round"/></svg>',
  prev: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"><path d="M4 3.5v9M11.8 4L6 8l5.8 4V4z"/></svg>',
  play: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"><path d="M5 3.6l7.5 4.4L5 12.4V3.6z"/></svg>',
  pause: '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3.5" width="2.8" height="9" rx="0.6"/><rect x="9.2" y="3.5" width="2.8" height="9" rx="0.6"/></svg>',
  next: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"><path d="M12 3.5v9M4.2 4L10 8l-5.8 4V4z"/></svg>',
  readHere:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><path d="M3 12.5L6.2 4.5l3.2 8M4.1 10h4.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.5 3.6l1.8 2.4-1.8 2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  settings:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><circle cx="8" cy="8" r="2.3"/><path d="M8 1.8v1.5M8 12.7v1.5M1.8 8h1.5M12.7 8h1.5M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1" stroke-linecap="round"/></svg>',
};

function loadPrefs(): MagnifierPrefs {
  try {
    const raw = preferences.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<MagnifierPrefs>;
      return {
        step: p.step === 50 || p.step === 100 ? p.step : 25,
        mode: p.mode === 'center' ? 'center' : 'follow',
        invertColors: Boolean(p.invertColors),
      };
    }
  } catch {}
  return { step: 25, mode: 'follow', invertColors: false };
}

function savePrefs(prefs: MagnifierPrefs) {
  try {
    preferences.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

function collectReadableSegments(): string[] {
  const root = document.querySelector<HTMLElement>('[data-win11-root]');
  if (!root) return [];
  const oobe = root.querySelector<HTMLElement>('[data-oobe-screen]');
  const scope = oobe ?? root;
  const nodes = scope.querySelectorAll<HTMLElement>('h1, h2, h3, p, label, button, [role="switch"]');
  const out: string[] = [];
  for (const el of nodes) {
    if (el.offsetParent === null) continue;
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length >= 2 && !out.includes(text)) {
      out.push(text);
    }
    if (out.length >= 24) break;
  }
  return out;
}

function createMagnifierController() {
  let open = false;
  let minimized = false;
  let settingsOpen = false;
  let zoom = 100;
  let prefs = loadPrefs();
  let originX = 50;
  let originY = 50;
  let pos: { left: number; top: number } | null = null;
  let rootEl: HTMLElement | null = null;
  let reading = false;
  let readPickMode = false;
  let readSegments: string[] = [];
  let readIndex = 0;
  let globalBound = false;
  const listeners = new Set<(isOpen: boolean) => void>();

  function notify() {
    listeners.forEach((cb) => cb(open));
  }

  function getShellRoot(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-win11-root]');
  }

  function applyZoomToShell() {
    const shell = getShellRoot();
    if (!shell) return;
    if (!open) {
      shell.classList.remove('is-magnified', 'is-mag-inverted');
      shell.style.removeProperty('--wow-mag-zoom');
      shell.style.removeProperty('--wow-mag-ox');
      shell.style.removeProperty('--wow-mag-oy');
      return;
    }
    const zoomed = zoom > 100;
    shell.classList.toggle('is-magnified', zoomed);
    shell.classList.toggle('is-mag-inverted', prefs.invertColors);
    if (zoomed) {
      shell.style.setProperty('--wow-mag-zoom', String(zoom / 100));
      shell.style.setProperty('--wow-mag-ox', `${originX.toFixed(1)}%`);
      shell.style.setProperty('--wow-mag-oy', `${originY.toFixed(1)}%`);
    } else {
      shell.style.removeProperty('--wow-mag-zoom');
      shell.style.removeProperty('--wow-mag-ox');
      shell.style.removeProperty('--wow-mag-oy');
    }
  }

  function stopReading() {
    reading = false;
    try {
      window.speechSynthesis?.cancel();
    } catch {}
  }

  function speakSegment(idx: number) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (readSegments.length === 0) readSegments = collectReadableSegments();
    if (readSegments.length === 0) return;
    readIndex = Math.max(0, Math.min(readSegments.length - 1, idx));
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(readSegments[readIndex]);
      utter.lang = 'zh-CN';
      utter.onend = () => {
        if (!reading) return;
        if (readIndex + 1 < readSegments.length) {
          speakSegment(readIndex + 1);
        } else {
          reading = false;
          if (open) render();
        }
      };
      utter.onerror = () => {
        reading = false;
        if (open) render();
      };
      reading = true;
      window.speechSynthesis.speak(utter);
    } catch {
      reading = false;
    }
    if (open) render();
  }

  function toggleReadPickMode(force?: boolean) {
    readPickMode = force ?? !readPickMode;
    document.body.classList.toggle('w11-mag-pick-mode', readPickMode);
    if (open) render();
  }

  function setZoom(next: number) {
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(next)));
    if (zoom === 100) {
      originX = 50;
      originY = 50;
    }
    applyZoomToShell();
    if (open) render();
  }

  function panBy(dx: number, dy: number) {
    originX = Math.max(0, Math.min(100, originX + dx));
    originY = Math.max(0, Math.min(100, originY + dy));
    applyZoomToShell();
  }

  function bindGlobal() {
    if (globalBound || typeof window === 'undefined') return;
    globalBound = true;

    window.addEventListener(
      'pointermove',
      (e) => {
        if (!open || zoom <= 100 || prefs.mode !== 'follow') return;
        if ((e.target as HTMLElement | null)?.closest('[data-wow-magnifier],[data-wow-touch-keyboard]')) return;
        const w = Math.max(1, window.innerWidth);
        const h = Math.max(1, window.innerHeight);
        originX = Math.max(0, Math.min(100, (e.clientX / w) * 100));
        originY = Math.max(0, Math.min(100, (e.clientY / h) * 100));
        applyZoomToShell();
      },
      { passive: true },
    );

    window.addEventListener(
      'click',
      (e) => {
        if (!readPickMode) return;
        const target = e.target as HTMLElement | null;
        if (!target || target.closest('[data-wow-magnifier]')) return;
        e.preventDefault();
        e.stopPropagation();
        toggleReadPickMode(false);
        const text = (target.textContent ?? target.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim();
        if (text) {
          readSegments = [text];
          speakSegment(0);
        }
      },
      true,
    );

    window.addEventListener('keydown', (e) => {
      if (!open) return;
      if (e.key === 'Escape' && readPickMode) {
        toggleReadPickMode(false);
        return;
      }
      if (e.altKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setZoom(zoom + prefs.step);
      } else if (e.altKey && e.key === '-') {
        e.preventDefault();
        setZoom(zoom - prefs.step);
      }
    });
  }

  function applyPos() {
    if (!rootEl || minimized) return;
    if (!pos) {
      pos = {
        left: window.innerWidth <= 720 ? 8 : Math.max(16, Math.round(window.innerWidth * 0.08)),
        top: window.innerWidth <= 720 ? 10 : Math.max(18, Math.round(window.innerHeight * 0.18)),
      };
    }
    const maxLeft = Math.max(8, window.innerWidth - (rootEl.offsetWidth || 368) - 8);
    const maxTop = Math.max(8, window.innerHeight - 76);
    pos.left = Math.max(8, Math.min(maxLeft, pos.left));
    pos.top = Math.max(8, Math.min(maxTop, pos.top));
    rootEl.style.left = `${pos.left}px`;
    rootEl.style.top = `${pos.top}px`;
  }

  function render() {
    if (!open) {
      rootEl?.remove();
      rootEl = null;
      return;
    }

    if (minimized) {
      if (!rootEl || !rootEl.classList.contains('w11-mag-pill')) {
        rootEl?.remove();
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'w11-mag-pill';
        pill.dataset.wowMagnifier = '1';
        pill.title = '还原放大镜工具栏';
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          minimized = false;
          render();
        });
        rootEl = pill;
        document.body.append(rootEl);
      }
      rootEl.innerHTML = `${MAG_ICONS.app}<span>${zoom}%</span>`;
      return;
    }

    if (!rootEl || !rootEl.classList.contains('w11-mag')) {
      rootEl?.remove();
      rootEl = document.createElement('section');
      rootEl.className = 'w11-mag';
      rootEl.dataset.wowMagnifier = '1';
      rootEl.setAttribute('aria-label', '放大镜');
      rootEl.addEventListener('click', (e) => e.stopPropagation());
      document.body.append(rootEl);
    }
    rootEl.replaceChildren();

    // 标题栏（支持拖动）
    const titleBar = document.createElement('div');
    titleBar.className = 'w11-mag-titlebar';

    const title = document.createElement('div');
    title.className = 'w11-mag-title';
    title.innerHTML = `${MAG_ICONS.app}<span>放大镜</span>`;

    const winBtns = document.createElement('div');
    winBtns.className = 'w11-mag-winbtns';

    const minBtn = document.createElement('button');
    minBtn.type = 'button';
    minBtn.className = 'w11-mag-winbtn';
    minBtn.title = '最小化';
    minBtn.textContent = '─';
    minBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    minBtn.addEventListener('click', () => {
      minimized = true;
      settingsOpen = false;
      render();
    });

    const maxBtn = document.createElement('button');
    maxBtn.type = 'button';
    maxBtn.className = 'w11-mag-winbtn is-disabled';
    maxBtn.disabled = true;
    maxBtn.textContent = '□';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'w11-mag-winbtn is-close';
    closeBtn.title = '关闭放大镜';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    closeBtn.addEventListener('click', () => close());

    winBtns.append(minBtn, maxBtn, closeBtn);
    titleBar.append(title, winBtns);

    titleBar.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      const rect = rootEl!.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      const onMove = (ev: PointerEvent) => {
        pos = {
          left: Math.round(ev.clientX - ox),
          top: Math.round(ev.clientY - oy),
        };
        applyPos();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    // 主工具栏（1:1 复刻 Win11 放大镜按钮顺序）
    const toolbar = document.createElement('div');
    toolbar.className = 'w11-mag-toolbar';

    const makeBtn = (
      html: string,
      tooltip: string,
      onClick: () => void,
      opts: { disabled?: boolean; active?: boolean } = {},
    ) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = opts.active ? 'w11-mag-btn is-active' : 'w11-mag-btn';
      btn.title = tooltip;
      btn.setAttribute('aria-label', tooltip);
      btn.disabled = Boolean(opts.disabled);
      btn.innerHTML = html;
      btn.addEventListener('click', onClick);
      return btn;
    };

    const makeSep = () => {
      const s = document.createElement('span');
      s.className = 'w11-mag-sep';
      return s;
    };

    const zoomOutBtn = makeBtn('−', `缩小 (-${prefs.step}%)`, () => setZoom(zoom - prefs.step), {
      disabled: zoom <= MIN_ZOOM,
    });

    const zoomReadout = document.createElement('button');
    zoomReadout.type = 'button';
    zoomReadout.className = 'w11-mag-zoom-readout';
    zoomReadout.title = zoom === 100 ? '点击放大一级' : '点击重置为 100%';
    zoomReadout.textContent = `${zoom}%`;
    zoomReadout.addEventListener('click', () => {
      setZoom(zoom === 100 ? 100 + prefs.step : 100);
    });

    const zoomInBtn = makeBtn('+', `放大 (+${prefs.step}%)`, () => setZoom(zoom + prefs.step), {
      disabled: zoom >= MAX_ZOOM,
    });

    const fullViewBtn = makeBtn(
      MAG_ICONS.viewFull,
      '全屏跟随指针放大',
      () => {
        prefs.mode = 'follow';
        savePrefs(prefs);
        render();
      },
      { active: prefs.mode === 'follow' },
    );

    const centerViewBtn = makeBtn(
      MAG_ICONS.viewCenter,
      '固定焦点 / 触控平移视图',
      () => {
        prefs.mode = 'center';
        savePrefs(prefs);
        render();
      },
      { active: prefs.mode === 'center' },
    );

    const prevBtn = makeBtn(MAG_ICONS.prev, '朗读上一句', () => speakSegment(readIndex - 1));
    const playBtn = makeBtn(
      reading ? MAG_ICONS.pause : MAG_ICONS.play,
      reading ? '停止朗读' : '朗读当前界面',
      () => {
        if (reading) {
          stopReading();
          render();
        } else {
          readSegments = collectReadableSegments();
          speakSegment(0);
        }
      },
      { active: reading },
    );
    const nextBtn = makeBtn(MAG_ICONS.next, '朗读下一句', () => speakSegment(readIndex + 1));
    const readHereBtn = makeBtn(
      MAG_ICONS.readHere,
      '从此处朗读（点击页面任意文字）',
      () => toggleReadPickMode(),
      { active: readPickMode },
    );

    const settingsBtn = makeBtn(
      MAG_ICONS.settings,
      '放大镜设置',
      () => {
        settingsOpen = !settingsOpen;
        render();
      },
      { active: settingsOpen },
    );

    toolbar.append(
      zoomOutBtn,
      zoomReadout,
      zoomInBtn,
      makeSep(),
      fullViewBtn,
      centerViewBtn,
      makeSep(),
      prevBtn,
      playBtn,
      nextBtn,
      readHereBtn,
      makeSep(),
      settingsBtn,
    );

    rootEl.append(titleBar, toolbar);

    // 缩放 > 100% 且移动端或固定焦点模式时提供一键平移方向条
    if (zoom > 100 && (prefs.mode === 'center' || window.innerWidth <= 768)) {
      const panBar = document.createElement('div');
      panBar.className = 'w11-mag-panbar';
      const tip = document.createElement('span');
      tip.textContent = '视野平移';
      const btns = document.createElement('div');
      btns.className = 'w11-mag-panbtns';
      const pans: Array<[string, () => void]> = [
        ['←', () => panBy(-14, 0)],
        ['↑', () => panBy(0, -14)],
        ['↓', () => panBy(0, 14)],
        ['→', () => panBy(14, 0)],
        [
          '居中',
          () => {
            originX = 50;
            originY = 50;
            applyZoomToShell();
          },
        ],
      ];
      for (const [label, fnPan] of pans) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'w11-mag-panbtn';
        b.textContent = label;
        b.addEventListener('click', fnPan);
        btns.append(b);
      }
      panBar.append(tip, btns);
      rootEl.append(panBar);
    }

    if (settingsOpen) {
      const panel = document.createElement('div');
      panel.className = 'w11-mag-settings';

      const stepRow = document.createElement('div');
      stepRow.className = 'w11-mag-set-row';
      const stepLabel = document.createElement('span');
      stepLabel.textContent = '缩放增量';
      const stepChips = document.createElement('div');
      stepChips.className = 'w11-mag-set-chips';
      for (const val of [25, 50, 100] as const) {
        const c = document.createElement('button');
        c.type = 'button';
        c.className = prefs.step === val ? 'w11-mag-chip is-active' : 'w11-mag-chip';
        c.textContent = `${val}%`;
        c.addEventListener('click', () => {
          prefs.step = val;
          savePrefs(prefs);
          render();
        });
        stepChips.append(c);
      }
      stepRow.append(stepLabel, stepChips);

      const invRow = document.createElement('div');
      invRow.className = 'w11-mag-set-row';
      const invLabel = document.createElement('span');
      invLabel.textContent = '颜色反转';
      const invBtn = document.createElement('button');
      invBtn.type = 'button';
      invBtn.className = prefs.invertColors ? 'w11-mag-chip is-active' : 'w11-mag-chip';
      invBtn.textContent = prefs.invertColors ? '已打开' : '已关闭';
      invBtn.addEventListener('click', () => {
        prefs.invertColors = !prefs.invertColors;
        savePrefs(prefs);
        applyZoomToShell();
        render();
      });
      invRow.append(invLabel, invBtn);

      const hint = document.createElement('div');
      hint.className = 'w11-mag-hint';
      hint.textContent = '快捷键：Alt + = 放大，Alt + - 缩小';

      panel.append(stepRow, invRow, hint);
      rootEl.append(panel);
    }

    applyPos();
  }

  function openMagnifier() {
    bindGlobal();
    if (open) {
      minimized = false;
      render();
      return;
    }
    open = true;
    minimized = false;
    applyZoomToShell();
    render();
    notify();
  }

  function close() {
    if (!open) return;
    open = false;
    minimized = false;
    settingsOpen = false;
    zoom = 100;
    originX = 50;
    originY = 50;
    toggleReadPickMode(false);
    stopReading();
    applyZoomToShell();
    render();
    notify();
  }

  function toggle() {
    if (open) close();
    else openMagnifier();
  }

  return {
    open: openMagnifier,
    close,
    toggle,
    isOpen: () => open,
    getZoom: () => zoom,
    subscribe(cb: (isOpen: boolean) => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export const magnifierController = createMagnifierController();
