import type { InstalledPackage, VersionRecord, Capability } from '../../../wow/contracts';
import { getRecord, readContent } from '../../../wow/hal/storage';
import { versionUrl } from '../../../wow/hal/vhost';
import type { WinAppManifest } from '../types';

const optionalCaps: Capability[] = [
  'hardware-probe',
  'virtual-fs',
  'notifications',
  'shell-control',
  'app-messaging',
];
export function packageApp(record: InstalledPackage): WinAppManifest {
  const { manifest: pack, id, versionHash } = record;
  return {
    id,
    name: pack.name,
    description: pack.description ?? pack.name,
    category: 'game',
    runtime: 'iframe',
    source: 'user',
    onDesktop: true,
    pinnedToStart: true,
    singleton: false,
    iconKey: pack.icon ? 'wow:' + id + ':' + versionHash + ':' + pack.icon : 'app-store',
    packageVersion: versionHash,
    window: {
      defaultWidth: pack.window?.width ?? 1100,
      defaultHeight: pack.window?.height ?? 700,
      minWidth: pack.window?.minWidth ?? 800,
      minHeight: pack.window?.minHeight ?? 520,
      fullscreen: true,
    },
    iframe: {
      entryUrl: versionUrl(id, versionHash, pack.entry ?? 'index.html'),
      requiresIsolation: pack.requiresIsolation,
      singleThreadUrl: pack.singleThreadEntry && versionUrl(id, versionHash, pack.singleThreadEntry),
      allow: 'fullscreen; gamepad; autoplay; cross-origin-isolated',
      passShellQuery: false,
    },
    capabilities: [
      'theme',
      'volume',
      'focus',
      'visibility',
      'window-control',
      ...optionalCaps.filter((c) => pack.permissions?.includes(c)),
    ],
    telemetry: {
      publisher: record.publisher === 'official' ? 'WOW 应用商店' : '本地侧载',
      version: pack.version,
      estimatedMemMb: 180,
    },
  };
}
export async function getWowIconUrl(id: string, versionHash: string, path: string) {
  const version = await getRecord<VersionRecord>('versions', [id, versionHash]);
  if (version?.state !== 'verified') throw Error('应用版本不可用');
  const blob = await readContent(version, path);
  const ext = path.split('.').pop()?.toLowerCase();
  return URL.createObjectURL(blob.slice(0, blob.size, 'image/' + (ext === 'svg' ? 'svg+xml' : ext)));
}
