import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync } from 'fflate';

const repoRoot = new URL('..', import.meta.url).pathname.replace(/^\//, '').replace(/\//g, '\\');
const source = join(repoRoot, 'public', 'wow-bundles', 'magic-tower', 'index.html');
const outDir = join(repoRoot, 'public', 'packages');
const outFile = join(outDir, 'magic-tower.wow');
const html = await readFile(source);
const manifest = JSON.stringify({
  format: 1,
  id: 'magic-tower',
  name: '两层迷宫演示',
  version: '1.0.1',
  description: 'WinOnWeb 自制的两层小游戏，支持键盘移动与本地存档。',
  icon: 'icon.svg',
  entry: 'index.html',
  runtime: 'iframe',
  permissions: ['fullscreen', 'pointer-lock'],
  window: { width: 1050, height: 760, minWidth: 700, minHeight: 560 },
}, null, 2);
await mkdir(outDir, { recursive: true });
const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#8065cf"/><path d="M17 51V20h30v31" fill="#29203f" stroke="#eadcff" stroke-width="3"/><path d="M13 20h38M22 20V12h20v8M27 29h10v10H27z" fill="none" stroke="#eadcff" stroke-width="3" stroke-linejoin="round"/><path d="M27 51V43h10v8" fill="#ffd56d"/></svg>';
const packed = zipSync({ 'index.html': html, 'manifest.json': Buffer.from(manifest), 'icon.svg': Buffer.from(icon) }, { level: 0 });
await writeFile(outFile, packed);
console.log(`Created ${outFile} (${packed.length} bytes)`);
