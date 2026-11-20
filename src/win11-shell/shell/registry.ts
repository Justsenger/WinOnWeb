import { getWinDesktopHostConfig } from '../host-config';
export { hasAppCapability } from '../types';
import type { WinAppManifest } from '../types';

const USER_APPS_KEY = 'win11-web-shell:installed-apps:v1';
const FILE_ASSOC_KEY = 'win11-web-shell:file-assoc:v1';

const DEFAULT_FILE_ASSOCIATIONS: Record<string, string> = {
  '.txt': 'notepad',
  '.md': 'notepad',
  '.json': 'notepad',
  '.log': 'notepad',
  '.ini': 'notepad',
  '.cfg': 'notepad',
  '.xml': 'notepad',
  '.ps1': 'notepad',
  '.bat': 'notepad',
  '.cmd': 'notepad',
};

const registryListeners = new Set<() => void>();

function notifyRegistryChange() {
  registryListeners.forEach((fn) => fn());
}

function readUserApps(): WinAppManifest[] {
  try {
    const raw = localStorage.getItem(USER_APPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WinAppManifest[]) : [];
  } catch {
    return [];
  }
}

function writeUserApps(list: WinAppManifest[]): void {
  try {
    localStorage.setItem(USER_APPS_KEY, JSON.stringify(list));
  } catch {}
}

function readFileAssocMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(FILE_ASSOC_KEY);
    if (!raw) return { ...DEFAULT_FILE_ASSOCIATIONS };
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? { ...DEFAULT_FILE_ASSOCIATIONS, ...(parsed as Record<string, string>) }
      : { ...DEFAULT_FILE_ASSOCIATIONS };
  } catch {
    return { ...DEFAULT_FILE_ASSOCIATIONS };
  }
}

function writeFileAssocMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(FILE_ASSOC_KEY, JSON.stringify(map));
  } catch {}
}

/**
 * Web 桌面应用注册表（Manifest）。
 * 内置系统应用声明在此维护；第三方宿主应用通过 configureWinDesktopHost() 动态注入。
 */
export const CORE_APP_REGISTRY: WinAppManifest[] = [
  {
    id: 'this-pc',
    name: '此电脑',
    iconKey: 'this-pc',
    description: '管理驱动器、系统信息与设备连接。',
    category: 'system',
    runtime: 'builtin',
    onDesktop: true,
    pinnedToStart: true,
    pinnedToTaskbar: false,
    window: {
      defaultWidth: 788,
      defaultHeight: 590,
      defaultX: 123,
      defaultY: 0,
      minWidth: 640,
      minHeight: 420,
      seamlessTitlebar: true,
      background: '#191919',
    },
    capabilities: ['theme', 'hardware-probe', 'virtual-fs', 'window-control', 'shell-control'],
    systemTrusted: true,
    telemetry: {
      publisher: 'Microsoft Windows',
      estimatedMemMb: 48.5,
    },
  },
  {
    id: 'recycle-bin',
    name: '回收站',
    iconKey: 'recycle-bin',
    description: '查看与还原已删除的桌面项目。',
    category: 'system',
    runtime: 'builtin',
    onDesktop: true,
    pinnedToStart: false,
    pinnedToTaskbar: false,
    window: {
      defaultWidth: 780,
      defaultHeight: 480,
      minWidth: 400,
      minHeight: 280,
    },
    telemetry: {
      publisher: 'Microsoft Windows',
      estimatedMemMb: 36.2,
    },
  },
  {
    id: 'control-panel',
    name: '控制面板',
    iconKey: 'control-panel',
    description: '查看与更改传统的 Windows 系统控制项。',
    category: 'system',
    runtime: 'builtin',
    onDesktop: true,
    pinnedToStart: true,
    pinnedToTaskbar: false,
    window: {
      defaultWidth: 820,
      defaultHeight: 520,
      minWidth: 420,
      minHeight: 300,
    },
    telemetry: {
      publisher: 'Microsoft Windows',
      estimatedMemMb: 52.0,
    },
  },
  {
    id: 'explorer',
    name: '文件资源管理器',
    iconKey: 'explorer',
    description: '浏览本地文件与快速访问目录。',
    category: 'system',
    runtime: 'builtin',
    onDesktop: false,
    pinnedToStart: true,
    pinnedToTaskbar: true,
    window: {
      defaultWidth: 788,
      defaultHeight: 590,
      defaultX: 123,
      defaultY: 0,
      minWidth: 640,
      minHeight: 420,
      seamlessTitlebar: true,
      background: '#191919',
    },
    capabilities: ['theme', 'hardware-probe', 'virtual-fs', 'window-control', 'shell-control'],
    systemTrusted: true,
    telemetry: {
      publisher: 'Microsoft Windows',
      estimatedMemMb: 78.4,
    },
  },
  {
    id: 'settings',
    name: '设置',
    iconKey: 'settings',
    description: '调整桌面外观、主题与图标显示。',
    category: 'system',
    runtime: 'builtin',
    onDesktop: true,
    pinnedToStart: true,
    pinnedToTaskbar: false,
    window: {
      defaultWidth: 804,
      defaultHeight: 596,
      defaultX: 50,
      defaultY: 0,
      minWidth: 520,
      minHeight: 380,
    },
    capabilities: ['theme', 'volume', 'shell-control'],
    systemTrusted: true,
    telemetry: {
      publisher: 'Microsoft Windows',
      estimatedMemMb: 64.0,
    },
  },
  {
    id: 'task-manager',
    name: '任务管理器',
    iconKey: 'task-manager',
    description: '查看当前桌面窗口进程与设备硬件探测状态。',
    category: 'system',
    runtime: 'builtin',
    onDesktop: false,
    pinnedToStart: true,
    pinnedToTaskbar: true,
    window: {
      defaultWidth: 1024,
      defaultHeight: 740,
      minWidth: 640,
      minHeight: 440,
      seamlessTitlebar: true,
      background: '#202020',
    },
    capabilities: ['theme', 'hardware-probe', 'shell-control', 'window-control'],
    systemTrusted: true,
    telemetry: {
      publisher: 'Microsoft Windows',
      estimatedMemMb: 86.5,
    },
  },
  {
    id: 'terminal',
    name: '终端',
    iconKey: 'terminal',
    description: 'Windows 终端命令行外壳占位。',
    category: 'utility',
    runtime: 'builtin',
    onDesktop: false,
    pinnedToStart: true,
    pinnedToTaskbar: false,
    window: {
      defaultWidth: 820,
      defaultHeight: 500,
      minWidth: 420,
      minHeight: 280,
    },
    telemetry: {
      publisher: 'Microsoft Corporation',
      estimatedMemMb: 58.0,
    },
  },
  {
    id: 'fullscreen',
    name: '全屏体验',
    iconKey: 'fullscreen',
    description: '切换浏览器全屏，获得沉浸式 Windows 11 桌面体验。',
    category: 'system',
    runtime: 'command',
    onDesktop: true,
    pinnedToStart: true,
    pinnedToTaskbar: false,
    capabilities: ['shell-control'],
    getDynamicLabel: ({ isFullscreen }) => (isFullscreen ? '退出全屏' : '全屏体验'),
  },
  {
    id: 'storage-lab',
    name: '存储扩容实验',
    iconKey: 'storage-lab',
    description: '实测 OPFS 配额机制、持久化申请、块文件写入与本机目录挂载。',
    category: 'utility',
    runtime: 'builtin',
    onDesktop: false,
    pinnedToStart: true,
    pinnedToTaskbar: false,
    window: {
      defaultWidth: 880,
      defaultHeight: 620,
      minWidth: 560,
      minHeight: 420,
    },
    capabilities: ['theme', 'hardware-probe', 'virtual-fs', 'shell-control'],
    systemTrusted: true,
    telemetry: {
      publisher: 'WHATWG Storage Lab',
      estimatedMemMb: 42.0,
    },
  },
  {
    id: 'notepad',
    name: '记事本',
    iconKey: 'notepad',
    description: '轻量文本编辑与查看器，支持读写临时系统盘 C: 与挂载数据盘 D: 文件。',
    category: 'utility',
    runtime: 'builtin',
    onDesktop: true,
    pinnedToStart: true,
    pinnedToTaskbar: false,
    singleton: false,
    window: {
      defaultWidth: 760,
      defaultHeight: 520,
      minWidth: 420,
      minHeight: 300,
    },
    capabilities: ['theme', 'virtual-fs', 'notifications', 'app-messaging'],
    supportedExtensions: ['.txt', '.md', '.json', '.log', '.ini', '.cfg', '.xml', '.ps1', '.bat', '.cmd'],
    telemetry: {
      publisher: 'Microsoft Windows',
      estimatedMemMb: 28.0,
    },
  },
  {
    id: 'app-store',
    name: '应用中心',
    iconKey: 'app-store',
    description: '动态安装与卸载网页应用、管理应用运行权限以及文件默认打开方式。',
    category: 'system',
    runtime: 'builtin',
    onDesktop: true,
    pinnedToStart: true,
    pinnedToTaskbar: true,
    window: {
      defaultWidth: 880,
      defaultHeight: 620,
      minWidth: 580,
      minHeight: 420,
    },
    capabilities: ['theme', 'shell-control', 'notifications'],
    systemTrusted: true,
    telemetry: {
      publisher: 'WinOnWeb Ecosystem',
      estimatedMemMb: 46.0,
    },
  },
];

export const APP_REGISTRY = CORE_APP_REGISTRY;

export function getAppRegistry(): WinAppManifest[] {
  const byId = new Map<string, WinAppManifest>();
  for (const app of CORE_APP_REGISTRY) byId.set(app.id, { ...app, source: 'core' });
  for (const app of getWinDesktopHostConfig().apps ?? []) byId.set(app.id, { ...app, source: 'host' });
  for (const app of readUserApps()) byId.set(app.id, { ...app, source: 'user' });
  return [...byId.values()];
}

export function getManifestById(appId: string): WinAppManifest | undefined {
  return getAppRegistry().find((app) => app.id === appId);
}

export function installUserApp(manifest: WinAppManifest): void {
  const clean: WinAppManifest = {
    ...manifest,
    source: 'user',
  };
  const current = readUserApps().filter((a) => a.id !== clean.id);
  current.push(clean);
  writeUserApps(current);

  if (clean.supportedExtensions && clean.supportedExtensions.length > 0) {
    const assoc = readFileAssocMap();
    for (const rawExt of clean.supportedExtensions) {
      const ext = rawExt.startsWith('.') ? rawExt.toLowerCase() : `.${rawExt.toLowerCase()}`;
      if (!assoc[ext]) assoc[ext] = clean.id;
    }
    writeFileAssocMap(assoc);
  }
  notifyRegistryChange();
}

export function uninstallUserApp(appId: string): boolean {
  const prev = readUserApps();
  const next = prev.filter((a) => a.id !== appId);
  if (next.length === prev.length) return false;
  writeUserApps(next);

  const assoc = readFileAssocMap();
  let assocChanged = false;
  for (const [ext, target] of Object.entries(assoc)) {
    if (target === appId) {
      if (DEFAULT_FILE_ASSOCIATIONS[ext]) assoc[ext] = DEFAULT_FILE_ASSOCIATIONS[ext];
      else delete assoc[ext];
      assocChanged = true;
    }
  }
  if (assocChanged) writeFileAssocMap(assoc);
  notifyRegistryChange();
  return true;
}

export function getFileAssociations(): Record<string, string> {
  return readFileAssocMap();
}

export function setFileAssociation(ext: string, appId: string): void {
  const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  const assoc = readFileAssocMap();
  assoc[normalized] = appId;
  writeFileAssocMap(assoc);
  notifyRegistryChange();
}

export function resolveAppForFile(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1 || dot === fileName.length - 1) return null;
  const ext = fileName.slice(dot).toLowerCase();
  const map = readFileAssocMap();
  const candidate = map[ext];
  if (candidate && getManifestById(candidate)) return candidate;
  const matchedApp = getAppRegistry().find((a) => a.supportedExtensions?.some((e) => e.toLowerCase() === ext));
  return matchedApp?.id ?? null;
}

export function subscribeRegistry(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => registryListeners.delete(listener);
}

export function getAppDisplayName(
  manifest: WinAppManifest,
  ctx: { isFullscreen: boolean },
): string {
  return manifest.getDynamicLabel ? manifest.getDynamicLabel(ctx) : manifest.name;
}
