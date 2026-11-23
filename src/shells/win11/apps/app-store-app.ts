import './app-store.css';
import type {
  WinAppCapability,
  WinAppHostContext,
  WinAppLifecycle,
  WinAppManifest,
  WinAppModule,
  WinPermissionDecision,
} from '../types';
import { installPackage } from '../../../wow/kernel/package-security';
import { deployment } from '../../../wow/hal/vhost';
import { registryChanged } from '../shell/registry';
import { refreshGrants } from '../shell/permissions';

const SENSITIVE_CAPS: Array<{ key: WinAppCapability; label: string }> = [
  { key: 'virtual-fs', label: '虚拟文件系统读写 (C:/D:)' },
  { key: 'hardware-probe', label: '虚拟与真实硬件探测' },
  { key: 'notifications', label: '发送桌面通知' },
  { key: 'app-messaging', label: '跨应用协同通信' },
  { key: 'shell-control', label: '拉起其他系统应用' },
];

const COMMON_EXTENSIONS = ['.txt', '.md', '.json', '.log', '.ini', '.cfg', '.xml'];

interface CatalogGame {
  sha256: string;
  id: string;
  name: string;
  description: string;
  source: string;
  icon: string;
  accent: string;
}

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function validateSafeAppUrl(raw: string): string | null {
  const val = raw.trim();
  if (!val) return null;
  if (val.startsWith('/') && new URL(val,location.href).origin===location.origin) return val;
  try {
    const parsed = new URL(val);
    if (parsed.protocol === 'https:') return parsed.toString();
    return null;
  } catch {
    return null;
  }
}

export const appStoreApp: WinAppModule = {
  mount(ctx: WinAppHostContext): WinAppLifecycle {
    const { container, shell } = ctx;
    let activeTab: 'install' | 'import' | 'permissions' | 'assoc' = 'install';
    let statusBanner = '';
    let games: CatalogGame[] = [];
    const catalogRequest = new AbortController();
    let progress: { name: string; loaded: number; total: number } | undefined;


    let draftId = 'wow-eco-demo';
    let draftName = '生态能力测试台';
    let draftUrl = '/demo-app';
    let draftDesc = '验证外部应用接入协议、系统选文件弹窗、D 盘持久化读写、私有隔离存储与跨应用协同。';
    let draftExts = '.txt,.md';
    let draftOnDesktop = true;
    let wowBusy = false;
    const draftCaps = new Set<WinAppCapability>(['virtual-fs', 'hardware-probe', 'notifications', 'app-messaging', 'shell-control']);

    async function installFromDraft() {
      const safeUrl = validateSafeAppUrl(draftUrl);
      const cleanId = draftId.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
      const cleanName = draftName.trim();
      if (!cleanId || !cleanName) {
        statusBanner = '请填写合法的应用标识（英文数字短横线）和应用名称。';
        render();
        return;
      }
      if (!safeUrl) {
        statusBanner = '安全限制：入口地址仅允许同源路径（如 /demo-app）或 HTTPS 网址！';
        render();
        return;
      }

      const exts = draftExts
        .split(/[,，\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .map((s) => (s.startsWith('.') ? s : `.${s}`));

      const manifest: WinAppManifest = {
        id: cleanId,
        name: cleanName,
        iconKey: 'app-store',
        description: draftDesc.trim() || `${cleanName}（动态安装外部网页应用）`,
        category: 'app',
        runtime: 'iframe',
        onDesktop: draftOnDesktop,
        pinnedToStart: true,
        pinnedToTaskbar: false,
        window: {
          defaultWidth: 880,
          defaultHeight: 600,
          minWidth: 480,
          minHeight: 360,
        },
        iframe: {
          entryUrl: safeUrl,
        },
        capabilities: ['theme', 'volume', 'focus', 'visibility', 'window-control', ...draftCaps],
        supportedExtensions: exts.length > 0 ? exts : undefined,
        source: 'user',
        telemetry: {
          publisher: '用户安装应用',
          estimatedMemMb: 54.0,
        },
      };

      const installId = await shell.installUserApp(manifest);
      statusBanner = `已成功安装“${cleanName}”(${installId}) 并刷新桌面与开始菜单！`;
      void shell.showNotification({ title: '应用安装完成', body: `${cleanName} 已添加到开始菜单与桌面` }).catch(() => {});
      activeTab = 'permissions';
      render();
    }

    function paintProgress() {
      const bar = container.querySelector<HTMLProgressElement>('[data-as-progress]');
      const label = container.querySelector<HTMLElement>('[data-as-amount]');
      if (!progress || !bar || !label) return;
      const { loaded, total } = progress;
      const mib = (bytes: number) => (bytes / 1048576).toFixed(1);
      if (total > 0) {
        bar.max = total;
        bar.value = loaded;
        label.textContent = `${Math.floor(loaded / total * 100)}% (${mib(loaded)} / ${mib(total)} MiB)`;
      } else {
        bar.removeAttribute('value');
        label.textContent = loaded ? `已接收 ${mib(loaded)} MiB` : '正在连接…';
      }
    }

    function downloadPackage(file: string): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('GET', `/packages/${file}`);
        request.responseType = 'arraybuffer';
        request.onprogress = event => {
          if (!progress) return;
          progress.loaded = event.loaded;
          progress.total = event.lengthComputable ? event.total : 0;
          paintProgress();
        };
        request.onerror = () => reject(new Error('下载中断，请检查网络后重试。'));
        request.onload = () => {
          if (request.status === 200) resolve(request.response);
          else reject(new Error(`下载失败（HTTP ${request.status}）`));
        };
        request.send();
      });
    }

    async function install(name: string, source: File | string) {
      if (wowBusy) return;
      wowBusy = true;
      try {
        if (typeof source === 'string') {
          progress = { name, loaded: 0, total: 0 };
          statusBanner = `正在下载「${name}」`;
        } else {
          statusBanner = `正在读取 ${name}`;
        }
        render();
        const bytes = typeof source === 'string' ? await downloadPackage(source) : await source.arrayBuffer();
        progress = undefined;
        statusBanner = `正在安装「${name}」…`;
        render();
        const id = typeof source === 'string' ? source.replace(/\.wow$/, '') : '';
        let digest = games.find(game=>game.id===id)?.sha256;
        if (id === 'survivalcraft-api' && !digest) {
          const response = await fetch('/packages/survivalcraft-api.sha256');
          if (response.ok) digest = (await response.text()).trim();
        }
        if (typeof source === 'string' && !digest) throw Error('商店未提供此版本的可信摘要');
        const trusted = deployment().mode === 'isolated' || typeof source === 'string' ||
          window.confirm('单域模式下，应用可访问桌面所在源。仅在你信任此包的发布者时继续安装。');
        if (!trusted) { statusBanner = '已取消安装'; return; }
        const result = await installPackage(bytes, typeof source === 'string' ?
          {kind:'catalog',id,sha256:digest!} : {kind:'sideload',trusted});
        await Promise.all([registryChanged(),refreshGrants()]);
        statusBanner = '已安装「'+result.manifest.name+'」，正在启动。';
        shell.openApp(result.id);
      } catch (error) {
        statusBanner = error instanceof Error ? error.message : '安装失败，请重试。';
      } finally {
        progress = undefined;
        wowBusy = false;
        render();
      }
    }

    function render() {
      const apps = shell.getInstalledApps();
      const grants = shell.listPermissionGrants();
      const assoc = shell.getFileAssociations();
      const uiApps = apps.filter((a) => a.runtime !== 'command');

      const tabBtnStyle = (tab: typeof activeTab) =>
        `padding:7px 14px;border:none;border-radius:6px;font-size:12.5px;cursor:pointer;background:${
          activeTab === tab ? '#4cc2ff' : 'rgba(255,255,255,0.06)'
        };color:${activeTab === tab ? '#0b1926' : '#e5e5e5'};font-weight:${activeTab === tab ? '600' : '400'};`;

      let bodyHtml = '';
      if (activeTab === 'install') {
        const action = (id: string, name: string) => {
          const installed = apps.find(app => app.id === "official-" + id);
          if (id === 'survivalcraft-api' && installed && (!installed.telemetry?.version || installed.telemetry.version === '1.9.5.1')) {
            return `<button data-as-install-survivalcraft ${wowBusy ? 'disabled' : ''} aria-label="更新生存战争">更新</button>`;
          }
          return installed
          ? `<button data-as-launch="${installed.id}" aria-label="打开${esc(name)}">打开</button>`
          : `<button data-as-install-wow="${id}" ${id === 'survivalcraft-api' ? 'data-as-install-survivalcraft' : ''} ${wowBusy ? 'disabled' : ''} aria-label="安装${esc(name)}">安装</button>`;
        };
        bodyHtml = `
          <article class="as-feature">
            <div><small>沙盒生存 (67.97 MiB)</small><h1>生存战争</h1>
            <p>在荒野中采集资源、搭建庇护所，活过第一个夜晚。</p>
            ${action('survivalcraft-api', '生存战争')}</div>
          </article>
          <h3 class="as-section-title">更多游戏</h3>
          <div class="as-games">${games.map(app => `
            <article class="as-game"><span class="as-game-icon" style="background:${app.accent}30">${app.icon}</span>
            <div><strong>${esc(app.name)}</strong><p>${esc(app.description)}</p></div>
            <footer>${action(app.id, app.name)}<a href="/packages/${app.id}.wow" download>下载安装包</a><a href="${esc(app.source)}" target="_blank" rel="noopener noreferrer">作品来源</a></footer></article>`).join('')}</div>`;
      } else if (activeTab === 'import') {
        bodyHtml = `<div style="display:grid;gap:12px">
            <div style="padding:16px;border-radius:8px;background:#222222;border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
              <div>
                <div style="font-weight:600;font-size:14px;color:#fff;">从 .wow 文件安装</div>
                <div style="font-size:12px;color:#aaa;margin-top:4px;">导入后会解压到本机应用存储，并在 WinOnWeb 窗口内运行。</div>
              </div>
              <label style="padding:8px 14px;border-radius:6px;background:#2d78d4;color:#fff;font-weight:600;cursor:pointer;font-size:12.5px;">
                选择 .wow 文件
                <input type="file" accept=".wow,application/octet-stream" data-as-wow-file hidden />
              </label>
            </div>

            <div style="padding:16px;border-radius:8px;background:#222222;border:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;gap:12px;">
              <h3 style="margin:0;font-size:14.5px;">安装自定义 HTTPS 网页应用</h3>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#ccc;">
                  <span>应用标识 (仅小写字母/数字/短横线)</span>
                  <input type="text" data-as-field="id" value="${esc(draftId)}" style="height:30px;padding:0 10px;border-radius:4px;border:1px solid rgba(255,255,255,0.16);background:#181818;color:#fff;" />
                </label>
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#ccc;">
                  <span>显示名称</span>
                  <input type="text" data-as-field="name" value="${esc(draftName)}" style="height:30px;padding:0 10px;border-radius:4px;border:1px solid rgba(255,255,255,0.16);background:#181818;color:#fff;" />
                </label>
              </div>
              <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#ccc;">
                <span>应用入口网址（仅支持同源 /路径 或 https:// 加密链接）</span>
                <input type="text" data-as-field="url" value="${esc(draftUrl)}" style="height:30px;padding:0 10px;border-radius:4px;border:1px solid rgba(255,255,255,0.16);background:#181818;color:#fff;" />
              </label>
              <div style="display:grid;grid-template-columns:1fr auto;gap:12px;align-items:end;">
                <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#ccc;">
                  <span>可关联文件后缀（逗号分隔）</span>
                  <input type="text" data-as-field="exts" value="${esc(draftExts)}" style="height:30px;padding:0 10px;border-radius:4px;border:1px solid rgba(255,255,255,0.16);background:#181818;color:#fff;" />
                </label>
                <label style="display:inline-flex;align-items:center;gap:8px;height:30px;font-size:12.5px;cursor:pointer;">
                  <input type="checkbox" data-as-ondesktop ${draftOnDesktop ? 'checked' : ''} />
                  <span>在桌面生成图标</span>
                </label>
              </div>
              <div>
                <div style="font-size:12px;color:#ccc;margin-bottom:6px;">声明申请的系统敏感权限：</div>
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                  ${SENSITIVE_CAPS.map(
                    (c) => `
                      <label style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:5px;background:#1a1a1a;border:1px solid rgba(255,255,255,0.1);font-size:12px;cursor:pointer;">
                        <input type="checkbox" data-as-cap="${c.key}" ${draftCaps.has(c.key) ? 'checked' : ''} />
                        <span>${esc(c.label)}</span>
                      </label>
                    `,
                  ).join('')}
                </div>
              </div>
              <div style="display:flex;justify-content:flex-end;">
                <button type="button" data-as-submit-install style="padding:8px 18px;border-radius:6px;border:none;background:#4cc2ff;color:#081726;font-weight:600;cursor:pointer;font-size:12.5px;">安装到桌面与开始菜单</button>
              </div>
            </div>
          </div>
        `;
      } else if (activeTab === 'permissions') {
        bodyHtml = `
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${uiApps
              .map((app) => {
                const appPerms = grants[app.id] ?? {};
                const declared = SENSITIVE_CAPS.filter((c) => app.capabilities?.includes(c.key));
                const sourceText = app.source === 'user' ? '用户安装' : app.source === 'host' ? '宿主接入' : '系统内置';
                return `
                  <div style="padding:12px 14px;border-radius:8px;background:#222222;border:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;gap:8px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                      <div style="display:flex;align-items:center;gap:10px;">
                        <span>${shell.renderAppIcon(app.iconKey, 28)}</span>
                        <div>
                          <div style="font-weight:600;font-size:13.5px;color:#fff;">
                            ${esc(app.name)}
                            <span style="margin-left:6px;padding:1px 6px;border-radius:4px;font-size:10.5px;font-weight:400;background:rgba(255,255,255,0.08);color:#9cc9ff;">${sourceText}</span>
                            ${app.systemTrusted ? '<span style="margin-left:4px;padding:1px 6px;border-radius:4px;font-size:10.5px;font-weight:400;background:rgba(108,203,95,0.16);color:#8ce980;">默认信任核心</span>' : ''}
                          </div>
                          <div style="font-size:11.5px;color:#999;">${esc(app.description)}</div>
                        </div>
                      </div>
                      <div style="display:flex;gap:6px;flex-shrink:0;">
                        <button type="button" data-as-launch="${esc(app.id)}" style="padding:5px 12px;border-radius:4px;border:1px solid rgba(255,255,255,0.16);background:#2e2e2e;color:#fff;font-size:12px;cursor:pointer;">打开</button>
                        ${
                          app.source === 'user'
                            ? `<button type="button" data-as-uninstall="${esc(app.id)}" style="padding:5px 12px;border-radius:4px;border:1px solid rgba(255,107,107,0.5);background:rgba(255,107,107,0.15);color:#ff9b9b;font-size:12px;cursor:pointer;">卸载</button>`
                            : ''
                        }
                      </div>
                    </div>
                    ${
                      declared.length > 0
                        ? `<div style="display:flex;flex-wrap:wrap;gap:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.06);">
                            ${declared
                              .map((c) => {
                                const state: WinPermissionDecision | 'unset' =
                                  appPerms[c.key] ?? (app.systemTrusted ? 'granted' : 'unset');
                                const badgeColor =
                                  state === 'granted' ? '#6ccb5f' : state === 'denied' ? '#f87171' : '#f6b94d';
                                const stateLabel =
                                  state === 'granted' ? '已允许' : state === 'denied' ? '已拒绝' : '未授权(首次使用弹窗)';
                                return `
                                  <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:5px;background:#191919;border:1px solid rgba(255,255,255,0.08);font-size:11.5px;">
                                    <span>${esc(c.label)}：</span>
                                    <strong style="color:${badgeColor};">${stateLabel}</strong>
                                    <button type="button" data-as-perm="${esc(app.id)}|${c.key}|granted" style="border:none;background:rgba(108,203,95,0.18);color:#8ce980;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:11px;">允许</button>
                                    <button type="button" data-as-perm="${esc(app.id)}|${c.key}|denied" style="border:none;background:rgba(248,113,113,0.18);color:#fca5a5;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:11px;">拒绝</button>
                                    <button type="button" data-as-perm="${esc(app.id)}|${c.key}|reset" style="border:none;background:rgba(255,255,255,0.08);color:#ccc;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:11px;">重置</button>
                                  </div>
                                `;
                              })
                              .join('')}
                          </div>`
                        : `<div style="font-size:11.5px;color:#777;">未申请敏感系统权限</div>`
                    }
                  </div>
                `;
              })
              .join('')}
          </div>
        `;
      } else {
        const exts = [...new Set([...COMMON_EXTENSIONS, ...Object.keys(assoc)])].sort();
        bodyHtml = `
          <div style="padding:14px;border-radius:8px;background:#222222;border:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;gap:10px;">
            <div style="font-size:12.5px;color:#cccccc;">设置在文件资源管理器双击或在任意应用中打开特定后缀名文件时的默认处理程序：</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${exts
                .map((ext) => {
                  const curApp = assoc[ext] ?? '';
                  return `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:6px;background:#1a1a1a;border:1px solid rgba(255,255,255,0.06);">
                      <code style="font-size:13px;color:#4cc2ff;font-weight:600;">*${esc(ext)}</code>
                      <select data-as-assoc-ext="${esc(ext)}" style="height:28px;padding:0 10px;border-radius:4px;border:1px solid rgba(255,255,255,0.18);background:#2b2b2b;color:#f3f3f3;font-size:12px;">
                        <option value="" ${curApp === '' ? 'selected' : ''}>（未关联）</option>
                        ${uiApps
                          .map(
                            (app) => `<option value="${esc(app.id)}" ${curApp === app.id ? 'selected' : ''}>${esc(app.name)} (${esc(app.id)})</option>`,
                          )
                          .join('')}
                      </select>
                    </div>
                  `;
                })
                .join('')}
            </div>
          </div>
        `;
      }

      container.innerHTML = `
        <div style="height:100%;overflow-y:auto;padding:18px 22px;background:#191919;color:#f3f3f3;font-family:'Segoe UI Variable Text','Segoe UI','Microsoft YaHei UI',sans-serif;box-sizing:border-box;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
            <div>
              <h2 style="margin:0 0 4px;font-size:20px;font-weight:600;">应用商店</h2>
              
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" data-as-tab="install" style="${tabBtnStyle('install')}">发现</button>
              <button type="button" data-as-tab="import" style="${tabBtnStyle('import')}">导入应用</button>
              <button type="button" data-as-tab="permissions" style="${tabBtnStyle('permissions')}">我的应用</button>
              <button type="button" data-as-tab="assoc" style="${tabBtnStyle('assoc')}">默认应用</button>
            </div>
          </div>
          ${statusBanner ? `<div class="as-status"><span role="status">${esc(statusBanner)}</span>
            ${progress ? '<span data-as-amount></span><progress data-as-progress aria-label="下载进度"></progress>' : ''}</div>` : ''}
          ${bodyHtml}
        </div>
      `;
      paintProgress();
    }

    function handleInput(e: Event) {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement && t.dataset.asWowFile !== undefined && t.files?.[0]) {
        void install(t.files[0].name, t.files[0]);
      } else if (t instanceof HTMLInputElement && t.dataset.asField) {
        if (t.dataset.asField === 'id') draftId = t.value;
        else if (t.dataset.asField === 'name') draftName = t.value;
        else if (t.dataset.asField === 'url') draftUrl = t.value;
        else if (t.dataset.asField === 'exts') draftExts = t.value;
      } else if (t instanceof HTMLInputElement && t.dataset.asOndesktop !== undefined) {
        draftOnDesktop = t.checked;
      } else if (t instanceof HTMLInputElement && t.dataset.asCap) {
        const cap = t.dataset.asCap as WinAppCapability;
        if (t.checked) draftCaps.add(cap);
        else draftCaps.delete(cap);
      } else if (t instanceof HTMLSelectElement && t.dataset.asAssocExt) {
        shell.setFileAssociation(t.dataset.asAssocExt, t.value);
        statusBanner = `已更新 ${t.dataset.asAssocExt} 的默认打开程序为 ${t.value || '未关联'}。`;
        render();
      }
    }

    async function handleClick(e: Event) {
      const t = e.target as HTMLElement | null;
      if (!t) return;

      const tabBtn = t.closest<HTMLElement>('[data-as-tab]');
      if (tabBtn?.dataset.asTab) {
        activeTab = tabBtn.dataset.asTab as typeof activeTab;
        render();
        return;
      }

      if (t.closest('[data-as-install-survivalcraft]')) {
        void install('生存战争', 'survivalcraft-api.wow');
        return;
      }

      const wowBtn = t.closest<HTMLElement>('[data-as-install-wow]');
      if (wowBtn?.dataset.asInstallWow) {
        const app = games.find(item => item.id === wowBtn.dataset.asInstallWow);
        if (app) void install(app.name, app.id + '.wow');
        return;
      }

      if (t.closest('[data-as-submit-install]')) {
        await installFromDraft();
        return;
      }

      const launchBtn = t.closest<HTMLElement>('[data-as-launch]');
      if (launchBtn?.dataset.asLaunch) {
        shell.openApp(launchBtn.dataset.asLaunch);
        return;
      }

      const unBtn = t.closest<HTMLElement>('[data-as-uninstall]');
      if (unBtn?.dataset.asUninstall) {
        const id = unBtn.dataset.asUninstall;
        if (await shell.uninstallUserApp(id)) {
          statusBanner = `已卸载应用 ${id}，并已自动清理其权限记录与私有存储。`;
          render();
        }
        return;
      }

      const permBtn = t.closest<HTMLElement>('[data-as-perm]');
      if (permBtn?.dataset.asPerm) {
        const [appId, cap, action] = permBtn.dataset.asPerm.split('|');
        const next: WinPermissionDecision | null =
          action === 'granted' ? 'granted' : action === 'denied' ? 'denied' : null;
        shell.setPermissionDecision(appId, cap as WinAppCapability, next);
        statusBanner = `已将 ${appId} 的 ${cap} 权限设为：${next ?? '待询问（下次使用触发弹窗）'}。`;
        render();
      }
    }

    const unsubReg = shell.subscribeRegistry(() => render());
    const openWowInstaller = () => {
      activeTab = 'import';
      render();
      window.setTimeout(() => container.querySelector<HTMLInputElement>('[data-as-wow-file]')?.click(), 0);
    };
    window.addEventListener('w11-open-wow-installer', openWowInstaller);
    void fetch('/packages/catalog.json', { cache: 'no-cache', signal: catalogRequest.signal })
      .then(async response => {
        if (!response.ok) throw new Error('无法读取游戏列表');
        games = await response.json();
        if (activeTab === 'install') render();
      })
      .catch(() => {
        if (catalogRequest.signal.aborted) return;
        statusBanner = '游戏列表加载失败，请重新打开应用中心。';
        render();
      });
    container.addEventListener('click', handleClick);
    container.addEventListener('change', handleInput);
    render();

    return {
      destroy: () => {
        catalogRequest.abort();
        unsubReg();
        window.removeEventListener('w11-open-wow-installer', openWowInstaller);
        container.removeEventListener('click', handleClick);
        container.removeEventListener('change', handleInput);
      },
    };
  },
};
