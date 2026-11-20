import './browser.css';
import type { ThemeMode, WinAppHostContext, WinAppLifecycle, WinAppModule } from '../types';

interface BookmarkItem {
  title: string;
  url: string;
  icon: string;
}

interface BrowserTab {
  id: number;
  title: string;
  url: string; // empty string = new tab page
  history: string[];
  historyIndex: number;
  paneEl: HTMLElement;
  frameEl: HTMLIFrameElement | null;
  bannerUrlEl: HTMLElement | null;
}

const DEFAULT_BOOKMARKS: BookmarkItem[] = [
  { title: '哔哩哔哩', url: 'https://www.bilibili.com/', icon: '📺' },
  { title: '维基百科', url: 'https://zh.wikipedia.org/wiki/Wikipedia:%E9%A6%96%E9%A1%B5', icon: '📚' },
  { title: 'Bing 搜索', url: 'https://cn.bing.com/', icon: '🔎' },
  { title: 'MDN 文档', url: 'https://developer.mozilla.org/zh-CN/', icon: '📘' },
  { title: 'WOW 协议演示', url: '/demo-app', icon: '⚡' },
];

const BOOKMARKS_KEY = 'bookmarks:v1';

function normalizeAddress(raw: string): string {
  const input = raw.trim();
  if (!input) return '';
  if (input.startsWith('/')) return input;
  if (/^https?:\/\//i.test(input)) return input;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/:?#].*)?$/i.test(input) || /^localhost(:\d+)?(\/.*)?$/i.test(input)) {
    return `https://${input}`;
  }
  return `https://cn.bing.com/search?q=${encodeURIComponent(input)}`;
}

function labelFromUrl(url: string): string {
  if (!url) return '新标签页';
  if (url === '/demo-app') return 'WOW 协议演示';
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

export const browserApp: WinAppModule = {
  mount(ctx: WinAppHostContext): WinAppLifecycle {
    const { container, shell, wid, launchArgs } = ctx;
    let tabSeq = 1;
    let activeTabId = 0;
    const tabs: BrowserTab[] = [];

    function loadBookmarks(): BookmarkItem[] {
      const saved = shell.getAppData<BookmarkItem[]>(BOOKMARKS_KEY);
      if (Array.isArray(saved) && saved.length > 0) {
        return saved.filter(
          (item) => item && typeof item.title === 'string' && typeof item.url === 'string',
        );
      }
      return [...DEFAULT_BOOKMARKS];
    }

    let bookmarks = loadBookmarks();

    function saveBookmarks() {
      shell.setAppData(BOOKMARKS_KEY, bookmarks);
    }

    const root = document.createElement('div');
    root.className = `w11-br-root${shell.getTheme() === 'light' ? ' is-light' : ''}`;

    const tabBar = document.createElement('div');
    tabBar.className = 'w11-br-tabs';

    const toolbar = document.createElement('div');
    toolbar.className = 'w11-br-toolbar';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'w11-br-btn';
    backBtn.title = '后退';
    backBtn.textContent = '←';

    const forwardBtn = document.createElement('button');
    forwardBtn.type = 'button';
    forwardBtn.className = 'w11-br-btn';
    forwardBtn.title = '前进';
    forwardBtn.textContent = '→';

    const reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.className = 'w11-br-btn';
    reloadBtn.title = '刷新';
    reloadBtn.textContent = '↻';

    const homeBtn = document.createElement('button');
    homeBtn.type = 'button';
    homeBtn.className = 'w11-br-btn';
    homeBtn.title = '起始页';
    homeBtn.textContent = '⌂';

    const omnibox = document.createElement('form');
    omnibox.className = 'w11-br-omnibox';
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'w11-br-url-input';
    urlInput.placeholder = '输入网址或搜索内容（例如 bilibili.com）';
    urlInput.autocomplete = 'off';
    omnibox.append(urlInput);

    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = 'w11-br-btn';
    starBtn.title = '收藏当前页面';
    starBtn.textContent = '☆';

    const externalBtn = document.createElement('button');
    externalBtn.type = 'button';
    externalBtn.className = 'w11-br-btn';
    externalBtn.title = '在系统浏览器新标签页打开';
    externalBtn.textContent = '↗';

    toolbar.append(backBtn, forwardBtn, reloadBtn, homeBtn, omnibox, starBtn, externalBtn);

    const bookmarksBar = document.createElement('div');
    bookmarksBar.className = 'w11-br-bookmarks';

    const viewport = document.createElement('div');
    viewport.className = 'w11-br-viewport';

    root.append(tabBar, toolbar, bookmarksBar, viewport);
    container.replaceChildren(root);

    function getActiveTab(): BrowserTab | undefined {
      return tabs.find((t) => t.id === activeTabId);
    }

    function updateWindowTitle() {
      const active = getActiveTab();
      shell.setWindowTitle(wid, active ? `${active.title} - WOW 浏览器` : 'WOW 浏览器');
    }

    function renderBookmarksBar() {
      bookmarksBar.replaceChildren();
      bookmarks.forEach((bm) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w11-br-bm-item';
        btn.title = bm.url;
        const iconSpan = document.createElement('span');
        iconSpan.textContent = bm.icon || '🌐';
        const titleSpan = document.createElement('span');
        titleSpan.textContent = bm.title;
        btn.append(iconSpan, titleSpan);
        btn.addEventListener('click', () => {
          const tab = getActiveTab();
          if (tab) navigateTab(tab, bm.url);
        });
        bookmarksBar.append(btn);
      });
    }

    function renderTabBar() {
      tabBar.replaceChildren();
      tabs.forEach((tab) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = `w11-br-tab${tab.id === activeTabId ? ' is-active' : ''}`;
        el.title = tab.url || '新标签页';

        const titleEl = document.createElement('span');
        titleEl.className = 'w11-br-tab__title';
        titleEl.textContent = tab.title;

        const closeEl = document.createElement('span');
        closeEl.className = 'w11-br-tab__close';
        closeEl.title = '关闭标签页';
        closeEl.textContent = '✕';
        closeEl.addEventListener('click', (e) => {
          e.stopPropagation();
          closeTab(tab.id);
        });

        el.append(titleEl, closeEl);
        el.addEventListener('click', () => selectTab(tab.id));
        tabBar.append(el);
      });

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'w11-br-newtab-btn';
      addBtn.title = '新建标签页';
      addBtn.textContent = '+';
      addBtn.addEventListener('click', () => {
        const created = createTab('');
        selectTab(created.id);
      });
      tabBar.append(addBtn);
    }

    function syncToolbar() {
      const tab = getActiveTab();
      backBtn.disabled = !tab || tab.historyIndex <= 0;
      forwardBtn.disabled = !tab || tab.historyIndex >= tab.history.length - 1;
      reloadBtn.disabled = !tab || !tab.url;
      externalBtn.disabled = !tab || !tab.url;
      urlInput.value = tab?.url ?? '';

      const isStarred = Boolean(tab?.url && bookmarks.some((b) => b.url === tab.url));
      starBtn.disabled = !tab || !tab.url;
      starBtn.textContent = isStarred ? '★' : '☆';
      starBtn.classList.toggle('is-starred', isStarred);
      starBtn.title = isStarred ? '取消收藏' : '收藏当前页面';
      updateWindowTitle();
    }

    function renderNtp(tab: BrowserTab) {
      tab.frameEl = null;
      tab.bannerUrlEl = null;
      const ntp = document.createElement('div');
      ntp.className = 'w11-br-ntp';

      const brand = document.createElement('div');
      brand.className = 'w11-br-ntp__brand';
      brand.textContent = 'WOW 浏览器';

      const form = document.createElement('form');
      form.className = 'w11-br-ntp__search';
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '输入网址或关键词，在 WOW 窗口中直接浏览...';
      const go = document.createElement('button');
      go.type = 'submit';
      go.className = 'w11-br-ntp__go';
      go.textContent = '前往';
      form.append(input, go);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const target = normalizeAddress(input.value);
        if (target) navigateTab(tab, target);
      });

      const grid = document.createElement('div');
      grid.className = 'w11-br-ntp__grid';
      bookmarks.forEach((bm) => {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'w11-br-tile';
        const icon = document.createElement('span');
        icon.className = 'w11-br-tile__icon';
        icon.textContent = bm.icon || '🌐';
        const name = document.createElement('span');
        name.className = 'w11-br-tile__name';
        name.textContent = bm.title;
        tile.append(icon, name);
        tile.addEventListener('click', () => navigateTab(tab, bm.url));
        grid.append(tile);
      });

      const hint = document.createElement('div');
      hint.className = 'w11-br-ntp__hint';
      hint.textContent =
        '提示：外部网站以浏览器隔离游客态运行。若遇到目标网站主动禁止嵌入（白屏或拒绝连接），可点击右上角 ↗ 在系统浏览器新标签页打开。';

      ntp.append(brand, form, grid, hint);
      tab.paneEl.replaceChildren(ntp);
    }

    function renderWebPane(tab: BrowserTab, url: string) {
      const banner = document.createElement('div');
      banner.className = 'w11-br-banner';
      const msg = document.createElement('span');
      msg.textContent = '若页面空白或提示拒绝连接（部分网站禁止内嵌），可点右侧在新标签页打开。';
      const openExt = document.createElement('button');
      openExt.type = 'button';
      openExt.className = 'w11-br-banner-btn';
      openExt.textContent = '新标签页打开 ↗';
      openExt.addEventListener('click', () => {
        if (tab.url) window.open(tab.url, '_blank', 'noopener,noreferrer');
      });
      banner.append(msg, openExt);

      const frame = document.createElement('iframe');
      frame.className = 'w11-br-frame';
      frame.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
      frame.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; clipboard-read; clipboard-write');
      frame.src = url;

      tab.frameEl = frame;
      tab.bannerUrlEl = msg;
      tab.paneEl.replaceChildren(banner, frame);
    }

    function applyUrlToTab(tab: BrowserTab, url: string) {
      tab.url = url;
      tab.title = labelFromUrl(url);
      if (!url) {
        renderNtp(tab);
      } else {
        renderWebPane(tab, url);
      }
      renderTabBar();
      if (tab.id === activeTabId) syncToolbar();
    }

    function navigateTab(tab: BrowserTab, rawUrl: string) {
      const url = normalizeAddress(rawUrl);
      if (tab.history[tab.historyIndex] !== url) {
        tab.history = tab.history.slice(0, tab.historyIndex + 1);
        tab.history.push(url);
        tab.historyIndex = tab.history.length - 1;
      }
      applyUrlToTab(tab, url);
    }

    function createTab(initialUrl: string): BrowserTab {
      const paneEl = document.createElement('div');
      paneEl.className = 'w11-br-pane';
      viewport.append(paneEl);
      const url = normalizeAddress(initialUrl);
      const tab: BrowserTab = {
        id: tabSeq++,
        title: labelFromUrl(url),
        url,
        history: [url],
        historyIndex: 0,
        paneEl,
        frameEl: null,
        bannerUrlEl: null,
      };
      tabs.push(tab);
      applyUrlToTab(tab, url);
      return tab;
    }

    function selectTab(id: number) {
      activeTabId = id;
      tabs.forEach((t) => t.paneEl.classList.toggle('is-active', t.id === id));
      renderTabBar();
      syncToolbar();
    }

    function closeTab(id: number) {
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const [removed] = tabs.splice(idx, 1);
      if (removed.frameEl) {
        try {
          removed.frameEl.src = 'about:blank';
        } catch {}
      }
      removed.paneEl.remove();
      if (tabs.length === 0) {
        const next = createTab('');
        selectTab(next.id);
        return;
      }
      if (activeTabId === id) {
        const fallback = tabs[Math.min(idx, tabs.length - 1)];
        selectTab(fallback.id);
      } else {
        renderTabBar();
      }
    }

    backBtn.addEventListener('click', () => {
      const tab = getActiveTab();
      if (!tab || tab.historyIndex <= 0) return;
      tab.historyIndex -= 1;
      applyUrlToTab(tab, tab.history[tab.historyIndex]);
    });

    forwardBtn.addEventListener('click', () => {
      const tab = getActiveTab();
      if (!tab || tab.historyIndex >= tab.history.length - 1) return;
      tab.historyIndex += 1;
      applyUrlToTab(tab, tab.history[tab.historyIndex]);
    });

    reloadBtn.addEventListener('click', () => {
      const tab = getActiveTab();
      if (!tab || !tab.url) return;
      if (tab.frameEl) tab.frameEl.src = tab.url;
    });

    homeBtn.addEventListener('click', () => {
      const tab = getActiveTab();
      if (tab) navigateTab(tab, '');
    });

    omnibox.addEventListener('submit', (e) => {
      e.preventDefault();
      const tab = getActiveTab();
      if (!tab) return;
      navigateTab(tab, urlInput.value);
    });

    starBtn.addEventListener('click', () => {
      const tab = getActiveTab();
      if (!tab || !tab.url) return;
      const existing = bookmarks.findIndex((b) => b.url === tab.url);
      if (existing >= 0) {
        bookmarks.splice(existing, 1);
      } else {
        bookmarks.push({ title: tab.title, url: tab.url, icon: '⭐' });
      }
      saveBookmarks();
      renderBookmarksBar();
      syncToolbar();
    });

    externalBtn.addEventListener('click', () => {
      const tab = getActiveTab();
      if (tab?.url) window.open(tab.url, '_blank', 'noopener,noreferrer');
    });

    renderBookmarksBar();
    const initialUrl = typeof launchArgs?.url === 'string' ? launchArgs.url : '';
    const firstTab = createTab(initialUrl);
    selectTab(firstTab.id);

    return {
      onThemeChange(theme: ThemeMode) {
        root.classList.toggle('is-light', theme === 'light');
      },
      destroy() {
        tabs.forEach((t) => {
          if (t.frameEl) {
            try {
              t.frameEl.src = 'about:blank';
            } catch {}
          }
        });
        tabs.length = 0;
        container.replaceChildren();
      },
    };
  },
};
