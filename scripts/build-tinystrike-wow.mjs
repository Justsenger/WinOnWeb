import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { setGlobalProxyFromEnv } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = join(root, 'wow-packages', 'tinystrike');
const lock = JSON.parse(await readFile(join(local, 'sources.lock.json'), 'utf8'));
const cache = join(tmpdir(), 'winonweb-source-cache', 'tinystrike');
const files = {};
setGlobalProxyFromEnv();
await mkdir(cache, { recursive: true });

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function verifiedFile(url, expected) {
  const filename = join(cache, expected);
  const cached = await readFile(filename).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (cached && sha256(cached) === expected) return cached;

  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(url + ' HTTP ' + response.status);
      data = Buffer.from(await response.arrayBuffer());
      break;
    } catch (error) {
      if (attempt === 2) throw new Error('Could not download ' + url, { cause: error });
    }
  }
  if (sha256(data) !== expected) throw new Error('SHA-256 mismatch for ' + url);
  const temp = filename + '.' + process.pid + '.tmp';
  try {
    await writeFile(temp, data);
    await rename(temp, filename);
  } finally {
    await rm(temp, { force: true });
  }
  return data;
}

const sources = [];
for (const [file, hash] of Object.entries(lock.game)) {
  sources.push({ file, hash, url: 'https://raw.githubusercontent.com/guyz/tinystrike/' + lock.commit + '/' + file });
}
for (const [sourcePath, hash] of Object.entries(lock.three)) {
  sources.push({
    file: 'vendor/three/' + sourcePath,
    hash,
    url: 'https://cdn.jsdelivr.net/npm/three@' + lock.threeVersion + '/' + sourcePath,
  });
}
const pending = sources.values();
async function fetchWorker() {
  for (const { file, hash, url } of pending) files[file] = await verifiedFile(url, hash);
}
await Promise.all(Array.from({ length: 6 }, fetchWorker));
for (const name of ['manifest.json', 'icon.svg', 'offline.css', 'SOURCES.txt']) {
  const source = await readFile(join(local, name), 'utf8');
  files[name] = Buffer.from(source.replaceAll('\r\n', '\n'));
}

function adapt(file, edits) {
  let source = files[file].toString('utf8');
  for (const [before, after] of edits) {
    if (!source.includes(before)) throw new Error('Upstream text changed in ' + file);
    source = source.replace(before, after);
  }
  files[file] = Buffer.from(source);
}

adapt('index.html', [
  ['./node_modules/three/build/three.module.js', './vendor/three/build/three.module.min.js'],
  ['./node_modules/three/examples/jsm/', './vendor/three/examples/jsm/'],
  ['</head>', '<link rel="icon" href="./icon.svg"><link rel="stylesheet" href="./offline.css"></head>'],
  ['Check your connection and try again.', 'WebGL is required. Enable hardware acceleration and try again.'],
]);
adapt('src/main.js', [
  ["import Multiplayer from './network/multiplayer.js';\n", ''],
  ["import LeaderboardClient from './leaderboard/client.js';\n", ''],
  ['game.leaderboard = new LeaderboardClient(game);\n', ''],
  ['game.multiplayer = new Multiplayer(game);\n', ''],
  ["const TRAILER = new URLSearchParams(location.search).has('trailer');", 'const TRAILER = false;'],
]);
adapt('src/ui/hud.js', [
  ['>TACTICAL BOMB DEFUSAL<', '>战术拆弹 · 离线对战<'],
  ['>BATTLEGROUND<', '>选择地图<'],
  ['>PLAY VS BOTS<', '>开始机器人对战<'],
  ['>PROFILE\'', '>角色\''],
  ['>SETTINGS<b class="mn-chev"', '>设置<b class="mn-chev"'],
  ['Shown in matches and global rankings', 'Shown in your matches'],
]);

const output = join(root, 'public', 'packages');
await mkdir(output, { recursive: true });
const sorted = Object.fromEntries(Object.keys(files).sort().map(name => [name, files[name]]));
const packed = zipSync(sorted, { level: 6, mtime: new Date(2026, 6, 27, 12) });
await writeFile(join(output, 'tinystrike.wow'), packed);
console.log('Packaged Tiny Strike (' + packed.length + ' bytes, SHA-256 ' + sha256(packed) + ')');
