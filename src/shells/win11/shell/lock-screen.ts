import { sessionPreferences } from '../../../wow/hal/storage';
import {
  getAccountState,
  resetPasswordWithAnswers,
  subscribeAccount,
  verifyAccountPassword,
  type PublicAccountState,
} from '../../../wow/kernel/account';
import type { DesktopContext } from './desktop-context';
import { showWin11Oobe } from './oobe';

export function createLockScreen(context: DesktopContext) {
  const { root } = context;

  const screenEl = root.querySelector<HTMLElement>('[data-lock-screen]');
  const curtainEl = root.querySelector<HTMLElement>('[data-lock-curtain]');
  const signinUserEl = root.querySelector<HTMLElement>('[data-signin-username]');
  const startUserEl = root.querySelector<HTMLElement>('[data-start-username]');
  const formEl = root.querySelector<HTMLFormElement>('[data-signin-form]');
  const pwdBoxEl = root.querySelector<HTMLElement>('[data-signin-pwd-box]');
  const nopwdBtn = root.querySelector<HTMLButtonElement>('[data-signin-nopwd-btn]');
  const resetBtn = root.querySelector<HTMLButtonElement>('[data-signin-reset-btn]');
  const resetPanelEl = root.querySelector<HTMLFormElement>('[data-signin-reset-panel]');
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

  let mode: 'oobe' | 'unlocked' | 'locked' | 'signin' | 'resetting' | 'welcoming' = 'unlocked';
  let timerId: number | null = null;
  let oobeCtrl: { isOpen: () => boolean } | null = null;
  const SESSION_KEY = 'shell:session-unlocked';

  function syncAccountLabels(account: PublicAccountState) {
    if (signinUserEl) signinUserEl.textContent = account.username;
    if (startUserEl) startUserEl.textContent = account.username;
    if (pwdBoxEl) pwdBoxEl.hidden = !account.hasPassword;
    if (nopwdBtn) nopwdBtn.hidden = account.hasPassword;
    if (resetBtn) resetBtn.hidden = !(account.hasPassword && account.questions.length === 3);
  }

  syncAccountLabels(getAccountState());
  subscribeAccount(syncAccountLabels);

  const syncUi = () => {
    if (!screenEl) return;
    const account = getAccountState();
    syncAccountLabels(account);
    screenEl.classList.toggle('is-hidden', mode === 'unlocked' || mode === 'oobe');
    screenEl.classList.toggle(
      'is-signin',
      mode === 'signin' || mode === 'resetting' || mode === 'welcoming',
    );
    if (formEl) formEl.hidden = mode !== 'signin';
    if (errorEl) errorEl.hidden = true;
    if (resetPanelEl) resetPanelEl.hidden = mode !== 'resetting';
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
      const account = getAccountState();
      window.setTimeout(() => (account.hasPassword ? inputEl?.focus() : nopwdBtn?.focus()), 140);
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
    }, 520);
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

  function openResetPanel() {
    if (!resetPanelEl) return;
    const account = getAccountState();
    if (account.questions.length !== 3) return;
    mode = 'resetting';
    resetPanelEl.replaceChildren();

    const heading = document.createElement('p');
    heading.className = 'w11-signin-error-msg';
    heading.style.margin = '0 0 4px';
    heading.textContent = '回答以下 3 个安全问题以重置密码';

    const answerInputs: HTMLInputElement[] = [];
    account.questions.forEach((q, idx) => {
      const label = document.createElement('div');
      label.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.86);text-align:left;';
      label.textContent = `${idx + 1}. ${q}`;
      const ans = document.createElement('input');
      ans.type = 'text';
      ans.className = 'w11-signin-input';
      ans.style.cssText = 'background:rgba(24,24,24,0.8);border:1px solid rgba(255,255,255,0.28);border-radius:4px;height:34px;padding:0 10px;';
      ans.placeholder = '输入答案';
      answerInputs.push(ans);
      resetPanelEl.append(label, ans);
    });

    const newPwd = document.createElement('input');
    newPwd.type = 'password';
    newPwd.className = 'w11-signin-input';
    newPwd.style.cssText = 'background:rgba(24,24,24,0.8);border:1px solid rgba(255,255,255,0.28);border-radius:4px;height:34px;padding:0 10px;margin-top:4px;';
    newPwd.placeholder = '新密码（留空则清除密码）';

    const errMsg = document.createElement('div');
    errMsg.style.cssText = 'min-height:16px;font-size:12px;color:#ff99a4;text-align:left;';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-top:4px;';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'w11-signin-ok-btn';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => {
      mode = 'signin';
      syncUi();
      window.setTimeout(() => inputEl?.focus(), 20);
    });
    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'w11-signin-ok-btn';
    saveBtn.textContent = '重置并登录';
    row.append(cancelBtn, saveBtn);

    resetPanelEl.prepend(heading);
    resetPanelEl.append(newPwd, errMsg, row);

    resetPanelEl.onsubmit = async (e) => {
      e.preventDefault();
      const ok = await resetPasswordWithAnswers(
        answerInputs.map((i) => i.value),
        newPwd.value,
      );
      if (!ok) {
        errMsg.textContent = '安全问题答案不正确，请重试。';
        return;
      }
      unlockSuccess();
    };

    syncUi();
    window.setTimeout(() => answerInputs[0]?.focus(), 30);
  }

  curtainEl?.addEventListener('click', () => {
    if (mode !== 'locked') return;
    mode = 'signin';
    syncUi();
    const account = getAccountState();
    window.setTimeout(() => (account.hasPassword ? inputEl?.focus() : nopwdBtn?.focus()), 180);
  });

  nopwdBtn?.addEventListener('click', () => {
    if (mode !== 'signin') return;
    unlockSuccess();
  });

  resetBtn?.addEventListener('click', openResetPanel);

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

  formEl?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (mode !== 'signin') return;
    const val = inputEl?.value ?? '';
    if (await verifyAccountPassword(val)) {
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
  const account = getAccountState();
  if (params.get('desktop') === '1') {
    mode = 'unlocked';
    syncUi();
  } else if (!account.oobeCompleted || params.get('oobe') === '1') {
    mode = 'oobe';
    syncUi();
    oobeCtrl = showWin11Oobe(
      root,
      () => {
        oobeCtrl = null;
        mode = 'unlocked';
        try {
          sessionPreferences.setItem(SESSION_KEY, '1');
        } catch {}
        syncUi();
      },
      {
        getVolume: () => context.store.state.volume,
        setVolume: (vol) => context.store.setVolume(vol),
      },
    );
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
    isLocked: () => mode !== 'unlocked' || Boolean(oobeCtrl?.isOpen()),
    handleKeyDown: (e: KeyboardEvent) => {
      if (mode === 'oobe') return false;
      if (mode === 'locked') {
        if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return false;
        e.preventDefault();
        mode = 'signin';
        syncUi();
        const cur = getAccountState();
        window.setTimeout(() => (cur.hasPassword ? inputEl?.focus() : nopwdBtn?.focus()), 180);
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
      if (mode === 'resetting') {
        if (e.key === 'Escape') {
          e.preventDefault();
          mode = 'signin';
          syncUi();
          return true;
        }
        return false;
      }
      return mode === 'welcoming';
    },
    showLock,
    restartCycle,
  };
}
