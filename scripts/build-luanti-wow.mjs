import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { zipSync, unzipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'work/luanti-source');
const frontend = resolve(root, 'wow-packages/luanti');
const files = {};
for (const name of ['index.html', 'launcher.js', 'manifest.json']) files[name] = await readFile(resolve(frontend, name));
for (const name of ['luanti.wasm', 'luanti.js', 'luanti.zip', 'minetest-game.zip','LICENSE.txt','SOURCES.txt','build.sh','luanti.diff','webport.diff']) files[name] = await readFile(resolve(source, name));
files['icon.png'] = unzipSync(files['luanti.zip'], {filter: f => f.name === 'textures/base/pack/logo.png'})['textures/base/pack/logo.png'];
files['fflate.js'] = await readFile(resolve(root, 'node_modules/fflate/umd/index.js'));
files['fflate-LICENSE'] = await readFile(resolve(root, 'node_modules/fflate/LICENSE'));
const out = resolve(root, 'public/packages');
await mkdir(out, {recursive: true});
const packed = zipSync(files, {level: 1});
await writeFile(resolve(out, 'luanti.wow'), packed);
console.log('Luanti WOW:', packed.byteLength, 'bytes');

