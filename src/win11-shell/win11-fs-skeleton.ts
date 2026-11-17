import { getWinDesktopHostConfig } from './host-config';

export interface ExpFsNode {
  id: string;
  name: string;
  kind: 'root' | 'drive' | 'folder' | 'file';
  icon: string;
  parentId?: string;
  typeLabel: string;
  sizeBytes?: number;
  modifiedText: string;
  writable?: boolean;
  children?: string[];
}

export const EXP_ICONS = {
  thisPc: '/win11/icons/this-pc.png',
  home: '/win11/icons/explorer/addressbar.home.svg',
  gallery: '/win11/icons/explorer/addressbar.gallery.svg',
  onedrive: '/win11/icons/explorer/onedrive.svg',
  desktop: '/win11/icons/explorer/desktop.svg',
  documents: '/win11/icons/explorer/documents.svg',
  downloads: '/win11/icons/explorer/downloads.svg',
  pictures: '/win11/icons/explorer/pictures.svg',
  music: '/win11/icons/explorer/music.svg',
  videos: '/win11/icons/explorer/videos.svg',
  driveSystem: '/win11/icons/explorer/drive-system.svg',
  driveData: '/win11/icons/explorer/drive-data.svg',
  folder: '/win11/icons/explorer/folder.svg',
  libraries: '/win11/icons/explorer/libraries.svg',
  network: '/win11/icons/explorer/network.svg',
  cmdNew: '/win11/icons/explorer/windows.newitem.svg',
  cmdCut: '/win11/icons/explorer/windows.cut.svg',
  cmdCopy: '/win11/icons/explorer/windows.copy.svg',
  cmdPaste: '/win11/icons/explorer/windows.paste.svg',
  cmdRename: '/win11/icons/explorer/windows.rename.svg',
  cmdShare: '/win11/icons/explorer/windows.modernshare.svg',
  cmdDelete: '/win11/icons/explorer/windows.ribbondelete.svg',
  cmdSort: '/win11/icons/explorer/sortby.svg',
  cmdView: '/win11/icons/explorer/view.svg',
  cmdDetails: '/win11/icons/explorer/windows.previewpane.svg',
  fileExe: '/win11/icons/explorer/ext/exe.svg',
  fileDll: '/win11/icons/explorer/ext/dll.svg',
  fileSys: '/win11/icons/explorer/ext/sys.svg',
  fileDrv: '/win11/icons/explorer/ext/drv.svg',
  fileCpl: '/win11/icons/explorer/ext/cpl.svg',
  fileMsc: '/win11/icons/explorer/ext/msc.svg',
  fileIni: '/win11/icons/explorer/ext/ini.svg',
  fileCfg: '/win11/icons/explorer/ext/cfg.svg',
  fileInf: '/win11/icons/explorer/ext/inf.svg',
  fileTxt: '/win11/icons/explorer/ext/txt.svg',
  fileLog: '/win11/icons/explorer/ext/log.svg',
  fileXml: '/win11/icons/explorer/ext/xml.svg',
  fileJson: '/win11/icons/explorer/ext/json.svg',
  filePs1: '/win11/icons/explorer/ext/ps1.svg',
  fileBat: '/win11/icons/explorer/ext/bat.svg',
  fileCmd: '/win11/icons/explorer/ext/cmd.svg',
  fileCat: '/win11/icons/explorer/ext/cat.svg',
  fileMui: '/win11/icons/explorer/ext/mui.svg',
  fileGeneric: '/win11/icons/explorer/ext/unknown.svg',
} as const;

const EXT_META: Record<string, { icon: string; typeLabel: string }> = {
  exe: { icon: EXP_ICONS.fileExe, typeLabel: '应用程序' },
  com: { icon: EXP_ICONS.fileExe, typeLabel: 'MS-DOS 应用程序' },
  scr: { icon: EXP_ICONS.fileExe, typeLabel: '屏幕保护程序' },
  dll: { icon: EXP_ICONS.fileDll, typeLabel: '应用程序扩展' },
  sys: { icon: EXP_ICONS.fileSys, typeLabel: '系统文件' },
  drv: { icon: EXP_ICONS.fileDrv, typeLabel: '设备驱动程序' },
  ocx: { icon: EXP_ICONS.fileDll, typeLabel: 'ActiveX 控件' },
  cpl: { icon: EXP_ICONS.fileCpl, typeLabel: '控制面板项' },
  msc: { icon: EXP_ICONS.fileMsc, typeLabel: 'Microsoft 通用控制台文档' },
  winmd: { icon: EXP_ICONS.fileDll, typeLabel: 'Windows 元数据文件' },
  ini: { icon: EXP_ICONS.fileIni, typeLabel: '配置设置' },
  cfg: { icon: EXP_ICONS.fileCfg, typeLabel: 'CFG 文件' },
  inf: { icon: EXP_ICONS.fileInf, typeLabel: '安装信息' },
  txt: { icon: EXP_ICONS.fileTxt, typeLabel: '文本文档' },
  log: { icon: EXP_ICONS.fileLog, typeLabel: '文本文档' },
  xml: { icon: EXP_ICONS.fileXml, typeLabel: 'XML 文档' },
  json: { icon: EXP_ICONS.fileJson, typeLabel: 'JSON 文件' },
  ps1: { icon: EXP_ICONS.filePs1, typeLabel: 'Windows PowerShell 脚本' },
  bat: { icon: EXP_ICONS.fileBat, typeLabel: 'Windows 批处理文件' },
  cmd: { icon: EXP_ICONS.fileCmd, typeLabel: 'Windows 命令脚本' },
  mui: { icon: EXP_ICONS.fileMui, typeLabel: 'MUI 文件' },
  cat: { icon: EXP_ICONS.fileCat, typeLabel: '安全目录' },
};

export function getFileMetaByName(name: string): { icon: string; typeLabel: string } {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot !== -1 && dot < lower.length - 1) {
    const ext = lower.slice(dot + 1);
    const known = EXT_META[ext];
    if (known) {
      return known;
    }
    return {
      icon: EXP_ICONS.fileGeneric,
      typeLabel: `${ext.toUpperCase()} 文件`,
    };
  }
  return { icon: EXP_ICONS.fileGeneric, typeLabel: '文件' };
}

const mtimeFormatCache = new Map<number, string>();
function formatMtimeMin(mtimeMin: number): string {
  const cached = mtimeFormatCache.get(mtimeMin);
  if (cached) return cached;
  const d = new Date(mtimeMin * 60000);
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const str = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (mtimeFormatCache.size < 40000) mtimeFormatCache.set(mtimeMin, str);
  return str;
}

type TreeDef = string | [string, TreeDef[]] | { id: string; name: string; icon?: string; children?: TreeDef[] } | { file: string; type?: string; size?: number; icon?: string };

/**
 * Generates an authentic, zero-OPFS-cost Windows 11 C: directory skeleton
 * for File Explorer browsing without wasting real storage writes.
 */
export function createWin11FsNodes(): Record<string, ExpFsNode> {
  const nodes: Record<string, ExpFsNode> = {};
  const sysTime = '2026/10/01 09:12';
  const curTime = '2026/11/17 15:00';
  let autoId = 1;

  const addFile = (parentId: string, name: string, typeLabel?: string, sizeBytes = 0, icon?: string, customId?: string) => {
    const id = customId ?? `fs-f-${autoId++}`;
    const meta = getFileMetaByName(name);
    nodes[id] = {
      id,
      name,
      kind: 'file',
      icon: icon ?? meta.icon,
      parentId,
      typeLabel: typeLabel ?? meta.typeLabel,
      sizeBytes,
      modifiedText: sysTime,
    };
    return id;
  };

  const addDir = (parentId: string | undefined, name: string, items: TreeDef[], opts: { id?: string; icon?: string; modified?: string } = {}) => {
    const id = opts.id ?? `fs-d-${autoId++}`;
    const childIds: string[] = [];
    nodes[id] = {
      id,
      name,
      kind: 'folder',
      icon: opts.icon ?? EXP_ICONS.folder,
      parentId,
      typeLabel: '文件夹',
      modifiedText: opts.modified ?? sysTime,
      writable: true,
      children: childIds,
    };
    for (const entry of items) {
      if (typeof entry === 'string') {
        childIds.push(addDir(id, entry, []));
      } else if (Array.isArray(entry)) {
        childIds.push(addDir(id, entry[0], entry[1]));
      } else if ('file' in entry) {
        childIds.push(addFile(id, entry.file, entry.type ?? '文件', entry.size ?? 0, entry.icon ?? EXP_ICONS.libraries));
      } else {
        childIds.push(addDir(id, entry.name, entry.children ?? [], { id: entry.id, icon: entry.icon }));
      }
    }
    return id;
  };

  nodes['this-pc'] = {
    id: 'this-pc',
    name: '此电脑',
    kind: 'root',
    icon: EXP_ICONS.thisPc,
    typeLabel: '系统文件夹',
    modifiedText: curTime,
    writable: false,
    children: ['drive-c'],
  };

  const cChildren: string[] = [];
  nodes['drive-c'] = {
    id: 'drive-c',
    name: '本地磁盘 (C:)',
    kind: 'drive',
    icon: EXP_ICONS.driveSystem,
    parentId: 'this-pc',
    typeLabel: '本地磁盘',
    modifiedText: curTime,
    writable: true,
    children: cChildren,
  };

  cChildren.push(
    addDir('drive-c', 'PerfLogs', [], { id: 'c-perflogs' }),
    addDir(
      'drive-c',
      'Program Files',
      [
        ['Common Files', ['Microsoft Shared', 'Services', 'System']],
        ['Hyper-V', [{ file: 'vmconnect.exe', type: '应用程序', size: 1624064 }, { file: 'vmms.exe', type: '应用程序', size: 4218880 }]],
        'Internet Explorer',
        ['Microsoft Edge', ['Application']],
        'ModifiableWindowsApps',
        ['Windows Defender', [{ file: 'MpCmdRun.exe', type: '应用程序', size: 598016 }, { file: 'MsMpEng.exe', type: '应用程序', size: 135168 }]],
        'Windows Mail',
        'Windows Media Player',
        'Windows NT',
        ['WindowsPowerShell', ['Modules', 'v1.0']],
        'WindowsApps',
      ],
      { id: 'c-pf', modified: '2026/11/12 18:20' },
    ),
    addDir(
      'drive-c',
      'Program Files (x86)',
      [
        ['Common Files', ['Microsoft Shared', 'System']],
        'Internet Explorer',
        'Microsoft',
        ['Microsoft Edge', ['Application']],
        'Windows Defender',
        'Windows Media Player',
        'Windows NT',
      ],
      { id: 'c-pfx86', modified: '2026/10/14 11:05' },
    ),
    addDir(
      'drive-c',
      'ProgramData',
      [
        ['Microsoft', [['Windows', ['Start Menu', 'Caches']]]],
        'Package Cache',
        'USOShared',
      ],
      { id: 'c-programdata' },
    ),
    addDir(
      'drive-c',
      'Users',
      [
        {
          id: 'u-admin',
          name: 'Administrator',
          children: [
            ['AppData', [['Local', ['Microsoft', 'Packages', 'Temp']], 'LocalLow', ['Roaming', [['Microsoft', ['Windows']]]]]],
            'Contacts',
            {
              id: 'desktop',
              name: '桌面',
              icon: EXP_ICONS.desktop,
              children: [
                ...(getWinDesktopHostConfig().desktopShortcuts ?? []).map((s) => ({
                  file: s.file,
                  type: s.type ?? '快捷方式',
                  size: s.size ?? 2048,
                  icon: s.icon,
                })),
                { file: '设置.lnk', type: '快捷方式', size: 1536, icon: '/win11/icons/settings.png' },
              ],
            },
            { id: 'documents', name: '文档', icon: EXP_ICONS.documents, children: [] },
            { id: 'downloads', name: '下载', icon: EXP_ICONS.downloads, children: [] },
            'Favorites',
            'Links',
            { id: 'music', name: '音乐', icon: EXP_ICONS.music, children: [] },
            { id: 'pictures', name: '图片', icon: EXP_ICONS.pictures, children: [] },
            'Saved Games',
            'Searches',
            { id: 'videos', name: '视频', icon: EXP_ICONS.videos, children: [] },
            { file: 'NTUSER.DAT', type: 'DAT 文件', size: 3145728 },
          ],
        },
        ['Public', ['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos']],
      ],
      { id: 'c-users', modified: curTime },
    ),
    addDir(
      'drive-c',
      'Windows',
      [
        'addins',
        'appcompat',
        'apppatch',
        'AppReadiness',
        'assembly',
        ['Boot', ['EFI', 'Fonts', 'Resources']],
        ['Branding', ['Basebrd', 'Shellbrd']],
        'CbsTemp',
        'Containers',
        'Cursors',
        'debug',
        'diagnostics',
        'en-US',
        ['Fonts', [{ file: 'msyh.ttc', type: 'TrueType 字体集合', size: 19660800 }, { file: 'segoeui.ttf', type: 'TrueType 字体文件', size: 962560 }, { file: 'seguiemj.ttf', type: 'TrueType 字体文件', size: 2146304 }]],
        'Globalization',
        'Help',
        'IME',
        'Inf',
        'InputMethod',
        'LiveKernelReports',
        ['Logs', ['CBS', 'DISM', 'WindowsUpdate']],
        'Media',
        'Migration',
        'OCR',
        'Panther',
        'Performance',
        'PolicyDefinitions',
        'Prefetch',
        'Provisioning',
        ['Resources', ['Themes']],
        'security',
        'ServiceProfiles',
        'servicing',
        'Setup',
        'ShellComponents',
        'ShellExperiences',
        ['SoftwareDistribution', ['DataStore', 'Download']],
        'Speech',
        'System',
        [
          'System32',
          [
            'config',
            ['drivers', [['etc', [{ file: 'hosts', type: '文件', size: 824 }, { file: 'services', type: '文件', size: 17463 }]]]],
            ['DriverStore', ['FileRepository']],
            'en-US',
            'GroupPolicy',
            'LogFiles',
            'oobe',
            'spool',
            'Tasks',
            'wbem',
            ['WindowsPowerShell', ['v1.0']],
            'zh-CN',
            { file: 'cmd.exe', type: '应用程序', size: 327680, icon: '/win11/icons/terminal.png' },
            { file: 'conhost.exe', type: '应用程序', size: 917504 },
            { file: 'dwm.exe', type: '应用程序', size: 147456 },
            { file: 'lsass.exe', type: '应用程序', size: 65536 },
            { file: 'notepad.exe', type: '应用程序', size: 212992 },
            { file: 'ntoskrnl.exe', type: '应用程序', size: 11272192 },
            { file: 'services.exe', type: '应用程序', size: 737280 },
            { file: 'svchost.exe', type: '应用程序', size: 57344 },
            { file: 'Taskmgr.exe', type: '应用程序', size: 4620288, icon: '/win11/icons/task-manager.png' },
            { file: 'wininit.exe', type: '应用程序', size: 294912 },
            { file: 'winlogon.exe', type: '应用程序', size: 950272 },
          ],
        ],
        'SystemApps',
        ['SystemResources', [{ file: 'imageres.dll.mun', type: 'MUN 文件', size: 24280064 }, { file: 'shell32.dll.mun', type: 'MUN 文件', size: 18143744 }]],
        ['SysWOW64', ['drivers', 'en-US', 'zh-CN', { file: 'cmd.exe', type: '应用程序', size: 282624, icon: '/win11/icons/terminal.png' }]],
        'Tasks',
        'Temp',
        'tracing',
        ['Web', [['Wallpaper', [['Windows', [{ file: 'img0.jpg', type: 'JPG 文件', size: 409600 }]]]]]],
        ['WinSxS', ['Backup', 'Manifests', 'Temp']],
        'zh-CN',
        { file: 'explorer.exe', type: '应用程序', size: 4928512, icon: '/win11/icons/explorer.png' },
        { file: 'notepad.exe', type: '应用程序', size: 212992 },
        { file: 'regedit.exe', type: '应用程序', size: 393216 },
        { file: 'win.ini', type: '配置设置', size: 219 },
      ],
      { id: 'c-windows', modified: '2026/11/16 22:15' },
    ),
  );

  // Virtual shell root locations
  nodes['home'] = {
    id: 'home',
    name: '主文件夹',
    kind: 'root',
    icon: EXP_ICONS.home,
    typeLabel: '主文件夹',
    modifiedText: curTime,
    writable: false,
    children: ['desktop', 'downloads', 'documents', 'pictures', 'music', 'videos'],
  };
  nodes['gallery'] = {
    id: 'gallery',
    name: '图库',
    kind: 'root',
    icon: EXP_ICONS.gallery,
    typeLabel: '图库',
    modifiedText: curTime,
    writable: false,
    children: [],
  };
  addDir(undefined, 'OneDrive - Personal', ['文档', '图片', '桌面'], { id: 'onedrive', icon: EXP_ICONS.onedrive, modified: curTime });
  nodes['libraries'] = {
    id: 'libraries',
    name: '库',
    kind: 'root',
    icon: EXP_ICONS.libraries,
    typeLabel: '库',
    modifiedText: curTime,
    writable: false,
    children: ['documents', 'pictures', 'music', 'videos'],
  };
  nodes['network'] = {
    id: 'network',
    name: '网络',
    kind: 'root',
    icon: EXP_ICONS.network,
    typeLabel: '网络',
    modifiedText: curTime,
    writable: false,
    children: [],
  };

  return nodes;
}

const EXPLORER_SKELETON_URL = '/win11/explorer/c-skeleton.txt.gz';
let cachedSkeletonTextPromise: Promise<string | null> | null = null;
const pendingFilesByNodes = new WeakMap<Record<string, ExpFsNode>, Map<string, string[]>>();
const mergedTextLengths = new WeakMap<Record<string, ExpFsNode>, Set<number>>();

/**
 * Merges a `depth\tname[\tsize]` directory & file skeleton text into an existing
 * Explorer node map. Directories are linked immediately; file entries are stored
 * per-folder and materialized lazily via `hydrateWin11FolderFiles()`.
 */
export function mergeWin11SkeletonText(nodes: Record<string, ExpFsNode>, rawText: string): number {
  const root = nodes['drive-c'];
  if (!root || !rawText) return 0;

  let seenLens = mergedTextLengths.get(nodes);
  if (seenLens?.has(rawText.length)) return 0;
  if (!seenLens) {
    seenLens = new Set<number>();
    mergedTextLengths.set(nodes, seenLens);
  }
  seenLens.add(rawText.length);

  let pendingMap = pendingFilesByNodes.get(nodes);
  if (!pendingMap) {
    pendingMap = new Map<string, string[]>();
    pendingFilesByNodes.set(nodes, pendingMap);
  }

  const childMapCache = new Map<string, Map<string, string>>();
  const getChildMap = (parentId: string): Map<string, string> => {
    let map = childMapCache.get(parentId);
    if (map) return map;
    map = new Map<string, string>();
    const parent = nodes[parentId];
    for (const cid of parent?.children ?? []) {
      const child = nodes[cid];
      if (child && child.kind === 'folder') {
        map.set(child.name.toLowerCase(), cid);
      }
    }
    childMapCache.set(parentId, map);
    return map;
  };

  let nextId = 1;
  while (nodes[`sk-${nextId}`]) nextId++;

  const stack: string[] = ['drive-c'];
  const sysTime = '2026/10/01 09:12';
  let added = 0;

  let pos = 0;
  const len = rawText.length;
  while (pos < len) {
    let nl = rawText.indexOf('\n', pos);
    if (nl === -1) nl = len;
    const lineEnd = nl > pos && rawText.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
    if (lineEnd > pos) {
      const tab1 = rawText.indexOf('\t', pos);
      if (tab1 > pos && tab1 < lineEnd) {
        const depth = Number(rawText.slice(pos, tab1));
        if (Number.isInteger(depth) && depth >= 0) {
          const parentId = stack[depth] ?? 'drive-c';
          const tab2 = rawText.indexOf('\t', tab1 + 1);
          const tab3 = tab2 !== -1 && tab2 < lineEnd ? rawText.indexOf('\t', tab2 + 1) : -1;
          if (tab3 !== -1 && tab3 < lineEnd) {
            // File entry: depth\tname\tmtimeMin\tsize
            const fileEntry = rawText.slice(tab1 + 1, lineEnd);
            if (fileEntry) {
              let list = pendingMap.get(parentId);
              if (!list) {
                list = [];
                pendingMap.set(parentId, list);
              }
              list.push(fileEntry);
              added++;
            }
          } else {
            // Folder entry: depth\tname\tmtimeMin (or legacy depth\tname)
            const nameEnd = tab2 !== -1 && tab2 < lineEnd ? tab2 : lineEnd;
            const name = rawText.slice(tab1 + 1, nameEnd);
            const mtimeMin = tab2 !== -1 && tab2 < lineEnd ? Number(rawText.slice(tab2 + 1, lineEnd)) : 0;
            const modText = Number.isFinite(mtimeMin) && mtimeMin > 0 ? formatMtimeMin(mtimeMin) : sysTime;
            const parent = name ? nodes[parentId] : undefined;
            if (parent) {
              if (!parent.children) parent.children = [];
              const childMap = getChildMap(parentId);
              const key = name.toLowerCase();
              let nodeId = childMap.get(key);
              if (!nodeId) {
                nodeId = `sk-${nextId++}`;
                nodes[nodeId] = {
                  id: nodeId,
                  name,
                  kind: 'folder',
                  icon: EXP_ICONS.folder,
                  parentId,
                  typeLabel: '文件夹',
                  modifiedText: modText,
                  writable: true,
                  children: [],
                };
                parent.children.push(nodeId);
                childMap.set(key, nodeId);
                added++;
              } else if (mtimeMin > 0 && nodes[nodeId]) {
                nodes[nodeId].modifiedText = modText;
              }
              stack[depth + 1] = nodeId;
            }
          }
        }
      }
    }
    pos = nl + 1;
  }

  return added;
}

/**
 * Materializes pending file entries for a single folder on demand so
 * 220k+ system files cost zero upfront object allocations until visited.
 */
export function hydrateWin11FolderFiles(nodes: Record<string, ExpFsNode>, folderId: string): number {
  const pendingMap = pendingFilesByNodes.get(nodes);
  const rawList = pendingMap?.get(folderId);
  if (!rawList || rawList.length === 0) return 0;
  pendingMap!.delete(folderId);

  const parent = nodes[folderId];
  if (!parent) return 0;
  if (!parent.children) parent.children = [];

  const existingByName = new Map<string, string>();
  for (const cid of parent.children) {
    const child = nodes[cid];
    if (child) existingByName.set(child.name.toLowerCase(), cid);
  }

  let nextId = 1;
  const prefix = `skf-${folderId}-`;
  while (nodes[`${prefix}${nextId}`]) nextId++;

  const sysTime = '2026/10/01 09:12';
  let hydrated = 0;

  for (let i = 0; i < rawList.length; i++) {
    const entry = rawList[i];
    const t1 = entry.indexOf('\t');
    if (t1 <= 0) continue;
    const t2 = entry.indexOf('\t', t1 + 1);
    const name = entry.slice(0, t1);
    const mtimeMin = t2 > t1 ? Number(entry.slice(t1 + 1, t2)) : 0;
    const sizeBytes = t2 > t1 ? Number(entry.slice(t2 + 1)) || 0 : Number(entry.slice(t1 + 1)) || 0;
    const modText = Number.isFinite(mtimeMin) && mtimeMin > 0 ? formatMtimeMin(mtimeMin) : sysTime;

    const existingId = existingByName.get(name.toLowerCase());
    if (existingId) {
      const existingNode = nodes[existingId];
      if (existingNode && existingNode.kind === 'file') {
        if (mtimeMin > 0) existingNode.modifiedText = modText;
        if (sizeBytes > 0) existingNode.sizeBytes = sizeBytes;
      }
      continue;
    }

    const meta = getFileMetaByName(name);
    const id = `${prefix}${nextId++}`;
    nodes[id] = {
      id,
      name,
      kind: 'file',
      icon: meta.icon,
      parentId: folderId,
      typeLabel: meta.typeLabel,
      sizeBytes,
      modifiedText: modText,
    };
    parent.children.push(id);
    existingByName.set(name.toLowerCase(), id);
    hydrated++;
  }

  return hydrated;
}

export interface FolderScanStats {
  files: number;
  folders: number;
  totalBytes: number;
  diskBytes: number;
  done: boolean;
}

export function calcNtfsDiskBytes(sizeBytes: number): number {
  if (sizeBytes <= 0) return 0;
  return Math.ceil(sizeBytes / 4096) * 4096;
}

/**
 * Progressively traverses a folder subtree in small batches across animation frames
 * so the Properties dialog reproduces Windows' live-accumulating file/size counter.
 */
export function scanWin11FolderStatsAsync(
  nodes: Record<string, ExpFsNode>,
  rootFolderId: string,
  onProgress: (stats: FolderScanStats) => void,
  getDelayMs: () => number = () => 384,
): () => void {
  const pendingMap = pendingFilesByNodes.get(nodes);
  const queue: string[] = [rootFolderId];
  let qIdx = 0;
  let childCursor = 0;
  let rawCursor = 0;
  let activeExistingNames: Set<string> | null = null;
  let files = 0;
  let folders = 0;
  let totalBytes = 0;
  let diskBytes = 0;
  let cancelled = false;
  let timerId: number | null = null;

  const scheduleNext = (fn: () => void) => {
    const ms = Math.max(16, Number(getDelayMs()) || 384);
    timerId = setTimeout(fn, ms) as unknown as number;
  };

  const step = () => {
    if (cancelled) return;
    let budget = 650;
    while (qIdx < queue.length && budget > 0) {
      const dirId = queue[qIdx];
      const dirNode = nodes[dirId];
      if (!dirNode) {
        qIdx++;
        childCursor = 0;
        rawCursor = 0;
        activeExistingNames = null;
        continue;
      }

      if (!activeExistingNames) {
        activeExistingNames = new Set<string>();
      }

      const children = dirNode.children ?? [];
      while (childCursor < children.length && budget > 0) {
        const cid = children[childCursor++];
        const child = nodes[cid];
        if (!child) continue;
        activeExistingNames.add(child.name.toLowerCase());
        if (child.kind === 'folder') {
          folders++;
          queue.push(cid);
        } else if (child.kind === 'file') {
          const sz = child.sizeBytes ?? 0;
          files++;
          totalBytes += sz;
          diskBytes += calcNtfsDiskBytes(sz);
        }
        budget -= 1;
      }

      if (childCursor < children.length) {
        break;
      }

      const rawList = pendingMap?.get(dirId);
      if (rawList) {
        while (rawCursor < rawList.length && budget > 0) {
          const entry = rawList[rawCursor++];
          const t1 = entry.indexOf('\t');
          if (t1 <= 0) continue;
          const name = entry.slice(0, t1);
          if (activeExistingNames.has(name.toLowerCase())) continue;
          const t2 = entry.indexOf('\t', t1 + 1);
          const sz = t2 > t1 ? Number(entry.slice(t2 + 1)) || 0 : Number(entry.slice(t1 + 1)) || 0;
          files++;
          totalBytes += sz;
          diskBytes += calcNtfsDiskBytes(sz);
          budget -= 1;
        }
        if (rawCursor < rawList.length) {
          break;
        }
      }

      qIdx++;
      childCursor = 0;
      rawCursor = 0;
      activeExistingNames = null;
      budget -= 1;
    }

    const done = qIdx >= queue.length;
    onProgress({ files, folders, totalBytes, diskBytes, done });
    if (!done && !cancelled) {
      scheduleNext(step);
    }
  };

  scheduleNext(step);
  return () => {
    cancelled = true;
    if (timerId !== null) {
      clearTimeout(timerId);
    }
  };
}

/**
 * Lazily fetches and decompresses the Explorer-only C: directory skeleton
 * using browser-native gzip DecompressionStream, caching across instances.
 */
export async function loadFullWin11FsSkeleton(nodes: Record<string, ExpFsNode>): Promise<boolean> {
  if (typeof fetch !== 'function') {
    return false;
  }
  if (!cachedSkeletonTextPromise) {
    cachedSkeletonTextPromise = (async () => {
      try {
        const res = await fetch(EXPLORER_SKELETON_URL);
        if (!res.ok) return null;
        const bytes = new Uint8Array(await res.arrayBuffer());
        // If the server did not set Content-Encoding: gzip, decompress the raw gzip stream manually.
        if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b && typeof DecompressionStream === 'function') {
          const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
          return await new Response(stream).text();
        }
        return new TextDecoder('utf-8').decode(bytes);
      } catch {
        return null;
      }
    })();
  }
  const text = await cachedSkeletonTextPromise;
  if (!text) return false;
  return mergeWin11SkeletonText(nodes, text) > 0;
}
