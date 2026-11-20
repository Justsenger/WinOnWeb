import type { OpenedAppRecord, WinAppManifest, WindowInstance } from '../../types';

export type TmTabId =
  | 'processes'
  | 'performance'
  | 'history'
  | 'startup'
  | 'users'
  | 'details'
  | 'services'
  | 'settings';

export type TmProcGroup = 'app' | 'bg' | 'win';
export type TmProcStatus = '' | 'efficiency' | 'suspended';
export type TmPriority = '实时' | '高' | '高于正常' | '正常' | '低于正常' | '低';
export type TmResourceDisplayMode = 'value' | 'percent';

export type TmProcColumnKey =
  | 'type'
  | 'status'
  | 'publisher'
  | 'pid'
  | 'processName'
  | 'commandLine'
  | 'cpu'
  | 'mem'
  | 'disk'
  | 'net'
  | 'gpu'
  | 'gpuEngine'
  | 'npu'
  | 'npuEngine'
  | 'powerUsage'
  | 'powerTrend'
  | 'isolation';

export interface TmProcessNode {
  id: string;
  pid: number;
  name: string;
  processName: string;
  commandLine: string;
  publisher: string;
  group: TmProcGroup;
  status: TmProcStatus;
  cpu: number;
  memMb: number;
  diskMbS: number;
  netMbps: number;
  gpuPct: number;
  gpuEngine: string;
  npuPct: number;
  npuEngine: string;
  powerUsage: '极低' | '低' | '中' | '高';
  powerTrend: '极低' | '低' | '中' | '高';
  isolation: string;
  arch: 'x64' | 'ARM64' | 'x86' | '—';
  user: string;
  desc: string;
  priority: TmPriority;
  serviceNames?: string[];
  appId?: string;
  iconKey?: string;
  uacVirt?: '已禁用' | '已启用' | '不允许';
  filePath: string;
  children?: TmProcessNode[];
}

export interface TmAppHistoryRow extends OpenedAppRecord {
  isSystemProcess?: boolean;
}

export interface TmStartupRow {
  id: string;
  name: string;
  publisher: string;
  status: '已启用' | '已禁用';
  impact: '高' | '中' | '低' | '无' | '未计量';
  filePath: string;
  children?: { id: string; name: string; status: '已启用' | '已禁用'; impact: '低' | '无' }[];
}

export interface TmServiceRow {
  name: string;
  pid: number | null;
  desc: string;
  status: '正在运行' | '已停止';
  group: string;
}

export interface TmProcColumnDef {
  key: TmProcColumnKey;
  label: string;
  headerMetric?: string;
  numeric?: boolean;
  widthPx: number;
  defaultVisible: boolean;
  hasResourceMode?: boolean;
}

export const TM_PROC_COLUMNS: readonly TmProcColumnDef[] = [
  { key: 'type', label: '类型', widthPx: 96, defaultVisible: false },
  { key: 'status', label: '状态', widthPx: 120, defaultVisible: true },
  { key: 'publisher', label: '发布者', widthPx: 148, defaultVisible: false },
  { key: 'pid', label: 'PID', numeric: true, widthPx: 72, defaultVisible: false },
  { key: 'processName', label: '进程名称', widthPx: 146, defaultVisible: false },
  { key: 'commandLine', label: '命令行', widthPx: 210, defaultVisible: false },
  { key: 'cpu', label: 'CPU', numeric: true, widthPx: 73, defaultVisible: true },
  { key: 'mem', label: '内存', numeric: true, widthPx: 73, defaultVisible: true, hasResourceMode: true },
  { key: 'disk', label: '磁盘', numeric: true, widthPx: 73, defaultVisible: true, hasResourceMode: true },
  { key: 'net', label: '网络', numeric: true, widthPx: 73, defaultVisible: true, hasResourceMode: true },
  { key: 'gpu', label: 'GPU', numeric: true, widthPx: 84, defaultVisible: false },
  { key: 'gpuEngine', label: 'GPU 引擎', widthPx: 130, defaultVisible: false },
  { key: 'npu', label: 'NPU', numeric: true, widthPx: 84, defaultVisible: false },
  { key: 'npuEngine', label: 'NPU 引擎', widthPx: 130, defaultVisible: false },
  { key: 'powerUsage', label: '电源使用情况', widthPx: 102, defaultVisible: false },
  { key: 'powerTrend', label: '电源使用情况趋势', widthPx: 118, defaultVisible: false },
  { key: 'isolation', label: '隔离', widthPx: 84, defaultVisible: false },
];

export const TM_GROUP_META: readonly { id: TmProcGroup; title: string }[] = [
  { id: 'app', title: '应用' },
  { id: 'bg', title: '后台进程' },
  { id: 'win', title: 'Windows 进程' },
];

export function syncWindowsToProcesses(
  previous: readonly TmProcessNode[],
  windows: readonly Pick<WindowInstance,'pid'|'appId'|'title'|'iconKey'>[],
  getManifest: (appId: string) => WinAppManifest | undefined,
): TmProcessNode[] {
  // PID 1 represents the WoW desktop shell. Window PIDs are allocated by the shell store.
  const entries = [{ pid: 1, appId: 'explorer', title: 'Windows 资源管理器', iconKey: 'explorer' }, ...new Map(windows.map(w=>[w.pid,w])).values()];
  return entries.map((entry): TmProcessNode => {
    const shell = entry.pid === 1;
    const manifest = getManifest(entry.appId);
    const prior = previous.find(row => row.pid === entry.pid);
    return {
      id: shell ? 'shell' : 'win-' + entry.pid, pid: entry.pid, group: shell ? 'win' : 'app',
      name: entry.title, processName: shell ? 'explorer' : entry.appId,
      appId: shell ? undefined : entry.appId, iconKey: entry.iconKey,
      publisher: manifest?.telemetry?.publisher ?? '', desc: manifest?.description ?? entry.title,
      user: 'admin', commandLine: '', filePath: '', arch: '—',
      status: prior?.status ?? '', priority: prior?.priority ?? '正常',
      cpu: 0, memMb: 0, diskMbS: 0, netMbps: 0, gpuPct: 0, gpuEngine: '',
      npuPct: 0, npuEngine: '', powerUsage: '极低', powerTrend: '极低', isolation: '—',
    };
  });
}

export function formatCpuTime(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatMemMb(mb: number, mode: TmResourceDisplayMode, totalMb: number): string {
  if (mode === 'percent') {
    const pct = totalMb > 0 ? (mb / totalMb) * 100 : 0;
    return `${pct.toFixed(1)}%`;
  }
  return `${mb.toFixed(1)} MB`;
}

export function formatMemKb(mb: number): string {
  const kb = Math.max(64, Math.round(mb * 1024));
  return `${kb.toLocaleString('en-US')} K`;
}

export function getHeatClass(ratio01: number): string {
  if (ratio01 >= 0.45) return 'is-heat-3';
  if (ratio01 >= 0.16) return 'is-heat-2';
  if (ratio01 >= 0.03) return 'is-heat-1';
  return 'is-heat-0';
}
