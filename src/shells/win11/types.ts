import type { Capability, PermissionDecision, CleanupReport } from '../../wow/contracts';
import type { RuntimeFileHandle, RuntimeScope } from '../../wow/hal/runtime-primitives';
import type { WinDesktopShortcutSpec, WinDesktopStartupSpec } from './host-config';
export type { WinDesktopShortcutSpec, WinDesktopStartupSpec };
import type { DeviceProbeReport, StorageProbeInfo } from '../../wow/hal/capabilities';
import type { VirtualHardwareSnapshot } from '../../wow/hal/hardware';
import type { VfsEntryInfo, VirtualStorageService } from './system/virtual-storage';
export type { VfsEntryInfo };

export type ThemeMode = 'dark' | 'light';

export type DesktopIconSize = 'large' | 'medium' | 'small';

export type DesktopSortMode = 'default' | 'name';

export type ActiveFlyout = 'none' | 'start' | 'quickSettings' | 'calendar' | 'trayOverflow';

export type SnapZone = 'none' | 'maximize' | 'left' | 'right';

export type WinAppRuntime = 'builtin' | 'iframe' | 'command';

export type WinAppCategory = 'system' | 'app' | 'utility' | 'game';

export type WinAppCapability = Capability;
export type WinPermissionDecision = PermissionDecision;

export interface PickedFileResult {
  path: string;
  name: string;
  content: string;
  sizeBytes: number;
}

export interface PickedSaveTarget {
  path: string;
  name: string;
}

export interface WinNotificationSpec {
  title: string;
  body?: string;
}

export type WinAppLaunchArgs = Record<string, unknown>;

export interface WinAppWindowSpec {
  fullscreen?: boolean;
  defaultWidth?: number;
  defaultHeight?: number;
  /** 初次打开时的工作区坐标，缺省仍然居中级联。 */
  defaultX?: number;
  defaultY?: number;
  /** 应用首次打开时占满桌面工作区。窗口仍可通过标题栏按钮还原。 */
  startMaximized?: boolean;
  minWidth?: number;
  minHeight?: number;
  resizable?: boolean;
  maximizable?: boolean;
  /**
   * 若应用自身直接延展 WinUI 3 Mica 背景，外壳标题栏取消底部分割线并无缝对齐其底色。
   */
  seamlessTitlebar?: boolean;
  /**
   * 窗口主体背景色（例如在游戏或深色应用加载前避免白屏闪烁）。
   */
  background?: string;
}

export interface WinAppIframeSpec {
  requiresIsolation?: boolean;
  singleThreadUrl?: string;
  /**
   * 同源路径（如 `/apps/custom/`）或可嵌入 HTTPS URL。
   */
  entryUrl: string;
  /**
   * iframe `allow` 权限声明（如 `autoplay; fullscreen; gamepad`）。
   */
  allow?: string;
  /**
   * 可选 iframe `sandbox` 属性；托管外部站点时建议显式配置。
   */
  sandbox?: string;
  /**
   * 为同源路径自动附带 `?theme=...&volume=...&appId=...&pid=...` 初始查询参数（默认 true）。
   */
  passShellQuery?: boolean;
}

export interface WinAppTelemetrySpec {
  publisher?: string;
  version?: string;
  /**
   * 任务管理器估算内存占用基线（MB）。
   */
  estimatedMemMb?: number;
}

export interface WinAppManifest {
  packageVersion?: string;
  backgroundProcess?: boolean;
  id: string;
  name: string;
  iconKey: string;
  description: string;
  category: WinAppCategory;
  runtime: WinAppRuntime;
  onDesktop?: boolean;
  pinnedToStart?: boolean;
  pinnedToTaskbar?: boolean;
  /**
   * 默认 `true`（单实例聚焦）；设为 `false` 时允许同时开启多个窗口实例。
   */
  singleton?: boolean;
  window?: WinAppWindowSpec;
  iframe?: WinAppIframeSpec;
  telemetry?: WinAppTelemetrySpec;
  capabilities?: readonly WinAppCapability[];
  /** 系统内置核心工具免除首次弹窗授权（仍可在权限管理中手动撤回） */
  systemTrusted?: boolean;
  /** 声明默认可关联打开的文件后缀（如 ['.txt', '.md']） */
  supportedExtensions?: readonly string[];
  /** 应用来源 */
  source?: 'core' | 'host' | 'user';
  /**
   * 可选运行时动态标题（如“全屏体验 / 退出全屏”）。
   */
  getDynamicLabel?: (ctx: { isFullscreen: boolean }) => string;
}

export interface WindowInstance {
  wid:number;
  instanceId:string;
  pid: number;
  appId: string;
  title: string;
  iconKey: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  resizable: boolean;
  maximizable: boolean;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  restoreBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  seamlessTitlebar?: boolean;
  background?: string;
  launchArgs?: WinAppLaunchArgs;
}

export interface DesktopIconPosition {
  col: number;
  row: number;
}

export interface OpenedAppRecord {
  id: string;
  name: string;
  iconKey: string;
  publisher: string;
}

export interface WinAppShellApi {
  getTheme(): ThemeMode;
  setTheme(theme: ThemeMode): void;
  getVolume(): number;
  setVolume(volume: number): void;
  getBrightness(): number;
  setBrightness(brightness: number): void;
  getIconSize(): DesktopIconSize;
  setIconSize(size: DesktopIconSize): void;
  resetDesktopLayout(): void;
  getMachineName(): string;
  getHostBootAppId(): string | null;
  getStartupHostItems(): readonly WinDesktopStartupSpec[];
  getInstalledApps(): readonly WinAppManifest[];
  getAppManifest(appId: string): WinAppManifest | undefined;
  renderAppIcon(iconKey: string, size?: number): string;
  getAppUsageHistory(): { since: number; apps: readonly OpenedAppRecord[] };
  clearAppUsageHistory(): void;
  getWindows(): readonly WindowInstance[];
  openApp(appId: string, args?: WinAppLaunchArgs): number | null;
  getProcesses(): {pid:number;appId:string;views:number[]}[];
  terminateProcess(pid:number):Promise<CleanupReport>;
  closeWindow(pid: number): void;
  focusWindow(pid: number): void;
  minimizeWindow(pid: number): void;
  toggleMaximizeWindow(pid: number): void;
  setWindowTitle(pid: number, title: string): void;
  isFullscreen(): boolean;
  toggleFullscreen(): void;
  getVirtualStorage(): VirtualStorageService;
  getVirtualHardware(): VirtualHardwareSnapshot;
  refreshVirtualHardware(force?: boolean): Promise<VirtualHardwareSnapshot>;
  refreshVirtualStorage(): Promise<StorageProbeInfo>;
  getHardwareReport(): DeviceProbeReport | null;
  refreshHardwareReport(force?: boolean): Promise<DeviceProbeReport>;
  openFile(path: string): Promise<number | null>;
  listVirtualDirectory(path: string): Promise<VfsEntryInfo[]>;
  openVirtualFile(path: string): Promise<RuntimeFileHandle>;
  readVirtualFile(path: string): Promise<PickedFileResult>;
  writeVirtualFile(path: string, content: string, signal?:AbortSignal): Promise<{ path: string; name: string; sizeBytes: number }>;
  showOpenFileDialog(opts?: { extensions?: string[]; initialPath?: string },signal?:AbortSignal): Promise<PickedFileResult | null>;
  showSaveFileDialog(opts?: { defaultFileName?: string; initialPath?: string },signal?:AbortSignal): Promise<PickedSaveTarget | null>;
  getAppData<T = unknown>(key: string): T | undefined;
  setAppData(key: string, value: unknown): void;
  removeAppData(key: string): void;
  clearAppData(): void;
  showNotification(spec: WinNotificationSpec): Promise<boolean>;
  sendToApp(targetInstanceId: string, channel: string, payload?: unknown): Promise<boolean>;
  callApp(targetInstanceId: string, method: string, payload?: unknown, timeoutMs?: number, signal?:AbortSignal): Promise<unknown>;
  ensurePermission(capability: WinAppCapability): Promise<boolean>;
  listPermissionGrants(): Record<string, Partial<Record<WinAppCapability, WinPermissionDecision>>>;
  setPermissionDecision(appId: string, capability: WinAppCapability, decision: WinPermissionDecision | null): Promise<void>;
  installUserApp(manifest: WinAppManifest): Promise<string>;
  uninstallUserApp(appId: string): Promise<boolean>;
  getFileAssociations(): Record<string, string>;
  setFileAssociation(ext: string, appId: string): void;
  subscribeRegistry(listener: () => void): () => void;
}

export interface WinAppHostContext {
  wid:number;
  instanceId:string;
  resources: RuntimeScope;
  pid: number;
  appId: string;
  manifest: WinAppManifest;
  container: HTMLElement;
  launchArgs?: WinAppLaunchArgs;
  shell: WinAppShellApi;
}

export interface WinAppLifecycle {
  onFullscreenChange?: (active:boolean)=>void;
  onInputRelease?: (reason:string)=>void;
  onDataPort?: (port:MessagePort,from:string)=>void;
  onThemeChange?: (theme: ThemeMode) => void;
  onVolumeChange?: (volume: number) => void;
  onFocusChange?: (focused: boolean) => void;
  onVisibilityChange?: (minimized: boolean) => void;
  onWindowsChanged?: () => void;
  onShellPrefsChange?: () => void;
  onHardwareUpdate?: (snapshot: VirtualHardwareSnapshot) => void;
  onHardwareReport?: (report: DeviceProbeReport) => void;
  onMessage?: (channel: string, payload: unknown, fromAppId?: string) => void;
  onAppRequest?: (method: string, payload: unknown, fromInstanceId: string,signal?:AbortSignal) => unknown | Promise<unknown>;
  destroy?: () => void;
}

export interface WinAppModule {
  mount(ctx: WinAppHostContext): WinAppLifecycle | void;
}

export type WinCommandHandler = (shell: WinAppShellApi, args?: WinAppLaunchArgs) => void;

export interface WinAppHostHooks {
  setFullscreen?:(active:boolean)=>void;
  releaseInput?:()=>void;
  isFocused?:()=>boolean;
  ownPort?:(close:()=>void)=>()=>void;
  connectData?:(instanceId:string,port:MessagePort)=>void;
  onAppEvent?: (appId: string, pid: number, channel: string, payload: unknown) => void;
}

export function hasAppCapability(
  manifest: WinAppManifest | undefined,
  capability: WinAppCapability,
): boolean {
  return Boolean(manifest?.capabilities?.includes(capability));
}
