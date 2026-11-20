import { appStoreApp } from './app-store-app';
import { APP_COMMANDS } from './commands';
import { explorerApp } from './explorer';
import { mountIframeApp } from './iframe-host';
import { notepadApp } from './notepad-app';
import { placeholderApp } from './placeholder-app';
import { settingsApp } from './settings-app';
import { storageLabApp } from './storage-lab-app';
import { taskManagerApp } from './task-manager';
import type {
  WinAppHostContext,
  WinAppHostHooks,
  WinAppLifecycle,
  WinAppModule,
  WinAppShellApi,
  WinAppLaunchArgs,
} from '../types';

const BUILTIN_APP_MODULES: Record<string, WinAppModule> = {
  'this-pc': explorerApp,
  explorer: explorerApp,
  'task-manager': taskManagerApp,
  settings: settingsApp,
  'storage-lab': storageLabApp,
  notepad: notepadApp,
  'app-store': appStoreApp,
};

export function executeCommandApp(
  appId: string,
  shell: WinAppShellApi,
  args?: WinAppLaunchArgs,
): boolean {
  const handler = APP_COMMANDS[appId];
  if (!handler) return false;
  handler(shell, args);
  return true;
}

export function mountAppInstance(
  ctx: WinAppHostContext,
  hooks: WinAppHostHooks = {},
): WinAppLifecycle {
  const manifest = ctx.manifest ?? ctx.shell.getAppManifest(ctx.appId);
  if (!manifest) {
    return placeholderApp.mount(ctx) ?? {};
  }

  if (manifest.runtime === 'iframe') {
    return mountIframeApp(ctx, hooks);
  }

  const mod = BUILTIN_APP_MODULES[manifest.id] ?? placeholderApp;
  return mod.mount(ctx) ?? {};
}
