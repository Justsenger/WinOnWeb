import './oobe.css';
import {
  completeOobe,
  skipOobeAsAdministrator,
  WIN11_SECURITY_QUESTIONS,
} from '../../../wow/kernel/account';
import { magnifierController } from '../apps/magnifier-app';
import { touchKeyboardController } from '../apps/touch-keyboard-app';

type OobeStep = 'name' | 'password' | 'confirm' | 'q1' | 'q2' | 'q3';

function illustrationSvg(): string {
  // 1:1 复刻 Windows 11 OOBE 本地账户创建全流程统一的三圆叠加人物插画
  return `<svg width="260" height="260" viewBox="0 0 260 260" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="oobeUserGrad" x1="42" y1="92" x2="158" y2="218" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#0078d4"/>
          <stop offset="58%" stop-color="#2855d8"/>
          <stop offset="100%" stop-color="#5b34cc"/>
        </linearGradient>
      </defs>
      <!-- 正上方小暖灰圆点 -->
      <circle cx="104" cy="58" r="19" fill="#e5e3e0"/>
      <!-- 右后方中暖灰圆 + 浅白人物剪影 -->
      <circle cx="176" cy="108" r="46" fill="#e5e3e0"/>
      <circle cx="176" cy="95" r="13.5" fill="#f3f2f0"/>
      <path d="M154 128c2.2-11.5 10.6-17.5 22-17.5s19.8 6 22 17.5c-5.6 5.6-13.4 9-22 9s-16.4-3.4-22-9z" fill="#f3f2f0"/>
      <!-- 前景大蓝紫渐变圆 + 半透明人物剪影 -->
      <circle cx="104" cy="156" r="64" fill="url(#oobeUserGrad)"/>
      <circle cx="104" cy="138" r="19" fill="rgba(165, 198, 255, 0.36)"/>
      <path d="M72 184c3.4-16 15.2-24 32-24s28.6 8 32 24c-8.2 8.2-19.5 13.2-32 13.2S80.2 192.2 72 184z" fill="rgba(165, 198, 255, 0.34)"/>
    </svg>`;
}

export interface OobeAudioBridge {
  getVolume: () => number;
  setVolume: (vol: number) => void;
}

export function showWin11Oobe(
  root: HTMLElement,
  onDone: () => void,
  audioBridge?: OobeAudioBridge,
): { isOpen: () => boolean } {
  let step: OobeStep = 'name';
  let username = '';
  let password = '';
  let confirmPassword = '';
  const selectedQuestions: [string, string, string] = ['', '', ''];
  const answers: [string, string, string] = ['', '', ''];
  let errorText = '';
  let open = true;
  let activePopover: 'none' | 'a11y' = 'none';
  const a11y = {
    magnifier: magnifierController.isOpen(),
    highContrast: false,
    narrator: false,
    voiceAccess: false,
    osk: touchKeyboardController.isOpen(),
    stickyKeys: false,
    filterKeys: false,
  };
  let stickyShiftArmed = false;
  let lastFilteredKey = { key: '', at: 0 };
  let lastFocusedInput: HTMLInputElement | null = null;
  let voiceBarEl: HTMLElement | null = null;
  let voiceRecognition: { stop: () => void } | null = null;

  const backdrop = document.createElement('div');
  backdrop.className = 'w11-oobe-backdrop';
  backdrop.dataset.oobeScreen = '1';

  const stage = document.createElement('div');
  stage.className = 'w11-oobe-stage';

  const card = document.createElement('section');
  card.className = 'w11-oobe-card';
  card.setAttribute('aria-label', 'Windows 11 账户设置');

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'w11-oobe-back';
  backBtn.title = '返回';
  backBtn.setAttribute('aria-label', '返回');
  backBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8H2.5M7 3.5L2.5 8L7 12.5"/></svg>`;

  const artEl = document.createElement('div');
  artEl.className = 'w11-oobe-art';

  const mainEl = document.createElement('div');
  mainEl.className = 'w11-oobe-main';

  card.append(backBtn, artEl, mainEl);

  function speakText(text: string) {
    if (!a11y.narrator || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'zh-CN';
      const vol = audioBridge ? audioBridge.getVolume() : 65;
      utter.volume = Math.max(0, Math.min(1, vol / 100));
      window.speechSynthesis.speak(utter);
    } catch {}
  }

  // 紧贴白色卡片右下方外沿的辅助功能可交互微件（1:1 对照最新 Win11 真机）
  const footerIcons = document.createElement('div');
  footerIcons.className = 'w11-oobe-footer-icons';

  const a11yAnchor = document.createElement('div');
  a11yAnchor.className = 'w11-oobe-a11y-anchor';

  const a11yBtn = document.createElement('button');
  a11yBtn.type = 'button';
  a11yBtn.className = 'w11-oobe-footer-btn';
  a11yBtn.title = '辅助功能';
  a11yBtn.setAttribute('aria-label', '辅助功能');
  a11yBtn.setAttribute('aria-expanded', 'false');
  a11yBtn.innerHTML = `<svg width="16" height="16" viewBox="2.66 0 16 16" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M17.66 4.01 C17.66 4.18 17.64 4.36 17.58 4.53 C17.53 4.7 17.45 4.85 17.35 5 C17.25 5.14 17.13 5.27 17 5.38 C16.86 5.48 16.71 5.57 16.54 5.63 L13.66 6.73 L13.66 9.12 C13.66 9.14 13.7 9.25 13.77 9.45 C13.85 9.66 13.94 9.91 14.05 10.21 C14.16 10.52 14.29 10.85 14.42 11.21 C14.55 11.58 14.68 11.92 14.8 12.25 C14.92 12.58 15.03 12.88 15.12 13.13 C15.21 13.39 15.27 13.56 15.3 13.65 C15.34 13.75 15.36 13.85 15.38 13.95 C15.4 14.04 15.41 14.15 15.41 14.25 C15.41 14.49 15.37 14.72 15.28 14.93 C15.19 15.14 15.06 15.33 14.9 15.49 C14.74 15.65 14.55 15.77 14.34 15.86 C14.12 15.95 13.9 16 13.66 16 C13.47 16 13.3 15.97 13.13 15.92 C12.96 15.86 12.8 15.79 12.66 15.68 C12.51 15.58 12.38 15.46 12.27 15.32 C12.16 15.17 12.08 15.02 12.02 14.84 L10.66 11.12 L9.3 14.84 C9.24 15.02 9.16 15.18 9.05 15.32 C8.94 15.46 8.81 15.58 8.67 15.68 C8.52 15.79 8.37 15.86 8.2 15.92 C8.03 15.97 7.85 16 7.66 16 C7.42 16 7.2 15.95 6.98 15.86 C6.77 15.77 6.58 15.65 6.43 15.49 C6.27 15.33 6.14 15.14 6.05 14.93 C5.96 14.72 5.91 14.49 5.91 14.25 C5.91 14.15 5.92 14.04 5.95 13.95 C5.97 13.85 5.99 13.75 6.02 13.65 C6.04 13.58 6.08 13.47 6.14 13.3 C6.2 13.14 6.27 12.95 6.36 12.73 C6.44 12.51 6.52 12.27 6.62 12.01 C6.72 11.75 6.81 11.49 6.91 11.22 C7.01 10.96 7.1 10.7 7.19 10.46 C7.28 10.21 7.36 9.99 7.43 9.8 C7.5 9.6 7.56 9.45 7.6 9.33 C7.64 9.21 7.66 9.14 7.66 9.13 L7.66 6.73 L4.79 5.63 C4.62 5.57 4.46 5.48 4.32 5.37 C4.19 5.26 4.07 5.13 3.97 4.99 C3.88 4.85 3.8 4.7 3.75 4.53 C3.69 4.36 3.66 4.18 3.66 4 C3.66 3.76 3.71 3.53 3.8 3.32 C3.89 3.11 4.02 2.92 4.18 2.76 C4.33 2.6 4.52 2.48 4.73 2.39 C4.94 2.3 5.17 2.25 5.41 2.25 C5.63 2.25 5.84 2.29 6.04 2.37 L8.27 3.22 C8.23 3.09 8.2 2.97 8.19 2.84 C8.17 2.71 8.16 2.58 8.16 2.45 C8.16 2.11 8.23 1.79 8.37 1.49 C8.5 1.2 8.68 0.94 8.91 0.71 C9.14 0.49 9.41 0.32 9.71 0.19 C10.01 0.06 10.33 0 10.66 0 C11 0 11.32 0.06 11.62 0.19 C11.92 0.32 12.18 0.49 12.41 0.71 C12.64 0.94 12.83 1.2 12.96 1.49 C13.1 1.79 13.16 2.11 13.16 2.45 C13.16 2.58 13.16 2.71 13.14 2.84 C13.12 2.97 13.1 3.09 13.05 3.22 L15.29 2.37 C15.49 2.29 15.7 2.25 15.91 2.25 C16.15 2.25 16.38 2.3 16.59 2.39 C16.81 2.48 16.99 2.6 17.15 2.77 C17.31 2.93 17.44 3.11 17.53 3.33 C17.62 3.54 17.66 3.77 17.66 4.01 Z M9.16 2.5 C9.16 2.7 9.2 2.9 9.28 3.08 C9.36 3.26 9.47 3.42 9.61 3.56 C9.74 3.7 9.9 3.8 10.09 3.88 C10.27 3.96 10.46 4 10.66 4 C10.87 4 11.06 3.96 11.24 3.88 C11.42 3.8 11.58 3.7 11.72 3.56 C11.86 3.42 11.97 3.26 12.05 3.08 C12.12 2.9 12.16 2.7 12.16 2.5 C12.16 2.3 12.12 2.1 12.05 1.92 C11.97 1.74 11.86 1.58 11.72 1.44 C11.58 1.3 11.42 1.2 11.24 1.12 C11.06 1.04 10.87 1 10.66 1 C10.46 1 10.27 1.04 10.09 1.12 C9.9 1.2 9.74 1.3 9.61 1.44 C9.47 1.58 9.36 1.74 9.28 1.92 C9.2 2.1 9.16 2.3 9.16 2.5 Z M16.66 3.99 C16.66 3.89 16.64 3.8 16.61 3.71 C16.57 3.62 16.51 3.54 16.44 3.47 C16.37 3.4 16.29 3.35 16.2 3.31 C16.11 3.27 16.01 3.25 15.91 3.25 C15.82 3.25 15.73 3.27 15.65 3.3 L11.46 4.89 C11.34 4.94 11.21 4.97 11.07 5 C10.93 5.03 10.8 5.04 10.66 5.04 C10.4 5.04 10.13 4.99 9.86 4.89 L5.68 3.3 C5.59 3.27 5.5 3.25 5.41 3.25 C5.2 3.25 5.02 3.32 4.88 3.46 C4.74 3.61 4.66 3.79 4.66 4 C4.66 4.16 4.71 4.3 4.79 4.43 C4.88 4.55 5 4.65 5.15 4.7 L8.34 5.91 C8.44 5.95 8.52 6.01 8.58 6.1 C8.64 6.18 8.66 6.28 8.66 6.38 L8.66 9.22 C8.66 9.29 8.65 9.34 8.63 9.39 L6.96 13.99 C6.93 14.08 6.91 14.17 6.91 14.25 C6.91 14.46 6.99 14.64 7.13 14.78 C7.28 14.93 7.46 15 7.66 15 C7.82 15 7.96 14.96 8.09 14.87 C8.22 14.78 8.31 14.66 8.37 14.51 L9.73 10.78 C9.8 10.57 9.92 10.41 10.08 10.29 C10.25 10.18 10.44 10.12 10.66 10.12 C10.89 10.12 11.08 10.18 11.25 10.29 C11.41 10.41 11.53 10.57 11.6 10.78 L12.96 14.51 C13.02 14.66 13.11 14.78 13.23 14.87 C13.36 14.96 13.5 15 13.66 15 C13.87 15 14.05 14.93 14.2 14.78 C14.34 14.64 14.41 14.46 14.41 14.25 C14.41 14.17 14.4 14.08 14.37 13.99 L12.7 9.39 C12.67 9.34 12.66 9.29 12.66 9.22 L12.66 6.38 C12.66 6.28 12.69 6.18 12.75 6.1 C12.81 6.01 12.89 5.95 12.98 5.91 L16.18 4.7 C16.33 4.65 16.45 4.55 16.54 4.43 C16.62 4.3 16.66 4.15 16.66 3.99 Z"/></svg>`;

  const popoverEl = document.createElement('div');
  popoverEl.className = 'w11-oobe-popover';
  popoverEl.hidden = true;

  a11yAnchor.append(a11yBtn, popoverEl);
  footerIcons.append(a11yAnchor);
  stage.append(card, footerIcons);
  backdrop.append(stage);
  root.appendChild(backdrop);

  backdrop.addEventListener('focusin', (e) => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement) {
      lastFocusedInput = target;
    }
  });

  // 双向同步独立系统应用（放大镜、屏幕键盘）的开关状态
  const unsubMag = magnifierController.subscribe((isOpen) => {
    a11y.magnifier = isOpen;
    if (open && activePopover === 'a11y') renderPopover();
  });
  const unsubTkb = touchKeyboardController.subscribe((isOpen) => {
    a11y.osk = isOpen;
    if (open && activePopover === 'a11y') renderPopover();
  });

  // 粘滞键 & 筛选键真实键盘拦截
  backdrop.addEventListener(
    'keydown',
    (e) => {
      if (a11y.filterKeys && e.key.length === 1) {
        const now = performance.now();
        if (lastFilteredKey.key === e.key && now - lastFilteredKey.at < 200) {
          e.preventDefault();
          return;
        }
        lastFilteredKey = { key: e.key, at: now };
      }
      if (a11y.stickyKeys) {
        if (e.key === 'Shift') {
          stickyShiftArmed = true;
          return;
        }
        if (stickyShiftArmed && e.key.length === 1 && /[a-z]/.test(e.key) && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          stickyShiftArmed = false;
          const t = e.target;
          const start = t.selectionStart ?? t.value.length;
          const end = t.selectionEnd ?? t.value.length;
          const up = e.key.toUpperCase();
          t.value = t.value.slice(0, start) + up + t.value.slice(end);
          t.setSelectionRange(start + 1, start + 1);
          t.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    },
    true,
  );

  function stopVoiceAccess() {
    try {
      voiceRecognition?.stop();
    } catch {}
    voiceRecognition = null;
    voiceBarEl?.remove();
    voiceBarEl = null;
  }

  function syncVoiceAccess() {
    if (!a11y.voiceAccess) {
      stopVoiceAccess();
      return;
    }
    if (!voiceBarEl) {
      voiceBarEl = document.createElement('div');
      voiceBarEl.className = 'w11-oobe-voice-bar';
      backdrop.append(voiceBarEl);
    }
    const updateBar = (status: string, listening: boolean) => {
      if (!voiceBarEl) return;
      voiceBarEl.replaceChildren();
      const dot = document.createElement('span');
      dot.className = listening ? 'w11-oobe-voice-dot is-listening' : 'w11-oobe-voice-dot';
      const txt = document.createElement('span');
      txt.textContent = status;
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'w11-oobe-voice-close';
      closeBtn.title = '关闭语音访问';
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', () => {
        a11y.voiceAccess = false;
        stopVoiceAccess();
        if (activePopover === 'a11y') renderPopover();
      });
      voiceBarEl.append(dot, txt, closeBtn);
    };

    const SR =
      (window as unknown as Record<string, unknown>).SpeechRecognition ??
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (typeof SR !== 'function') {
      updateBar('语音访问已开启（当前浏览器不支持语音识别 API）', false);
      return;
    }
    try {
      const rec = new (SR as new () => {
        lang: string;
        continuous: boolean;
        interimResults: boolean;
        onstart: (() => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
        onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
        start: () => void;
        stop: () => void;
      })();
      rec.lang = 'zh-CN';
      rec.continuous = true;
      rec.interimResults = false;
      rec.onstart = () => updateBar('语音访问 · 正在侦听（说“下一页”“以后再说”或直接口述）', true);
      rec.onerror = () => updateBar('语音访问 · 未获取到麦克风权限', false);
      rec.onend = () => {
        if (a11y.voiceAccess && open) {
          updateBar('语音访问 · 已暂停', false);
        }
      };
      rec.onresult = (ev) => {
        const last = ev.results[ev.results.length - 1];
        const transcript = last?.[0]?.transcript?.trim() ?? '';
        if (!transcript) return;
        updateBar(`语音访问 · 已识别：“${transcript}”`, true);
        if (transcript.includes('下一页') || transcript.includes('下一步')) {
          mainEl.querySelector<HTMLFormElement>('form')?.requestSubmit();
          return;
        }
        if (transcript.includes('以后再说') && step === 'name') {
          skipOobeAsAdministrator();
          closeAndFinish();
          return;
        }
        if (transcript.includes('返回') && step !== 'name') {
          backBtn.click();
          return;
        }
        const target =
          lastFocusedInput && lastFocusedInput.isConnected
            ? lastFocusedInput
            : mainEl.querySelector<HTMLInputElement>('input');
        if (target) {
          target.value = transcript;
          target.focus();
          target.dispatchEvent(new Event('input', { bubbles: true }));
        }
      };
      voiceRecognition = rec;
      updateBar('语音访问 · 正在启动麦克风...', false);
      rec.start();
    } catch {
      updateBar('语音访问 · 启动失败', false);
    }
  }

  function renderPopover() {
    a11yBtn.setAttribute('aria-expanded', String(activePopover === 'a11y'));
    if (activePopover === 'none') {
      popoverEl.hidden = true;
      return;
    }
    popoverEl.hidden = false;
    popoverEl.style.setProperty('--popover-shift-x', '0px');
    popoverEl.replaceChildren();

    // activePopover === 'a11y' —— 1:1 复刻最新 Win11 OOBE 7 项无障碍菜单
    const A11Y_ICONS: Record<keyof typeof a11y, string> = {
      magnifier:
        '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="7" r="4.8"/><path d="M10.6 10.6L14 14M5 7h4M7 5v4" stroke-linecap="round"/></svg>',
      highContrast:
        '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="currentColor"/></svg>',
      narrator:
        '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><path d="M7.5 4.2H2.8A1.2 1.2 0 0 0 1.6 5.4v5.4A1.2 1.2 0 0 0 2.8 12h7.4a1.2 1.2 0 0 0 1.2-1.2V8.8" stroke-linecap="round"/><path d="M4.2 14h4.6M6.5 12v2" stroke-linecap="round"/><rect x="7.8" y="1.8" width="6.6" height="5.2" rx="1.4" fill="currentColor" stroke="none"/><path d="M9.4 7l-1.2 1.5V6.6" fill="currentColor" stroke="none"/></svg>',
      voiceAccess:
        '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><circle cx="6" cy="5.4" r="2.2"/><path d="M2.5 13c.5-2.3 1.8-3.4 3.5-3.4s3 1.1 3.5 3.4M11 4.8a2.5 2.5 0 0 1 0 3.4M12.8 3.4a4.5 4.5 0 0 1 0 6.2" stroke-linecap="round"/></svg>',
      osk: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><rect x="1.5" y="4" width="13" height="8" rx="1.2"/><path d="M3.8 6.4h1.1M6.6 6.4h1.1M9.4 6.4h1.1M12.1 6.4h.6M3.8 8.4h1.1M6.6 8.4h2.8M11.2 8.4h1.2M4.8 10.2h6.4" stroke-linecap="round"/></svg>',
      stickyKeys:
        '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><path d="M13.5 7.5V4.8a1.1 1.1 0 0 0-1.1-1.1H2.6a1.1 1.1 0 0 0-1.1 1.1v5.8a1.1 1.1 0 0 0 1.1 1.1h4.2" stroke-linecap="round"/><path d="M3.6 6.2h1.2M6.4 6.2h1.2M9.2 6.2h1.2M3.6 8.6h2.8" stroke-linecap="round"/><rect x="8.8" y="8.4" width="3.8" height="2.4" rx="0.5" fill="currentColor" stroke="none"/><rect x="8.2" y="11.6" width="6.2" height="2.6" rx="0.5" fill="currentColor" stroke="none"/></svg>',
      filterKeys:
        '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><path d="M13.5 7.2V4.6a1.1 1.1 0 0 0-1.1-1.1H2.6a1.1 1.1 0 0 0-1.1 1.1v5.8a1.1 1.1 0 0 0 1.1 1.1h4.2" stroke-linecap="round"/><path d="M3.6 6h1.2M6.4 6h1.2M9.2 6h1.2M3.6 8.4h2.6" stroke-linecap="round"/><circle cx="11.2" cy="11.2" r="3.2" fill="currentColor" stroke="none"/><path d="M11.2 9.5v1.8l1.2.8" stroke="#ffffff" stroke-width="1.1" stroke-linecap="round"/></svg>',
    };
    const items: Array<{ key: keyof typeof a11y; label: string }> = [
      { key: 'magnifier', label: '放大镜' },
      { key: 'highContrast', label: '对比度主题' },
      { key: 'narrator', label: '讲述人' },
      { key: 'voiceAccess', label: '语音访问' },
      { key: 'osk', label: '屏幕键盘' },
      { key: 'stickyKeys', label: '粘滞键' },
      { key: 'filterKeys', label: '筛选键' },
    ];
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'w11-oobe-a11y-item';
      btn.setAttribute('role', 'switch');
      btn.setAttribute('aria-checked', String(a11y[item.key]));
      const ico = document.createElement('span');
      ico.className = 'w11-oobe-a11y-ico';
      ico.innerHTML = A11Y_ICONS[item.key];
      const label = document.createElement('span');
      label.className = 'w11-oobe-a11y-label';
      label.textContent = item.label;
      const stateText = document.createElement('span');
      stateText.className = 'w11-oobe-a11y-state';
      stateText.textContent = a11y[item.key] ? '打开' : '关闭';
      const sw = document.createElement('span');
      sw.className = 'w11-oobe-switch';
      btn.append(ico, label, stateText, sw);
      btn.addEventListener('click', () => {
        const next = !a11y[item.key];
        a11y[item.key] = next;
        backdrop.classList.toggle('is-high-contrast', a11y.highContrast);
        if (item.key === 'magnifier') {
          if (next) magnifierController.open();
          else magnifierController.close();
        }
        if (item.key === 'osk') {
          if (next) touchKeyboardController.open();
          else touchKeyboardController.close();
        }
        if (item.key === 'voiceAccess') syncVoiceAccess();
        if (item.key === 'narrator') {
          if (a11y.narrator) {
            const h1 = mainEl.querySelector('.w11-oobe-title')?.textContent ?? '';
            const subText = mainEl.querySelector('.w11-oobe-sub')?.textContent ?? '';
            speakText(`已打开讲述人。${h1} ${subText}`);
          } else {
            try {
              window.speechSynthesis?.cancel();
            } catch {}
          }
        } else if (a11y.narrator) {
          speakText(`${item.label}，${next ? '打开' : '关闭'}`);
        }
        renderPopover();
      });
      popoverEl.append(btn);
    }

    // 仅在极窄视口导致右侧超出屏幕边界时才微调，默认严格以无障碍图标为中心对称弹出
    const rect = popoverEl.getBoundingClientRect();
    const maxRight = window.innerWidth - 12;
    if (rect.right > maxRight) {
      popoverEl.style.setProperty('--popover-shift-x', `${Math.round(maxRight - rect.right)}px`);
    }
  }

  popoverEl.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  a11yBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    activePopover = activePopover === 'a11y' ? 'none' : 'a11y';
    renderPopover();
  });

  backdrop.addEventListener('click', (e) => {
    if (activePopover !== 'none' && !(e.target as HTMLElement).closest('.w11-oobe-footer-icons')) {
      activePopover = 'none';
      renderPopover();
    }
  });

  function closeAndFinish() {
    if (!open) return;
    open = false;
    unsubMag();
    unsubTkb();
    stopVoiceAccess();
    try {
      window.speechSynthesis?.cancel();
    } catch {}
    backdrop.classList.add('is-closing');
    window.setTimeout(() => {
      backdrop.remove();
      onDone();
    }, 220);
  }

  function createPasswordInput(
    labelText: string,
    placeholderText: string,
    initialValue: string,
    onChange: (val: string) => void,
  ) {
    const label = document.createElement('label');
    label.className = 'w11-oobe-label';
    label.textContent = labelText;

    const wrap = document.createElement('div');
    wrap.className = 'w11-oobe-field';
    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'w11-oobe-input';
    input.placeholder = placeholderText;
    input.value = initialValue;
    input.autocomplete = 'new-password';

    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'w11-oobe-eye';
    eye.title = '按住显示密码';
    eye.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1.5 8C3 4.8 5.3 3.5 8 3.5C10.7 3.5 13 4.8 14.5 8C13 11.2 10.7 12.5 8 12.5C5.3 12.5 3 11.2 1.5 8Z"/><circle cx="8" cy="8" r="1.9" fill="currentColor"/></svg>`;
    eye.hidden = initialValue.length === 0;
    eye.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.type = 'text';
    });
    const hide = () => {
      input.type = 'password';
    };
    eye.addEventListener('pointerup', hide);
    eye.addEventListener('pointerleave', hide);

    input.addEventListener('input', () => {
      onChange(input.value);
      eye.hidden = input.value.length === 0;
    });

    wrap.append(input, eye);
    return { label, wrap, input };
  }

  function render() {
    backBtn.hidden = step === 'name';
    artEl.innerHTML = illustrationSvg();
    mainEl.replaceChildren();

    const title = document.createElement('h1');
    title.className = 'w11-oobe-title';
    const sub = document.createElement('p');
    sub.className = 'w11-oobe-sub';
    const form = document.createElement('form');
    form.className = 'w11-oobe-form';
    const errorEl = document.createElement('div');
    errorEl.className = 'w11-oobe-error';
    errorEl.textContent = errorText;
    const actions = document.createElement('div');
    actions.className = 'w11-oobe-actions';

    if (step === 'name') {
      title.textContent = '谁将使用此设备?';
      sub.textContent = '将使用此名称登录到你的设备。';

      const label = document.createElement('label');
      label.className = 'w11-oobe-label';
      label.textContent = '输入你的姓名';

      const field = document.createElement('div');
      field.className = 'w11-oobe-field';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'w11-oobe-input';
      input.placeholder = '名称';
      input.value = username;
      input.maxLength = 32;
      input.autocomplete = 'username';

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'w11-oobe-clear';
      clearBtn.title = '清除';
      clearBtn.textContent = '✕';
      clearBtn.hidden = username.length === 0;
      clearBtn.addEventListener('click', () => {
        username = '';
        input.value = '';
        clearBtn.hidden = true;
        input.focus();
      });

      input.addEventListener('input', () => {
        username = input.value;
        clearBtn.hidden = input.value.length === 0;
        errorText = '';
        errorEl.textContent = '';
      });
      field.append(input, clearBtn);

      const skipBtn = document.createElement('button');
      skipBtn.type = 'button';
      skipBtn.className = 'w11-oobe-link';
      skipBtn.textContent = '以后再说';
      skipBtn.addEventListener('click', () => {
        skipOobeAsAdministrator();
        closeAndFinish();
      });

      const nextBtn = document.createElement('button');
      nextBtn.type = 'submit';
      nextBtn.className = 'w11-oobe-btn w11-oobe-btn--primary';
      nextBtn.textContent = '下一页';

      actions.append(skipBtn, nextBtn);
      form.append(label, field, errorEl, actions);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!username.trim()) {
          errorText = '请输入有效的用户名，或点击“以后再说”。';
          errorEl.textContent = errorText;
          input.focus();
          return;
        }
        errorText = '';
        step = 'password';
        render();
      });
      mainEl.append(title, sub, form);
      speakText(`${title.textContent} ${sub.textContent}`);
      window.setTimeout(() => input.focus(), 20);
      return;
    }

    if (step === 'password') {
      title.textContent = '创建容易记住的密码';
      sub.textContent = '请确保选择你一定会记住的内容。';

      const { label, wrap, input } = createPasswordInput('输入密码', '密码', password, (val) => {
        password = val;
        errorText = '';
        errorEl.textContent = '';
      });

      const nextBtn = document.createElement('button');
      nextBtn.type = 'submit';
      nextBtn.className = 'w11-oobe-btn w11-oobe-btn--primary';
      nextBtn.textContent = '下一页';
      actions.append(nextBtn);
      form.append(label, wrap, errorEl, actions);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!password) {
          await completeOobe({ username });
          closeAndFinish();
          return;
        }
        confirmPassword = '';
        errorText = '';
        step = 'confirm';
        render();
      });
      mainEl.append(title, sub, form);
      speakText(`${title.textContent} ${sub.textContent}`);
      window.setTimeout(() => input.focus(), 20);
      return;
    }

    if (step === 'confirm') {
      title.textContent = '确认你的密码';
      sub.textContent = '';
      sub.classList.add('is-empty');

      const { label, wrap, input } = createPasswordInput('输入密码', '确认密码', confirmPassword, (val) => {
        confirmPassword = val;
        errorText = '';
        errorEl.textContent = '';
      });

      const nextBtn = document.createElement('button');
      nextBtn.type = 'submit';
      nextBtn.className = 'w11-oobe-btn w11-oobe-btn--primary';
      nextBtn.textContent = '下一页';
      actions.append(nextBtn);
      form.append(label, wrap, errorEl, actions);

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (confirmPassword !== password) {
          errorText = '密码不匹配。';
          errorEl.textContent = errorText;
          input.focus();
          return;
        }
        errorText = '';
        step = 'q1';
        render();
      });
      mainEl.append(title, sub, form);
      speakText(title.textContent);
      window.setTimeout(() => input.focus(), 20);
      return;
    }

    // step === 'q1' | 'q2' | 'q3' —— 1:1 对照真机分 3 步逐题设置安全问题
    const qIndex = step === 'q1' ? 0 : step === 'q2' ? 1 : 2;
    title.textContent = '为此账户添加安全问题';
    sub.textContent = '以防你忘记密码，请选择 3 个安全问题，以帮助你重置密码。';

    const usedElsewhere = new Set(selectedQuestions.filter((q, idx) => idx < qIndex && Boolean(q)));

    const group = document.createElement('div');
    group.className = 'w11-oobe-qa-group';

    const sel = document.createElement('select');
    sel.className = 'w11-oobe-select';
    const placeholderOpt = document.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.textContent = `安全问题 (${qIndex + 1}/3)`;
    sel.append(placeholderOpt);
    for (const q of WIN11_SECURITY_QUESTIONS) {
      if (usedElsewhere.has(q)) continue;
      const opt = document.createElement('option');
      opt.value = q;
      opt.textContent = q;
      sel.append(opt);
    }
    if (usedElsewhere.has(selectedQuestions[qIndex])) {
      selectedQuestions[qIndex] = '';
    }
    sel.value = selectedQuestions[qIndex];
    sel.addEventListener('change', () => {
      selectedQuestions[qIndex] = sel.value;
      errorText = '';
      errorEl.textContent = '';
    });

    const ansField = document.createElement('div');
    ansField.className = 'w11-oobe-field';
    const ans = document.createElement('input');
    ans.type = 'text';
    ans.className = 'w11-oobe-input';
    ans.placeholder = '你的答案';
    ans.value = answers[qIndex];
    ans.addEventListener('input', () => {
      answers[qIndex] = ans.value;
      errorText = '';
      errorEl.textContent = '';
    });
    ansField.append(ans);

    group.append(sel, ansField);
    form.append(group);

    const nextBtn = document.createElement('button');
    nextBtn.type = 'submit';
    nextBtn.className = 'w11-oobe-btn w11-oobe-btn--primary';
    nextBtn.textContent = '下一页';
    actions.append(nextBtn);
    form.append(errorEl, actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!selectedQuestions[qIndex]) {
        errorText = '请选择一个安全问题。';
        errorEl.textContent = errorText;
        sel.focus();
        return;
      }
      if (!answers[qIndex].trim()) {
        errorText = '请输入此安全问题的答案。';
        errorEl.textContent = errorText;
        ans.focus();
        return;
      }
      errorText = '';
      if (step === 'q1') {
        step = 'q2';
        render();
        return;
      }
      if (step === 'q2') {
        step = 'q3';
        render();
        return;
      }
      try {
        await completeOobe({
          username,
          password,
          securityQuestions: [
            { question: selectedQuestions[0], answer: answers[0] },
            { question: selectedQuestions[1], answer: answers[1] },
            { question: selectedQuestions[2], answer: answers[2] },
          ],
        });
        closeAndFinish();
      } catch (err) {
        errorText = err instanceof Error ? err.message : '请完整填写安全问题与答案';
        errorEl.textContent = errorText;
      }
    });

    mainEl.append(title, sub, form);
    speakText(`${title.textContent} 安全问题 ${qIndex + 1}/3`);
    window.setTimeout(() => (selectedQuestions[qIndex] ? ans.focus() : sel.focus()), 20);
  }

  backBtn.addEventListener('click', () => {
    errorText = '';
    if (step === 'password') step = 'name';
    else if (step === 'confirm') step = 'password';
    else if (step === 'q1') step = 'confirm';
    else if (step === 'q2') step = 'q1';
    else if (step === 'q3') step = 'q2';
    render();
  });

  render();

  return {
    isOpen: () => open,
  };
}
