import { decideGrant, principalId } from '../../../wow/kernel/package-security';
import type { GrantRow } from '../../../wow/contracts';
import { records } from '../../../wow/hal/storage';
import { getManifestById } from './registry';
import { showModal } from '../shared/overlays';
import {
  hasAppCapability,
  type WinAppCapability,
  type WinAppManifest,
  type WinPermissionDecision,
} from '../types';

export const SENSITIVE_CAPABILITIES: readonly WinAppCapability[] = [
  'shell-control',
  'virtual-fs',
  'hardware-probe',
  'notifications',
  'app-messaging',
];

export const CAPABILITY_LABELS: Record<WinAppCapability, { title: string; detail: string }> = {
  theme: { title: '外观主题同步', detail: '随系统切换深色或浅色外观。' },
  volume: { title: '系统音量感知', detail: '获取系统媒体音量与静音状态。' },
  focus: { title: '窗口焦点感知', detail: '感知当前窗口是否处于激活状态。' },
  visibility: { title: '窗口可见性感知', detail: '感知最小化或还原状态。' },
  'window-control': { title: '窗口尺寸控制', detail: '允许程序请求最小化、最大化或关闭自身窗口。' },
  'shell-control': { title: '启动其他应用', detail: '允许唤起桌面内其他已注册应用或文件默认打开程序。' },
  'virtual-fs': {
    title: '读写虚拟系统盘与 D 盘文件',
    detail: '允许浏览目录、打开或修改 C 盘临时文件及你主动挂载的本机 D 盘数据。',
  },
  'hardware-probe': {
    title: '读取真实硬件探测信息',
    detail: '允许获取设备处理器、显卡、内存、存储配额与实时性能曲线。',
  },
  notifications: { title: '发送桌面通知', detail: '允许在桌面右下角弹出系统通知提示条。' },
  'app-messaging': { title: '跨应用协同通信', detail: '允许向其他正在运行的应用发送事件或发起数据请求。' },
};

type PermissionTable = Record<string, Partial<Record<WinAppCapability, WinPermissionDecision>>>;

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function subject(manifest: WinAppManifest) {
  return principalId(
    manifest.id,
    manifest.source === 'user' ? 'installed' : manifest.source === 'host' ? 'host' : 'system',
  );
}
let table: PermissionTable = {};
const changes =
  typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('wow:grants')
    : null;
export async function refreshGrants() {
  table = Object.fromEntries(
    (await records<{ id: string; grants: GrantRow }>('grants')).map((row) => [row.id, row.grants]),
  );
}
changes?.addEventListener('message', () => void refreshGrants());
export function createPermissionManager(hostRootEl: HTMLElement) {
  const inflightPrompts = new Map<string, Promise<boolean>>();

  function listPermissionGrants(): PermissionTable {
    const grants: PermissionTable = {};
    for (const [key, row] of Object.entries(table)) {
      const id = key.replace(/^(system|host):/, '');
      const manifest = getManifestById(id);
      if (manifest && subject(manifest) === key) grants[id] = { ...row };
    }
    return grants;
  }

  function setPermissionDecision(
    appId: string,
    capability: WinAppCapability,
    decision: WinPermissionDecision | null,
  ) {
    const app = getManifestById(appId);
    if (!app) throw Error('应用已卸载');
    return decideGrant(subject(app), capability, decision, app.packageVersion)
      .then(refreshGrants)
      .then(() => changes?.postMessage(true));
  }

  async function ensurePermission(manifest: WinAppManifest, capability: WinAppCapability): Promise<boolean> {
    if (!hasAppCapability(manifest, capability)) {
      return false;
    }
    if (!SENSITIVE_CAPABILITIES.includes(capability)) {
      return true;
    }

    await refreshGrants();
    const explicit = table[subject(manifest)]?.[capability];
    if (explicit === 'granted') return true;
    if (explicit === 'denied') return false;

    if (manifest.systemTrusted) {
      return true;
    }

    const promptKey = [manifest.id, manifest.packageVersion, capability].join(':');
    const existingPrompt = inflightPrompts.get(promptKey);
    if (existingPrompt) return existingPrompt;

    const meta = CAPABILITY_LABELS[capability];
    const sourceBadge =
      manifest.source === 'user'
        ? '用户安装的外部网页应用'
        : manifest.runtime === 'iframe'
          ? '嵌入式外部网页应用'
          : '桌面扩展应用';

    const task = new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = async (allowed: boolean, remember: boolean) => {
        if (settled) return;
        settled = true;
        if (remember) {
          try {
            await decideGrant(
              subject(manifest),
              capability,
              allowed ? 'granted' : 'denied',
              manifest.packageVersion,
            );
            await refreshGrants();
            changes?.postMessage(true);
          } catch {
            resolve(false);
            return;
          }
        }
        resolve(allowed);
      };

      const { close } = showModal(hostRootEl, {
        title: '系统权限请求',
        width: 430,
        bodyHtml: `
          <div style="display:flex;flex-direction:column;gap:8px;">
            <div style="font-weight:600;color:#ffffff;font-size:13.5px;">
              是否允许“${esc(manifest.name)}”访问以下系统能力？
            </div>
            <div style="font-size:11.5px;color:#9cc9ff;">来源：${esc(sourceBadge)} (${esc(manifest.id)})</div>
            <div style="padding:10px 12px;border-radius:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);">
              <div style="font-weight:600;color:#4cc2ff;margin-bottom:4px;">${esc(meta.title)}</div>
              <div style="color:#d4d4d4;font-size:12px;line-height:1.5;">${esc(meta.detail)}</div>
            </div>
            <div style="font-size:11.5px;color:#a0a0a0;">可随时在“应用中心 -> 权限管理”中更改或撤回授权。</div>
          </div>
        `,
        footerButtons: [
          {
            label: '本次拒绝',
            onClick: (_, done) => {
              done();
              settle(false, false);
            },
          },
          {
            label: '拒绝并记住',
            onClick: (_, done) => {
              done();
              settle(false, true);
            },
          },
          {
            label: '允许（记住授权）',
            primary: true,
            onClick: (_, done) => {
              done();
              settle(true, true);
            },
          },
        ],
        onMount: (dialog) => {
          dialog.querySelector('.w11-tm-modal-x')?.addEventListener('click', () => settle(false, false));
          dialog.parentElement?.addEventListener('click', (e) => {
            if (e.target === dialog.parentElement) settle(false, false);
          });
          const onEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
              window.removeEventListener('keydown', onEsc);
              close();
              settle(false, false);
            }
          };
          window.addEventListener('keydown', onEsc);
        },
      });
    }).finally(() => {
      inflightPrompts.delete(promptKey);
    });

    inflightPrompts.set(promptKey, task);
    return task;
  }

  return {
    ensurePermission,
    listPermissionGrants,
    setPermissionDecision,
  };
}
