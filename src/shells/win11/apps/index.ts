import { mountBuiltin } from '../../../wow/runtime/builtin-runtime';
import { runCommand } from '../../../wow/runtime/command-runtime';
import { appStoreApp } from './app-store-app';
import { APP_COMMANDS } from './commands';
import { explorerApp } from './explorer';
import { mountIframeApp } from '../../../wow/runtime/iframe-runtime';
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

export function executeCommandApp(appId: string, shell: WinAppShellApi, args?: WinAppLaunchArgs): boolean {
  const handler = APP_COMMANDS[appId];
  return runCommand(handler, shell, args);
}

export function mountAppInstance(ctx: WinAppHostContext, hooks: WinAppHostHooks = {}): WinAppLifecycle {
  const manifest = ctx.manifest ?? ctx.shell.getAppManifest(ctx.appId);
  if (!manifest) {
    return placeholderApp.mount(ctx) ?? {};
  }

  if (manifest.runtime === 'iframe') {
    const { shell, appId, pid, wid, instanceId } = ctx;
    const spec = manifest.iframe!;
    return mountIframeApp({
      ...spec,
      passQuery: spec.passShellQuery !== false,
      container: ctx.container,
      title: manifest.name,
      className: 'w11-win-iframe',
      packageVersion: manifest.packageVersion,
      authorize: shell.ensurePermission,
      observeGuest: ctx.resources.observeGuest,
      ownPort: hooks.ownPort!,
      releaseInput: () => hooks.releaseInput?.(),
      setFullscreen: hooks.setFullscreen,
      boot: () => {
        const view = shell.getWindows().find((w) => w.wid === wid);
        return {
          appId,
          pid,
          wid,
          instanceId,
          theme: shell.getTheme(),
          volume: shell.getVolume(),
          focused: hooks.isFocused?.() ?? false,
          minimized: view?.minimized ?? false,
          launchArgs: ctx.launchArgs,
        };
      },
      methods: {
        'fs.pickOpen': (p, _, signal) => shell.showOpenFileDialog(p, signal),
        'fs.pickSave': (p, _, signal) => shell.showSaveFileDialog(p, signal),
        'fs.listDir': (p) => shell.listVirtualDirectory(p.path),
        'fs.readFile': (p) => shell.readVirtualFile(p.path),
        'fs.writeFile': (p, _, signal) => shell.writeVirtualFile(p.path, p.content, signal),
        'storage.get': (p) => shell.getAppData(p.key),
        'storage.set': (p) => shell.setAppData(p.key, p.value),
        'storage.remove': (p) => shell.removeAppData(p.key),
        'storage.clear': () => shell.clearAppData(),
        'notify.show': (p) => shell.showNotification(p),
        'hw.getSnapshot': () => shell.getVirtualHardware(),
        'hw.refresh': () => shell.refreshVirtualHardware(true),
        'window.title': (p) => shell.setWindowTitle(wid, p.title),
        'window.control': ({ action }) => {
          const view = shell.getWindows().find((w) => w.wid === wid);
          if (action === 'close') shell.closeWindow(wid);
          if (action === 'minimize') shell.minimizeWindow(wid);
          if (action === 'focus') shell.focusWindow(wid);
          if ((action === 'maximize' && !view?.maximized) || (action === 'restore' && view?.maximized))
            shell.toggleMaximizeWindow(wid);
        },
        'shell.openFile': (p) => shell.openFile(p.path),
        'shell.openApp': (p) => {
          const target = shell.openApp(p.appId, p.args);
          return shell.getWindows().find((w) => w.wid === target)?.instanceId ?? null;
        },
        'app.send': (p) => shell.sendToApp(p.instanceId, p.channel, p.payload),
        'app.call': (p, _, signal) => shell.callApp(p.instanceId, p.method, p.payload, undefined, signal),
        'app.event': (p) => hooks.onAppEvent?.(appId, pid, p.channel, p.payload),
        'data.open': (p, ports) => hooks.connectData?.(p.instanceId, ports[0]),
      },
    });
  }

  const mod = BUILTIN_APP_MODULES[manifest.id] ?? placeholderApp;
  return mountBuiltin(mod, ctx) ?? {};
}
