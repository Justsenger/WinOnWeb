import './settings-app.css';
import { UI_ICONS } from '../shared/ui-icons';
import type { DesktopIconSize, WinAppHostContext, WinAppLifecycle, WinAppModule } from '../types';

type SettingsSection = 'home' | 'system' | 'bluetooth' | 'network' | 'personalization' | 'apps' | 'accounts' | 'time' | 'gaming' | 'accessibility' | 'privacy';

const NAV_ITEMS: Array<{ id: SettingsSection; label: string; glyph: string; color: string }> = [
  { id: 'home', label: '主页', glyph: '⌂', color: '#f28c28' },
  { id: 'system', label: '系统', glyph: '▣', color: '#20b9d0' },
  { id: 'bluetooth', label: '蓝牙和其他设备', glyph: 'ᛒ', color: '#1787ed' },
  { id: 'network', label: '网络和 Internet', glyph: '⌁', color: '#21a9e8' },
  { id: 'personalization', label: '个性化', glyph: '◒', color: '#d4a38a' },
  { id: 'apps', label: '应用', glyph: '◈', color: '#5d9fe5' },
  { id: 'accounts', label: '账户', glyph: '●', color: '#18b9a6' },
  { id: 'time', label: '时间和语言', glyph: '◷', color: '#78c5d7' },
  { id: 'gaming', label: '游戏', glyph: '⌁', color: '#aebbc7' },
  { id: 'accessibility', label: '辅助功能', glyph: '♿', color: '#13a3ed' },
  { id: 'privacy', label: '隐私和安全性', glyph: '⬟', color: '#aebbc7' },
];

const SECTION_COPY: Record<Exclude<SettingsSection, 'home'>, { title: string; description: string; cards: Array<[string, string]> }> = {
  system: { title: '系统', description: '显示、声音、通知和电源选项', cards: [['显示', '亮度、夜灯、缩放和多显示器'], ['声音', '音量、输出设备和输入设备'], ['电源和电池', '睡眠、电池使用情况和节电模式']] },
  bluetooth: { title: '蓝牙和其他设备', description: '管理设备、打印机和鼠标', cards: [['设备', '蓝牙、打印机、鼠标和键盘'], ['手机连接', '将手机连接到此设备'], ['相机', '管理相机权限和设备']] },
  network: { title: '网络和 Internet', description: 'Wi-Fi、以太网、VPN 和代理', cards: [['以太网', '无法访问 Internet'], ['Wi-Fi', '管理已保存的网络'], ['VPN', '添加或管理 VPN 连接']] },
  personalization: { title: '个性化', description: '背景、颜色、主题和任务栏', cards: [['主题模式', '切换 Windows 11 深色 / 浅色外观'], ['桌面图标大小', '调整桌面图标显示大小'], ['重置桌面布局', '恢复图标排列、固定应用与默认主题']] },
  apps: { title: '应用', description: '卸载、默认应用和可选功能', cards: [['已安装的应用', '查看并管理应用'], ['默认应用', '按文件类型和链接选择默认应用'], ['可选功能', '管理 Windows 可选组件']] },
  accounts: { title: '账户', description: '你的账户、电子邮件和登录选项', cards: [['你的信息', '本地账户 admin'], ['登录选项', 'Windows Hello 和密码'], ['家庭', '家庭成员和设备']] },
  time: { title: '时间和语言', description: '日期、时间、语言和区域', cards: [['日期和时间', '自动设置时间和时区'], ['语言和区域', 'Windows 显示语言和区域格式'], ['语音', '语音识别和语音设置']] },
  gaming: { title: '游戏', description: '游戏栏、捕获和游戏模式', cards: [['游戏栏', '使用控制器打开游戏栏'], ['捕获', '录制游戏视频和屏幕截图'], ['游戏模式', '优化游戏性能']] },
  accessibility: { title: '辅助功能', description: '视觉、听觉和交互辅助功能', cards: [['文本大小', '放大屏幕上的文本'], ['视觉效果', '滚动条、透明度和动画'], ['讲述人', '听取屏幕上的内容']] },
  privacy: { title: '隐私和安全性', description: 'Windows 权限和应用权限', cards: [['Windows 安全中心', '查看设备安全性和运行状况'], ['常规', '广告 ID、语言列表和应用启动'], ['应用权限', '位置、相机、麦克风和通知']] },
};

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const settingsApp: WinAppModule = {
  mount(ctx: WinAppHostContext): WinAppLifecycle {
    const { container, shell } = ctx;
    const hostWindow = container.closest<HTMLElement>('.w11-window');
    const titlebar = hostWindow?.querySelector<HTMLElement>('.w11-win-titlebar');
    const originalTitle = titlebar?.querySelector<HTMLElement>('.w11-win-title');
    let titleContent: HTMLElement | null = null;
    let taskbarPage = ctx.launchArgs?.page === 'taskbar';
    let section: SettingsSection = taskbarPage ? 'personalization' : 'home';
    const taskbarOptions = new Map<string, string>();

    if (titlebar) {
      originalTitle?.style.setProperty('display', 'none');
      titleContent = document.createElement('div');
      titleContent.className = 'w11-settings-titlebar-content';
      titleContent.innerHTML = `
        <button type="button" class="w11-settings-back" data-settings-back aria-label="返回"><span>‹</span></button>
        <span class="w11-settings-title">设置</span>
        <label class="w11-settings-search" aria-label="查找设置">
          <span class="w11-settings-search-icon">${UI_ICONS.searchSmall}</span>
          <input data-settings-search placeholder="查找设置" autocomplete="off" />
        </label>
      `;
      const controls = titlebar.querySelector('.w11-win-controls');
      titlebar.insertBefore(titleContent, controls);
    }

    const icon = (item: (typeof NAV_ITEMS)[number]) => `<span class="w11-settings-nav-icon" style="--settings-icon:${item.color}">${esc(item.glyph)}</span>`;
    const nav = () => NAV_ITEMS.map((item) => `
      <button type="button" class="w11-settings-nav-item${section === item.id ? ' is-active' : ''}" data-settings-nav="${item.id}">
        ${icon(item)}<span>${esc(item.label)}</span>
      </button>
    `).join('');

    function homeHtml(): string {
      return `
        <h1>主页</h1>
        <div class="w11-settings-device-row">
          <div class="w11-settings-device-image"></div>
          <div class="w11-settings-device-copy"><strong>DESKTOP-45NHMU3</strong><span>Virtual Machine</span><button type="button" data-settings-rename>重命名</button></div>
        </div>
        <div class="w11-settings-status-row">
          <button type="button" class="w11-settings-status-card" data-settings-nav="network"><span class="status-glyph">▣</span><span><strong>以太网</strong><small>无法访问 Internet</small></span></button>
          <button type="button" class="w11-settings-status-card" data-settings-nav="system"><span class="status-glyph update">⟳</span><span><strong>Windows 更新</strong><small>上次检查时间：1 小时前</small></span></button>
        </div>
        <section class="w11-settings-recommend-card">
          <header><h2>推荐设置</h2><p>最近使用的和常用的设置</p></header>
          <button type="button" data-settings-nav="time"><span class="recommend-glyph">文</span><span>语言和区域</span><b>›</b></button>
          <button type="button" data-settings-nav="system"><span class="recommend-glyph">▱</span><span>屏幕</span><b>›</b></button>
          <button type="button" data-settings-nav="bluetooth"><span class="recommend-glyph">▤</span><span>打印机和扫描仪</span><b>›</b></button>
        </section>
      `;
    }

    function taskbarHtml(): string {
      const toggle = (label: string, enabled = true) => {
        const checked = taskbarOptions.get(label) === undefined ? enabled : taskbarOptions.get(label) === 'true';
        return '<label class="taskbar-switch"><span>' + (checked ? '开' : '关') + '</span><input type="checkbox" role="switch" aria-label="' + label + '" data-taskbar-option="' + label + '"' + (checked ? ' checked' : '') + '></label>';
      };
      const select = (label: string, choices: string[]) => '<select aria-label="' + label + '" data-taskbar-option="' + label + '">' + choices.map(value => '<option' + (taskbarOptions.get(label) === value ? ' selected' : '') + '>' + value + '</option>').join('') + '</select>';
      const row = (icon: string, label: string, control: string, detail = '') => '<div class="taskbar-option"><i aria-hidden="true">' + icon + '</i><span>' + label + (detail ? '<small>' + detail + '</small>' : '') + '</span>' + control + '</div>';
      const group = (label: string, detail: string, body: string, open = false) => '<details' + (open ? ' open' : '') + '><summary>' + label + '<small>' + detail + '</small></summary>' + body + '</details>';
      return '<section class="w11-taskbar-preferences"><h1><button data-settings-nav="personalization">个性化</button> <span>›</span> 任务栏</h1>' +
        group('任务栏项', '显示或隐藏显示在任务栏上的按钮',
          row('&#xE721;', '搜索', select('搜索', ['搜索框','仅搜索图标','搜索图标和标签','隐藏'])) +
          row('&#xE7C4;', '任务视图', toggle('任务视图')) + row('&#xE8A9;', '小组件', toggle('小组件')) +
          row('&#xE772;', '继续', toggle('继续'), '当“继续”可用时，显示带徽章通知的应用'), true) +
        group('系统托盘图标', '选择可以在系统托盘中显示的图标',
          row('&#xE76E;', '表情符号等', select('表情符号等', ['从不','始终']), '显示表情符号和其他面板图标 (选择 Windows 徽标键 + 句点 (.) 可随时打开面板)') +
          row('&#xEDC6;', '笔菜单', toggle('笔菜单', false)), true) +
        '</section>';
    }

    function sectionHtml(): string {
      if (taskbarPage) return taskbarHtml();
      const copy = SECTION_COPY[section as Exclude<SettingsSection, 'home'>];
      return `
        <h1>${esc(copy.title)}</h1><p class="w11-settings-section-description">${esc(copy.description)}</p>
        <div class="w11-settings-section-cards">${copy.cards.map(([title, body]) => `<button type="button" class="w11-settings-section-card"><span><strong>${esc(title)}</strong><small>${esc(body)}</small></span><b>›</b></button>`).join('')}</div>
      `;
    }

    function render() {
      const theme = shell.getTheme();
      container.innerHTML = `
        <div class="w11-settings-shell" data-settings-theme="${theme}">
          <aside class="w11-settings-sidebar">
            <button type="button" class="w11-settings-user-card"><span class="w11-settings-avatar"><i></i></span><span><strong>admin</strong><small>本地账户</small></span></button>
            <nav>${nav()}</nav>
          </aside>
          <main class="w11-settings-main" data-settings-main>${section === 'home' ? homeHtml() : sectionHtml()}</main>
        </div>
      `;
    }

    function onClick(event: Event) {
      const target = event.target as HTMLElement | null;
      const navTarget = target?.closest<HTMLElement>('[data-settings-nav]');
      if (navTarget) {
        taskbarPage = false;
        section = (navTarget.dataset.settingsNav as SettingsSection) ?? 'home';
        render();
        return;
      }
      const action = target?.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'theme-dark' || action === 'theme-light') shell.setTheme(action.slice(6) as 'dark' | 'light');
      else if (action?.startsWith('icon-')) shell.setIconSize(action.slice(5) as DesktopIconSize);
      else if (target?.closest('[data-settings-back]')) { section = taskbarPage ? 'personalization' : 'home'; taskbarPage = false; render(); }
      else if (target?.closest('[data-settings-rename]')) {
        const next = window.prompt('重命名设备', 'DESKTOP-45NHMU3');
        if (next?.trim()) {
          const el = container.querySelector<HTMLElement>('.w11-settings-device-copy strong');
          if (el) el.textContent = next.trim();
        }
      }
    }

    function changeTaskbarOption(event: Event) {
      const control = event.target as HTMLInputElement | HTMLSelectElement;
      const key = control.dataset.taskbarOption;
      if (!key) return;
      if (control instanceof HTMLInputElement) {
        taskbarOptions.set(key, String(control.checked));
        const text = control.previousElementSibling;
        if (text) text.textContent = control.checked ? '开' : '关';
      } else taskbarOptions.set(key, control.value);
    }
    container.addEventListener('change', changeTaskbarOption);
    container.addEventListener('click', onClick);
    titleContent?.addEventListener('click', onClick);
    render();
    return {
      onMessage(channel, page) {
        if (channel === 'navigate' && page === 'taskbar') {
          section = 'personalization';
          taskbarPage = true;
          render();
        }
      },
      onThemeChange: render,
      onShellPrefsChange: render,
      destroy: () => {
        container.removeEventListener('change', changeTaskbarOption);
        container.removeEventListener('click', onClick);
        titleContent?.removeEventListener('click', onClick);
        titleContent?.remove();
        if (originalTitle) originalTitle.style.removeProperty('display');
      },
    };
  },
};
