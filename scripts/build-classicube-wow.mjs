import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'work', 'classicube-source');
const output = join(root, 'public', 'packages');
const runtime = await readFile(join(source, 'ClassiCube.js'), 'utf8');
const defaultPath = "'/static/default.zip'";
if (!runtime.includes(defaultPath)) throw new Error('ClassiCube texture loader has changed');
const manifest = {
  format: 1, id: 'classicube', name: 'ClassiCube 网页版', version: '1.0.0',
  description: '在单人世界中建造、保存与载入地图。', entry: 'index.html',
  icon: 'icon.png', runtime: 'iframe', permissions: ['fullscreen', 'pointer-lock'],
  window: { width: 1140, height: 730, minWidth: 640, minHeight: 420 }
};

const files = {
  'manifest.json': Buffer.from(JSON.stringify(manifest, null, 2)),
  'index.html': await readFile(join(root, 'wow-packages/classicube/index.html')),
  'classicube.js': Buffer.from(runtime.replace(defaultPath, "'./default.zip'")),
  'default.zip': await readFile(join(source, 'default.zip')),
  'icon.png': await readFile(join(root, 'wow-packages/classicube/icon.png')),
  'LICENSE.txt': await readFile(join(source, 'LICENSE.txt')),
  'SOURCES.txt': await readFile(join(source, 'SOURCES.txt'))
};
await mkdir(output, { recursive: true });
await writeFile(join(output, 'classicube.wow'), zipSync(files, { level: 6 }));
console.log('Packaged ClassiCube');
