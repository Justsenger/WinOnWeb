import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';

const repoRoot = new URL('..', import.meta.url).pathname.replace(/^\//, '').replace(/\//g, '\\');
const bundleRoot = join(repoRoot, 'work', 'SurvivalcraftApi', 'Survivalcraft.Browser', 'bin', 'Release', 'net10.0', 'browser-wasm', 'AppBundle');
const outputDir = join(repoRoot, 'public', 'packages');
const outputFile = join(outputDir, 'survivalcraft-api.wow');

async function collect(dir, result = {}) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (dir === bundleRoot && entry.name === '_framework') continue;
    if (entry.isDirectory()) await collect(path, result);
    else result[relative(bundleRoot, path).replaceAll('\\', '/')] = await readFile(path);
  }
  return result;
}

const files = await collect(bundleRoot);
// Use the same precompiled game runtime as the browser release. The development
// AppBundle also contains a playable interpreter build, with much lower frame rates.
const cacheDir = join(repoRoot, 'work', 'survivalcraft-aot-source');
await mkdir(cacheDir, { recursive: true });
const scriptHashes = {
  'dotnet.boot.js': '47b52b7edefd78f864427674d1edb37ba6eaafac4c8b5e0110c57e2ef6d62943',
  'dotnet.js': 'e483d6c5698014bb05ec1044efa06e7698f652608f59a02cb75ef7687860d912',
  'dotnet.native.js': '34859c26e6567237b932c35994c2d1869b76176230a345b72deaf0f0a1dfbfa2',
  'dotnet.native.worker.mjs': '1047d62add0c6f08e646c6afd89b71012156aae12fbbcb64976fb718478c95a5',
  'dotnet.runtime.js': '7f10f1ce419911a73c0dea01b27dd6f803b41b4a95e69271785e65cda10ddbef',
};
async function frameworkAsset(name, hash) {
  const path = join(cacheDir, name);
  const cached = await readFile(path).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  if (cached && digest(cached) === hash) return cached;
  const response = await fetch('https://scapiweb.netlify.app/_framework/' + name, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error('Download failed for ' + name + ': ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== hash) throw new Error('Release checksum mismatch for ' + name);
  await writeFile(path, bytes);
  return bytes;
}
const boot = await frameworkAsset('dotnet.boot.js', scriptHashes['dotnet.boot.js']);
const { resources } = JSON.parse(boot.toString().split('/*json-start*/')[1].split('/*json-end*/')[0]);
files['_framework/dotnet.boot.js'] = boot;
files['_framework/dotnet.js'] = await frameworkAsset('dotnet.js', scriptHashes['dotnet.js']);
for (const group of Object.values(resources).filter(Array.isArray)) {
  for (const { name, hash } of group) {
    const digest = hash ? Buffer.from(hash.slice('sha256-'.length), 'base64').toString('hex') : scriptHashes[name];
    files['_framework/' + name] = await frameworkAsset(name, digest);
  }
}

const mainPath = 'main.js';
const mainText = files[mainPath].toString('utf8');
files[mainPath] = Buffer.from(mainText.replace(/if \("serviceWorker" in globalThis\.navigator\) \{[\s\S]*?\n\}/, '// WinOnWeb owns the WOW service worker for this packaged app.'));
files['manifest.json'] = Buffer.from(JSON.stringify({
  format: 1,
  id: 'survivalcraft-api',
  name: '生存战争 API 网页版',
  version: '1.9.5-aot',
  description: 'SC-SPM SurvivalcraftApi 浏览器版，作为 WinOnWeb WOW 应用运行。',
  icon: 'favicon.webp',
  entry: 'index.html',
  runtime: 'iframe',
  permissions: ['fullscreen', 'gamepad', 'pointer-lock'],
  window: { width: 1280, height: 760, minWidth: 900, minHeight: 560 },
}, null, 2));

await mkdir(outputDir, { recursive: true });
const packed = zipSync(files, { level: 0 });
await writeFile(outputFile, packed);
console.log(`Created ${outputFile} (${packed.length} bytes, ${Object.keys(files).length} files)`);

