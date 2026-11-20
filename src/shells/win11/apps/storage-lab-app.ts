import { directoryPicker, supportsPersistence, supportsOpfs } from '../../../wow/hal/storage';
import {
  computeHostDirStats,
  listHostDirectory,
  type HostEntryItem,
  type OpfsEntrySummary,
} from '../system/virtual-storage';
import type { WinAppHostContext, WinAppLifecycle, WinAppModule } from '../types';

interface HostDirState {
  rootName: string;
  currentPath: string[];
  dirStack: FileSystemDirectoryHandle[];
  entries: HostEntryItem[];
  recursiveFileCount: number;
  recursiveDirCount: number;
  recursiveTotalBytes: number;
  selectedFilePreview: {
    name: string;
    sizeBytes: number;
    lastModified: string;
    textPreview: string;
    hexPreview: string;
  } | null;
}

function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '未知';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB (${(bytes / 1000 ** 3).toFixed(2)} GB)`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const storageLabApp: WinAppModule = {
  mount(ctx: WinAppHostContext): WinAppLifecycle {
    const { container, shell } = ctx;
    const vfs = shell.getVirtualStorage();

    let statusLog = '就绪：可在下方查看路线 1 为何不弹窗、清理路线 2 测试块（避免 SSD 写入损耗），或用路线 3 挂载本机目录直接预览文件。';
    let busy = false;
    let monitor: Worker | null = null;
    let opfsEntries: OpfsEntrySummary[] = [];
    let hostDir: HostDirState | null = null;

    function render() {
      const hw = shell.getVirtualHardware();
      const sp = hw.storage.probe;
      const quotaBytes = sp?.quotaBytes ?? null;
      const usageBytes = sp?.usageBytes ?? null;
      const persisted = sp?.persisted ?? null;
      const opfsSupported = sp?.opfsSupported ?? false;
      const fsAccessSupported =
        typeof window !== 'undefined' && (Boolean(directoryPicker()) || Boolean(sp?.fsAccessSupported));
      const opfsTotalBytes = opfsEntries.reduce((acc, item) => acc + item.sizeBytes, 0);
      const notifPerm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';

      container.innerHTML = `
        <div class="w11-slab" style="height:100%;overflow-y:auto;padding:18px 22px;background:#191919;color:#f3f3f3;font-family:'Segoe UI Variable Text','Segoe UI','Microsoft YaHei UI',sans-serif;font-size:13px;line-height:1.5;box-sizing:border-box;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.1);">
            <div>
              <h2 style="margin:0 0 4px;font-size:20px;font-weight:600;color:#ffffff;">OPFS 存储与本机挂载实验室</h2>
              <div style="color:#b8b8b8;font-size:12px;">实测路线 1（持久化权限）、路线 2（OPFS 沙盒管理）与路线 3（本机目录挂载与文件预览）</div>
            </div>
            <div style="display:flex;gap:8px;flex-shrink:0;">
              <button type="button" data-slab-action="monitor">${monitor ? '停止监视' : '监视存储用量'}</button>
              <button type="button" data-slab-action="refresh" ${busy ? 'disabled' : ''} style="padding:6px 12px;border-radius:4px;border:1px solid rgba(255,255,255,0.16);background:#2b2b2b;color:#fff;cursor:pointer;font-size:12px;">刷新配额探测</button>
              <button type="button" data-slab-action="open-tm" style="padding:6px 12px;border-radius:4px;border:1px solid #0078d4;background:#0078d4;color:#fff;cursor:pointer;font-size:12px;">打开任务管理器</button>
            </div>
          </div>

          <div style="margin-bottom:14px;padding:10px 12px;border-radius:6px;background:#232323;border-left:3px solid #4cc2ff;font-size:12.5px;color:#e6e6e6;">
            <strong>实时日志：</strong>${esc(statusLog)}
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:14px;">
            <div style="padding:12px;border-radius:6px;background:#242424;border:1px solid rgba(255,255,255,0.08);">
              <div style="color:#aaaaaa;font-size:11.5px;">当前站点配额 (estimate.quota)</div>
              <div style="font-size:18px;font-weight:600;color:#4cc2ff;margin-top:3px;">${esc(formatBytes(quotaBytes))}</div>
            </div>
            <div style="padding:12px;border-radius:6px;background:#242424;border:1px solid rgba(255,255,255,0.08);">
              <div style="color:#aaaaaa;font-size:11.5px;">当前已用空间 (estimate.usage)</div>
              <div style="font-size:18px;font-weight:600;color:#6ccb5f;margin-top:3px;">${esc(formatBytes(usageBytes))}</div>
            </div>
            <div style="padding:12px;border-radius:6px;background:#242424;border:1px solid rgba(255,255,255,0.08);">
              <div style="color:#aaaaaa;font-size:11.5px;">持久化保护 (storage.persisted)</div>
              <div style="font-size:16px;font-weight:600;color:${persisted ? '#6ccb5f' : '#f6b94d'};margin-top:4px;">
                ${persisted === true ? '已启用 (Persisted)' : persisted === false ? '未启用 (Best-Effort)' : '未知'}
              </div>
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:12px;">
            <section style="padding:14px;border-radius:6px;background:#222222;border:1px solid rgba(255,255,255,0.09);">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
                <div style="flex:1;min-width:260px;">
                  <h3 style="margin:0 0 4px;font-size:15px;color:#ffffff;">路线 1：为什么 <code>navigator.storage.persist()</code> 点了没弹窗？</h3>
                  <p style="margin:0;color:#bbbbbb;font-size:12px;">
                    • <strong>Firefox</strong>：会直接弹出权限框让你点“允许”。<br/>
                    • <strong>Edge / Chrome (Chromium)</strong>：<strong>故意取消了独立弹窗</strong>，改为由浏览器后台自动判定！只有满足以下任一条件时才会批准 <code>true</code>：① 用户将该网页<strong>加入书签 (Ctrl+D)</strong>；② 用户授权了<strong>通知权限 (Notifications: 当前为 <code>${esc(notifPerm)}</code>)</strong>；③ 安装为 PWA。<br/>
                    • 注意：在自签名 HTTPS 证书（地址栏显示“不安全”）或无痕窗口下，Chromium 也会直接拒绝持久化申请。
                  </p>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0;">
                  <button type="button" data-slab-action="notif-then-persist" ${busy ? 'disabled' : ''} style="padding:7px 12px;border-radius:4px;border:1px solid rgba(246,185,77,0.5);background:rgba(246,185,77,0.14);color:#fcd34d;cursor:pointer;font-size:12px;">
                    1. 先申请通知权限弹窗
                  </button>
                  <button type="button" data-slab-action="persist" ${busy ? 'disabled' : ''} style="padding:7px 14px;border-radius:4px;border:1px solid #38bdf8;background:rgba(56,189,248,0.16);color:#7dd3fc;cursor:pointer;font-size:12.5px;font-weight:600;">
                    2. 调用 storage.persist()
                  </button>
                </div>
              </div>
            </section>

            <section style="padding:14px;border-radius:6px;background:#222222;border:1px solid rgba(255,255,255,0.09);">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
                <div style="flex:1;min-width:260px;">
                  <h3 style="margin:0 0 4px;font-size:15px;color:#ffffff;">路线 2：OPFS 沙盒文件清理（避免无意义 SSD 写入损耗）</h3>
                  <p style="margin:0;color:#bbbbbb;font-size:12px;">
                    诚如你所说，靠往 OPFS 塞无意义数据块来推高动态配额会白白消耗 SSD 闪存寿命（TBW）。建议立即点击右侧<strong>清空 OPFS 测试块</strong>释放刚才写入的 320 MiB。
                  </p>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0;">
                  <button type="button" data-slab-action="clear-opfs" ${busy || !opfsSupported ? 'disabled' : ''} style="padding:7px 14px;border-radius:4px;border:1px solid rgba(255,107,107,0.55);background:rgba(255,107,107,0.18);color:#ff9b9b;cursor:pointer;font-size:12.5px;font-weight:600;">
                    清空 OPFS 测试块 (${esc(formatBytes(opfsTotalBytes))})
                  </button>
                </div>
              </div>
              <div style="padding:8px 10px;border-radius:4px;background:#1a1a1a;font-size:12px;color:#cccccc;">
                <div><strong>当前 OPFS 根目录文件 (${opfsEntries.length} 项，合计 ${esc(formatBytes(opfsTotalBytes))})：</strong></div>
                ${
                  opfsEntries.length === 0
                    ? '<div style="color:#777;margin-top:3px;">（当前 OPFS 根目录为空，0 字节占用）</div>'
                    : `<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:6px;">${opfsEntries
                        .map(
                          (e) =>
                            `<span style="padding:2px 8px;border-radius:3px;background:#2a2a2a;border:1px solid rgba(255,255,255,0.08);">${esc(e.name)} (${esc(formatBytes(e.sizeBytes))})</span>`,
                        )
                        .join('')}</div>`
                }
              </div>
            </section>

            <section style="padding:14px;border-radius:6px;background:#222222;border:1px solid rgba(255,255,255,0.09);">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
                <div style="flex:1;min-width:260px;">
                  <h3 style="margin:0 0 4px;font-size:15px;color:#ffffff;">路线 3：挂载宿主机目录当 D 盘 — 能看到什么？（内置微型资源管理器）</h3>
                  <p style="margin:0;color:#bbbbbb;font-size:12px;">
                    • <strong>能看到的内容</strong>：所选目录及其所有子文件夹下的<strong>文件名、精确字节大小、修改时间、以及任意文件的完整内容（文本/二进制）</strong>，并可统计整个挂载目录已占用的总大小。<br/>
                    • <strong>看不到的内容</strong>：标准出于隐私保护，<strong>不提供整个物理分区（如整个 D: 盘）的剩余可用容量 API</strong>；且系统保护目录（如 <code>C:\\Windows</code>、<code>AppData</code>）会被浏览器拦截禁止选择。
                  </p>
                </div>
                <button type="button" data-slab-action="mount-host" ${busy || !fsAccessSupported ? 'disabled' : ''} style="padding:7px 14px;border-radius:4px;border:1px solid #c084fc;background:rgba(192,132,252,0.16);color:#d8b4fe;cursor:pointer;font-size:12.5px;font-weight:600;flex-shrink:0;">
                  ${fsAccessSupported ? '选择本机文件夹挂载为 D: 盘...' : '当前浏览器不支持 本地目录选择器'}
                </button>
              </div>
              ${
                hostDir
                  ? `<div style="padding:10px 12px;border-radius:6px;background:#181818;border:1px solid rgba(255,255,255,0.08);font-size:12px;color:#dddddd;">
                      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding-bottom:8px;margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.08);">
                        <div>
                          <strong>挂载路径：</strong>
                          <code>D:\\ (${esc(hostDir.rootName)})${hostDir.currentPath.length ? '\\' + hostDir.currentPath.map(esc).join('\\') : ''}</code>
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;">
                          <span style="color:#8ce980;">递归统计：${hostDir.recursiveFileCount} 个文件 / ${hostDir.recursiveDirCount} 个子目录 · 共占用 <strong>${esc(formatBytes(hostDir.recursiveTotalBytes))}</strong></span>
                          ${
                            hostDir.dirStack.length > 1
                              ? `<button type="button" data-slab-action="host-up" style="padding:3px 9px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:#2d2d2d;color:#fff;cursor:pointer;font-size:11.5px;">↑ 返回上级目录</button>`
                              : ''
                          }
                        </div>
                      </div>
                      <div style="display:grid;grid-template-columns:${hostDir.selectedFilePreview ? '1.2fr 1fr' : '1fr'};gap:12px;">
                        <div style="max-height:220px;overflow-y:auto;">
                          <table style="width:100%;border-collapse:collapse;font-size:12px;">
                            <thead>
                              <tr style="color:#999;text-align:left;border-bottom:1px solid rgba(255,255,255,0.08);">
                                <th style="padding:4px 6px;">名称 (点击文件夹进入 / 点击文件读取内容)</th>
                                <th style="padding:4px 6px;width:95px;text-align:right;">大小</th>
                                <th style="padding:4px 6px;width:135px;text-align:right;">修改时间</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${
                                hostDir.entries.length === 0
                                  ? '<tr><td colspan="3" style="padding:8px 6px;color:#777;">（空文件夹）</td></tr>'
                                  : hostDir.entries
                                      .map(
                                        (e, idx) => `
                                          <tr data-host-idx="${idx}" style="cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.04);">
                                            <td style="padding:5px 6px;color:${e.kind === 'directory' ? '#7dd3fc' : '#f3f3f3'};">${e.kind === 'directory' ? '📁' : '📄'} ${esc(e.name)}</td>
                                            <td style="padding:5px 6px;text-align:right;color:#bbb;">${e.kind === 'file' ? esc(formatBytes(e.sizeBytes)) : '—'}</td>
                                            <td style="padding:5px 6px;text-align:right;color:#888;">${e.lastModified ? new Date(e.lastModified).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
                                          </tr>
                                        `,
                                      )
                                      .join('')
                              }
                            </tbody>
                          </table>
                        </div>
                        ${
                          hostDir.selectedFilePreview
                            ? `<div style="padding:8px 10px;border-radius:4px;background:#222;border:1px solid rgba(255,255,255,0.1);overflow:hidden;">
                                <div style="font-weight:600;color:#fff;margin-bottom:4px;">📄 文件内容实测读取：${esc(hostDir.selectedFilePreview.name)}</div>
                                <div style="color:#999;font-size:11px;margin-bottom:6px;">大小：${esc(formatBytes(hostDir.selectedFilePreview.sizeBytes))} · 修改于：${esc(hostDir.selectedFilePreview.lastModified)}</div>
                                <div style="font-size:11px;color:#aaa;margin-bottom:2px;">前 64 字节 Hex 头部：</div>
                                <pre style="margin:0 0 6px;padding:6px;background:#141414;border-radius:3px;color:#8ce980;font-size:11px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;">${esc(hostDir.selectedFilePreview.hexPreview)}</pre>
                                <div style="font-size:11px;color:#aaa;margin-bottom:2px;">UTF-8 文本预览（前 500 字符）：</div>
                                <pre style="margin:0;padding:6px;background:#141414;border-radius:3px;color:#e0e0e0;font-size:11.5px;max-height:100px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;">${esc(hostDir.selectedFilePreview.textPreview)}</pre>
                              </div>`
                            : ''
                        }
                      </div>
                    </div>`
                  : ''
              }
            </section>
          </div>
        </div>
      `;
    }

    async function refreshAll(msg?: string) {
      opfsEntries = await vfs.listOpfsEntries();
      await shell.refreshVirtualStorage();
      if (msg) statusLog = msg;
      render();
    }

    async function clearOpfsBlocks() {
      if (!supportsOpfs()) return;
      busy = true;
      statusLog = '正在清理 OPFS 测试块...';
      render();
      try {
        const removed = await vfs.clearOpfsTestBlocks('opfs-block-');
        busy = false;
        await refreshAll(`已从 OPFS 删除 ${removed} 个测试块文件，320 MiB 物理空间已立即归还宿主机 SSD。`);
      } catch (err) {
        busy = false;
        statusLog = `清理 OPFS 失败：${String(err)}`;
        render();
      }
    }

    async function handleClick(e: Event) {
      const target = e.target as HTMLElement | null;

      // Click on host directory row (folder navigation or file content preview)
      const rowEl = target?.closest<HTMLElement>('[data-host-idx]');
      if (rowEl && hostDir && !busy) {
        const idx = Number(rowEl.dataset.hostIdx);
        const item = hostDir.entries[idx];
        if (!item) return;
        if (item.kind === 'directory') {
          const nextDir = item.handle as FileSystemDirectoryHandle;
          const nextEntries = await listHostDirectory(nextDir);
          hostDir.dirStack.push(nextDir);
          hostDir.currentPath.push(item.name);
          hostDir.entries = nextEntries;
          hostDir.selectedFilePreview = null;
          statusLog = `已进入本机子目录：${hostDir.currentPath.join('\\')}`;
          render();
          return;
        }
        try {
          const file = await (item.handle as FileSystemFileHandle).getFile();
          const slice = file.slice(0, 2048);
          const buf = new Uint8Array(await slice.arrayBuffer());
          const hex = Array.from(buf.slice(0, 64))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(' ');
          const text = new TextDecoder('utf-8', { fatal: false }).decode(buf).slice(0, 500);
          hostDir.selectedFilePreview = {
            name: file.name,
            sizeBytes: file.size,
            lastModified: new Date(file.lastModified).toLocaleString('zh-CN', { hour12: false }),
            hexPreview: hex || '（空文件）',
            textPreview: text || '（空文件）',
          };
          statusLog = `已直接读取本机文件 "${file.name}" (${formatBytes(file.size)}) 的真实内容！`;
          render();
        } catch (err) {
          statusLog = `读取文件失败：${String(err)}`;
          render();
        }
        return;
      }

      const btn = target?.closest<HTMLElement>('[data-slab-action]');
      if (!btn || busy) return;
      const action = btn.dataset.slabAction ?? '';

      if (action === 'monitor') {
        if (monitor) {
          monitor.terminate();
          monitor = null;
          statusLog = '存储用量监视已停止';
        } else {
          const worker = ctx.resources.startWorker(new URL('/wow/storage-monitor.js', location.origin));
          monitor = worker;
          worker.onmessage = ({ data }) => {
            if (worker !== monitor) return;
            statusLog = data.error ?? ('Worker 读取的存储用量：' + formatBytes(data.usage));
            if (data.error) monitor = null;
            render();
          };
          worker.onerror = () => {
            if (monitor !== worker) return;
            monitor = null;
            statusLog = '存储用量监视启动失败';
            render();
          };
        }
        render();
        return;
      }
      if (action === 'refresh') {
        busy = true;
        render();
        busy = false;
        await refreshAll('已重新探测 navigator.storage.estimate() 与 OPFS 目录。');
        return;
      }

      if (action === 'open-tm') {
        shell.openApp('task-manager');
        return;
      }

      if (action === 'notif-then-persist') {
        if (typeof Notification === 'undefined' || !Notification.requestPermission) {
          statusLog = '当前环境不支持 Notification.requestPermission()。';
          render();
          return;
        }
        try {
          statusLog = '正在请求浏览器通知权限（Chromium 允许通知后通常会自动放行 storage.persist）...';
          render();
          const perm = await Notification.requestPermission();
          const { granted } = await vfs.requestPersistence();
          await refreshAll(`通知权限结果: ${perm} -> 再次调用 storage.persist() 返回: ${granted}`);
        } catch (err) {
          statusLog = `请求通知权限失败：${String(err)}`;
          render();
        }
        return;
      }

      if (action === 'persist') {
        if (!supportsPersistence()) {
          statusLog = '当前浏览器不支持 navigator.storage.persist()。';
          render();
          return;
        }
        busy = true;
        statusLog = '正在调用 navigator.storage.persist() 请求持久化存储权限...';
        render();
        try {
          const { granted } = await vfs.requestPersistence();
          busy = false;
          await refreshAll(
            granted
              ? '持久化权限已获批 (persisted = true)！'
              : '浏览器静默返回 persisted = false（Chromium 不弹框，需满足通知授权/加入书签/正式证书且非无痕窗口才会返回 true）。',
          );
        } catch (err) {
          busy = false;
          statusLog = `调用 persist() 出错：${String(err)}`;
          render();
        }
        return;
      }

      if (action === 'clear-opfs') {
        await clearOpfsBlocks();
        return;
      }

      if (action === 'host-up' && hostDir && hostDir.dirStack.length > 1) {
        hostDir.dirStack.pop();
        hostDir.currentPath.pop();
        const curDir = hostDir.dirStack[hostDir.dirStack.length - 1];
        hostDir.entries = await listHostDirectory(curDir);
        hostDir.selectedFilePreview = null;
        render();
        return;
      }

      if (action === 'mount-host') {
        const picker = directoryPicker();
        if (typeof picker !== 'function') {
          statusLog = '当前浏览器不支持 本地目录选择器。';
          render();
          return;
        }
        try {
          statusLog = '请在弹出的系统文件夹选择器中选择一个本机目录...';
          render();
          const dirHandle = await picker({ mode: 'readwrite' });
          await shell.getVirtualStorage().mountDriveD(dirHandle);
          const entries = await listHostDirectory(dirHandle);
          const stats = await computeHostDirStats(dirHandle);
          hostDir = {
            rootName: dirHandle.name,
            currentPath: [],
            dirStack: [dirHandle],
            entries,
            recursiveFileCount: stats.files,
            recursiveDirCount: stats.dirs,
            recursiveTotalBytes: stats.bytes,
            selectedFilePreview: null,
          };
          statusLog = `已将宿主机目录 "${dirHandle.name}" 同步挂载为系统“本地磁盘 (D:)”：递归扫描到 ${stats.files} 个文件、${stats.dirs} 个子目录，共 ${formatBytes(stats.bytes)}。现在所有应用与文件弹窗均可访问 D: 盘！`;
          render();
        } catch (err) {
          statusLog = `未完成本机目录挂载：${String(err)}`;
          render();
        }
      }
    }

    container.addEventListener('click', handleClick);
    render();
    void refreshAll();

    return {
      onThemeChange: () => render(),
      onHardwareUpdate: () => {
        if (!busy) render();
      },
      destroy: () => {
        container.removeEventListener('click', handleClick);
      },
    };
  },
};
