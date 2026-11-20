export const WOW_PROTOCOL = 'wow/v1' as const;
export const MAX_PENDING = 64;
export const ERROR = {
  invalid: 'INVALID_PARAMS',
  denied: 'PERMISSION_DENIED',
  missing: 'NOT_FOUND',
  busy: 'QUEUE_FULL',
  timeout: 'TIMEOUT',
  revoked: 'REVOKED',
  cancelled: 'CANCELLED',
  unknown: 'UNKNOWN_METHOD',
  failed: 'RPC_ERROR',
} as const;
export type Capability =
  | 'theme'
  | 'volume'
  | 'focus'
  | 'visibility'
  | 'hardware-probe'
  | 'virtual-fs'
  | 'notifications'
  | 'window-control'
  | 'shell-control'
  | 'app-messaging';
export type PermissionDecision = 'granted' | 'denied';
export type GrantRow = Partial<Record<Capability, PermissionDecision>>;
export interface PackageManifest {
  format: 1;
  id: string;
  name: string;
  version?: string;
  entry?: string;
  icon?: string;
  description?: string;
  permissions?: string[];
  requiresIsolation?: boolean;
  singleThreadEntry?: string;
  window?: { width?: number; height?: number; minWidth?: number; minHeight?: number };
}
export interface InstalledPackage {
  id: string;
  publisher: string;
  versionHash: string;
  manifest: PackageManifest;
  installedAt: string;
  size: number;
  fileCount: number;
}
export interface VersionRecord {
  id: string;
  versionHash: string;
  backend: 'opfs' | 'idb';
  state: 'staging' | 'verified';
}
export interface AppOriginBridge {
  originFor(id: string): string;
  activate(id: string): Promise<void>;
  writeVersion(
    id: string,
    versionHash: string,
    files: AsyncIterable<{ path: string; bytes: ArrayBuffer }>,
  ): Promise<void>;
  removeVersion(id: string, versionHash: string): Promise<void>;
}
export type Deployment = { mode: 'single-trusted' } | { mode: 'isolated'; bridge: AppOriginBridge };
export interface ProcessInfo {
  pid: number;
  appId: string;
  version?: string;
  views: readonly number[];
}
export interface ViewIdentity {
  pid: number;
  wid: number;
  instanceId: string;
}
export type InstanceId = string;
export interface FileResult {
  path: string;
  name: string;
  content: string;
  sizeBytes: number;
}
export interface DirectoryEntry {
  path: string;
  name: string;
  kind: string;
  writable: boolean;
  sizeBytes?: number;
}
export interface HardwareSummary {
  cpu: { shortName: string; logicalCores: number };
  memory: { totalGb: number };
}
export interface CleanupReport {
  pid: number;
  ports: number;
  workers: number;
  writers: number;
  handles: number;
  failures: string[];
}
export type WriteState = 'open' | 'committing' | 'committed' | 'aborted' | 'failed';
export interface VersionHandshake {
  protocol: typeof WOW_PROTOCOL;
  type: 'challenge' | 'hello' | 'connected';
  instanceId: InstanceId;
  generation: string;
}
export interface ResourceOwner {
  assertLive(): void;
  manage(kind: 'writers' | 'handles', close: () => void | Promise<void>): () => void;
}
export type { Method, Methods, BootInfo, Envelope, ClientEvents } from './wire';
