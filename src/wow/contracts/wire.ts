import type { Capability, HardwareSummary, WOW_PROTOCOL } from './index';
export type Theme = 'light' | 'dark';
export interface BootInfo {
  pid: number;
  wid: number;
  appId: string;
  instanceId: string;
  theme: Theme;
  volume: number;
  focused: boolean;
  minimized: boolean;
  launchArgs?: Record<string, unknown>;
}
export type Methods = {
  'fs.pickOpen': { extensions?: string[]; initialPath?: string };
  'fs.pickSave': { defaultFileName?: string; initialPath?: string };
  'fs.listDir': { path: string };
  'fs.readFile': { path: string };
  'fs.writeFile': { path: string; content: string };
  'storage.get': { key: string };
  'storage.set': { key: string; value: unknown };
  'storage.remove': { key: string };
  'storage.clear': {};
  'notify.show': { title: string; body?: string };
  'hw.getSnapshot': {};
  'hw.refresh': {};
  'shell.openFile': { path: string };
  'shell.openApp': { appId: string; args?: Record<string, unknown> };
  'window.title': { title: string };
  'window.control': { action: 'minimize' | 'maximize' | 'restore' | 'close' | 'focus' };
  'app.send': { instanceId: string; channel: string; payload?: unknown };
  'app.call': { instanceId: string; method: string; payload?: unknown };
  'app.event': { channel: string; payload?: unknown };
  'data.open': { instanceId: string };
};
export type Method = keyof Methods;
export const permissions: Record<Method, Capability | null> = {
  'fs.pickOpen': 'virtual-fs',
  'fs.pickSave': 'virtual-fs',
  'fs.listDir': 'virtual-fs',
  'fs.readFile': 'virtual-fs',
  'fs.writeFile': 'virtual-fs',
  'storage.get': null,
  'storage.set': null,
  'storage.remove': null,
  'storage.clear': null,
  'notify.show': 'notifications',
  'hw.getSnapshot': 'hardware-probe',
  'hw.refresh': 'hardware-probe',
  'shell.openFile': 'shell-control',
  'shell.openApp': 'shell-control',
  'window.title': 'window-control',
  'window.control': 'window-control',
  'app.send': 'app-messaging',
  'app.call': 'app-messaging',
  'app.event': 'app-messaging',
  'data.open': 'app-messaging',
};
export interface ClientEvents {
  init: BootInfo;
  theme: Theme;
  volume: number;
  focus: boolean;
  visibility: boolean;
  fullscreen: boolean;
  inputRelease: string;
  hardware: HardwareSummary;
  message: { channel: string; payload?: unknown; from?: string };
  data: { from: string };
}
export type WireBody =
  | { type: 'request'; id: string; method: string; params: unknown }
  | { type: 'response'; id: string; ok: true; value: unknown }
  | { type: 'response'; id: string; ok: false; error: { code: string; message: string } }
  | { type: 'cancel'; id: string }
  | { type: 'event'; name: string; value: unknown }
  | { type: 'disconnect' };
export type Envelope = WireBody & { protocol: typeof WOW_PROTOCOL };
