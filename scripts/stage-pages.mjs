import { cp, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeGameCatalog } from './write-game-catalog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const cache = path.join(root, '.cache');
const output = path.join(cache, 'pages');
const catalog = JSON.parse(await readFile(new URL('../wow-packages/catalog.json', import.meta.url), 'utf8'));
const omitted = new Set([
  'survivalcraft-api', 'magic-tower', 'cf-lite', 'ouro-lite', 'freeserf-lite', 'hexgl-lite', 'arcade-mini',
  ...catalog.filter(game => game.localOnly).map(game => game.id)
].map(id => path.join(dist, 'packages', id + '.wow')));
omitted.add(path.join(dist, 'wow-bundles', 'magic-tower'));
await mkdir(cache, { recursive: true });
const stage = await mkdtemp(path.join(cache, 'pages-stage-'));
try {
  await cp(dist, stage, {
    recursive: true,
    filter: source => !omitted.has(source),
  });
  await writeGameCatalog(pathToFileURL(path.join(stage, 'packages') + path.sep), true);
  await rm(output, { recursive: true, force: true });
  await rename(stage, output);
} finally {
  await rm(stage, { recursive: true, force: true });
}
