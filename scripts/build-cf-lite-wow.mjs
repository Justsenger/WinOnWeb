import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync } from 'fflate';

const repoRoot = new URL('..', import.meta.url).pathname.replace(/^\//, '').replace(/\//g, '\\');
const source = join(repoRoot, 'wow-packages', 'cf-lite', 'index.html');
const outputDir = join(repoRoot, 'public', 'packages');
const output = join(outputDir, 'cf-lite.wow');
const html = await readFile(source);
const files = {
  'index.html': html,
  'icon.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#b73838"/><path d="M14 18h36v28H14z" fill="#2d1117"/><path d="M20 24h24M20 32h18M20 40h12" stroke="#ffd9cf" stroke-width="4" stroke-linecap="round"/><circle cx="46" cy="40" r="7" fill="#ffcc66"/></svg>'),
  'manifest.json': Buffer.from(JSON.stringify({
    format: 1,
    id: 'cf-lite',
    name: '战术射击训练场',
    version: '1.0.0',
    description: '无外部资源的轻量第一人称射击训练场，支持 WASD、鼠标锁定与目标射击。',
    icon: 'icon.svg',
    entry: 'index.html',
    runtime: 'iframe',
    permissions: ['fullscreen', 'pointer-lock'],
    window: { width: 1100, height: 700, minWidth: 720, minHeight: 480 },
  }, null, 2)),
};
await mkdir(outputDir, { recursive: true });
const packed = zipSync(files, { level: 0 });
await writeFile(output, packed);
console.log(`Created ${output} (${packed.length} bytes)`);
