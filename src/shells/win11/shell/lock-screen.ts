import { sessionPreferences } from '../../../wow/hal/storage';
import type { DesktopContext } from './desktop-context';
export function createLockScreen(context: DesktopContext) {
  const { root } = context;

  const screenEl = root.querySelector<HTMLElement>('[data-lock-screen]');
  const curtainEl = root.querySelector<HTMLElement>('[data-lock-curtain]');
  const formEl = root.querySelector<HTMLFormElement>('[data-signin-form]');
  const inputEl = root.querySelector<HTMLInputElement>('[data-signin-input]');
  const eyeBtn = root.querySelector<HTMLButtonElement>('[data-signin-eye]');
  const errorEl = root.querySelector<HTMLElement>('[data-signin-error]');
  const okBtn = root.querySelector<HTMLButtonElement>('[data-signin-ok]');
  const welcomeEl = root.querySelector<HTMLElement>('[data-signin-welcome]');
  const welcomeTextEl = root.querySelector<HTMLElement>('[data-welcome-text]');
  const imeBtn = root.querySelector<HTMLButtonElement>('[data-signin-ime]');
  const imeBadge = root.querySelector<HTMLElement>('[data-signin-ime-badge]');
  const powerBtn = root.querySelector<HTMLButtonElement>('[data-signin-power]');
  const powerMenu = root.querySelector<HTMLElement>('[data-signin-power-menu]');

  let mode: 'unlocked' | 'locked' | 'signin' | 'welcoming' = 'unlocked';
  let timerId: number | null = null;
  const SESSION_KEY = 'shell:session-unlocked';

  const syncUi = () => {
    if (!screenEl) return;
    screenEl.classList.toggle('is-hidden', mode === 'unlocked');
    screenEl.classList.toggle('is-signin', mode === 'signin' || mode === 'welcoming');
    if (formEl) formEl.hidden = mode !== 'signin';
    if (errorEl) errorEl.hidden = true;
    if (welcomeEl) welcomeEl.hidden = mode !== 'welcoming';
    if (powerMenu) powerMenu.hidden = true;
  };

  const showError = () => {
    if (formEl) formEl.hidden = true;
    if (errorEl) errorEl.hidden = false;
    window.setTimeout(() => okBtn?.focus(), 20);
  };

  const resetFromError = () => {
    if (errorEl) errorEl.hidden = true;
    if (formEl) formEl.hidden = false;
    if (inputEl) {
      inputEl.value = '';
      inputEl.type = 'password';
      if (eyeBtn) eyeBtn.hidden = true;
      window.setTimeout(() => inputEl.focus(), 20);
    }
  };

  const showLock = (target: 'locked' | 'signin' = 'locked') => {
    if (timerId) {
      window.clearTimeout(timerId);
      timerId = null;
    }
    try {
      sessionPreferences.removeItem(SESSION_KEY);
    } catch {}
    mode = target;
    if (inputEl) {
      inputEl.value = '';
      inputEl.type = 'password';
    }
    if (eyeBtn) eyeBtn.hidden = true;
    if (welcomeTextEl) welcomeTextEl.textContent = '欢迎';
    syncUi();
    if (target === 'signin') {
      window.setTimeout(() => inputEl?.focus(), 140);
    }
  };

  const unlockSuccess = () => {
    if (timerId) window.clearTimeout(timerId);
    mode = 'welcoming';
    if (welcomeTextEl) welcomeTextEl.textContent = '欢迎';
    syncUi();
    timerId = window.setTimeout(() => {
      mode = 'unlocked';
      try {
        sessionPreferences.setItem(SESSION_KEY, '1');
      } catch {}
      syncUi();
      timerId = null;
    }, 650);
  };

  const restartCycle = () => {
    if (timerId) window.clearTimeout(timerId);
    mode = 'welcoming';
    if (welcomeTextEl) welcomeTextEl.textContent = '正在重启';
    syncUi();
    timerId = window.setTimeout(() => {
      showLock('locked');
    }, 850);
  };

  curtainEl?.addEventListener('click', () => {
    if (mode !== 'locked') return;
    mode = 'signin';
    syncUi();
    window.setTimeout(() => inputEl?.focus(), 180);
  });

  inputEl?.addEventListener('input', () => {
    if (eyeBtn) eyeBtn.hidden = inputEl.value.length === 0;
  });

  eyeBtn?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (inputEl) inputEl.type = 'text';
  });
  const hidePassword = () => {
    if (inputEl) inputEl.type = 'password';
  };
  eyeBtn?.addEventListener('pointerup', hidePassword);
  eyeBtn?.addEventListener('pointerleave', hidePassword);

  formEl?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (mode !== 'signin') return;
    const val = inputEl?.value ?? '';
    if (val === 'qwer1234') {
      unlockSuccess();
    } else {
      showError();
    }
  });

  okBtn?.addEventListener('click', resetFromError);

  imeBtn?.addEventListener('click', () => {
    const next = imeBtn.textContent === '英' ? '中' : '英';
    imeBtn.textContent = next;
    if (imeBadge) imeBadge.textContent = next === '英' ? '拼' : '中';
  });

  powerBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (powerMenu) powerMenu.hidden = !powerMenu.hidden;
  });

  powerMenu?.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-login-power]');
    if (!item) return;
    const act = item.dataset.loginPower;
    powerMenu.hidden = true;
    if (act === 'lock' || act === 'sleep') {
      showLock('locked');
    } else if (act === 'restart') {
      restartCycle();
    }
  });

  screenEl?.addEventListener('click', (e) => {
    if (powerMenu && !powerMenu.hidden && !(e.target as HTMLElement).closest('.w11-signin-power-wrap')) {
      powerMenu.hidden = true;
    }
  });

  const params = new URLSearchParams(window.location.search);
  if (params.get('desktop') === '1') {
    mode = 'unlocked';
    syncUi();
  } else if (params.get('signin') === '1') {
    showLock('signin');
  } else if (params.get('lock') === '1') {
    showLock('locked');
  } else {
    let alreadyUnlocked = false;
    try {
      alreadyUnlocked = sessionPreferences.getItem(SESSION_KEY) === '1';
    } catch {}
    if (alreadyUnlocked) {
      mode = 'unlocked';
      syncUi();
    } else {
      showLock('locked');
    }
  }

  return {
    isLocked: () => mode !== 'unlocked',
    handleKeyDown: (e: KeyboardEvent) => {
      if (mode === 'locked') {
        if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return false;
        e.preventDefault();
        mode = 'signin';
        syncUi();
        window.setTimeout(() => inputEl?.focus(), 180);
        return true;
      }
      if (mode === 'signin') {
        if (errorEl && !errorEl.hidden && (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape')) {
          e.preventDefault();
          resetFromError();
          return true;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          showLock('locked');
          return true;
        }
        return true;
      }
      return mode === 'welcoming';
    },
    showLock,
    restartCycle,
  };
}
