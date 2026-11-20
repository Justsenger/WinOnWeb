import { configureDeployment } from '../../wow/hal/vhost';
import { subdomainBridge } from '../../wow/hal/origin-bridge';
import type { WinAppManifest } from './types';

export interface WinDesktopShortcutSpec {
  file: string;
  type?: string;
  size?: number;
  icon: string;
}

export interface WinDesktopStartupSpec {
  id: string;
  name: string;
  publisher: string;
  status: '已启用' | '已禁用';
  impact: '高' | '中' | '低' | '无';
  filePath: string;
}

export interface WinDesktopHostConfig {
  deployment?: {mode:'single-trusted'} | {mode:'isolated';appDomain:string};
  /** 虚拟计算机名称（例如资源管理器安全页显示的主机名，默认 WINONWEB-PC） */
  machineName?: string;
  /** 宿主注入的额外应用清单 */
  apps?: WinAppManifest[];
  /** 宿主注入的应用图标映射（key -> 图片 URL） */
  icons?: Record<string, string>;
  /** 虚拟文件系统「桌面」文件夹里的宿主快捷方式 */
  desktopShortcuts?: WinDesktopShortcutSpec[];
  /** 任务管理器「启动应用」里的宿主条目 */
  startupItems?: WinDesktopStartupSpec[];
  /** 桌面加载完成后自动打开的应用 ID（默认为 null，不强制打开外部应用） */
  bootAppId?: string | null;
}

let activeHostConfig: WinDesktopHostConfig = {};

export function configureWinDesktopHost(config: WinDesktopHostConfig): void {
  activeHostConfig = { ...config };
  if(config.deployment) configureDeployment(config.deployment.mode==='isolated' ?
    {mode:'isolated',bridge:subdomainBridge(config.deployment.appDomain)} : config.deployment);
}

export function getWinDesktopHostConfig(): WinDesktopHostConfig {
  return activeHostConfig;
}
