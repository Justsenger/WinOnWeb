import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const adapters = join(root, 'wow-packages', 'upstream-arcade');
const output = join(root, 'public', 'packages');
const games = [
  {
    id: '2048', name: '2048', repository: 'gabrielecirulli/2048',
    revision: '478b6ec346e3787f589e4af751378d06ded4cbbc',
    sha256: 'aba89e4aa20419312f712d7f6d4d038f0e25096591120e2f483f7364108ced29',
    description: 'Gabriele Cirulli 的原版数字合并游戏，支持方向键、触屏和断点续玩。',
    icon: 'meta/apple-touch-icon.png', window: { width: 690, height: 790, minWidth: 320, minHeight: 430 },
    include: /^(index\.html|favicon\.ico|js\/.+\.js|meta\/.+|style\/.+\.(css|woff|eot|svg)|README\.md|LICENSE\.txt)$/,
    notices: ['ClearSans-LICENSE.txt'],
    credits: 'Gabriele Cirulli and contributors (MIT). Clear Sans by Intel (Apache 2.0). The package identifies its source, scopes browser saves to this app and reduces the page margins in shorter windows.',
  },
  {
    id: 'hexgl', name: 'HexGL', repository: 'BKcore/HexGL',
    revision: '6addc95a2fce3bf05f4d751823cc054c61a16d68',
    sha256: '40fe6b8358e502d675e104b1042306fa108ec0937096b86c609acf8617bfb904',
    description: 'Thibaut Despoulain 的 WebGL 竞速游戏，在 Cityscape 赛道挑战三圈计时。部分代码仅限非商业使用。',
    icon: 'icon_128.png', window: { width: 1080, height: 690, minWidth: 420, minHeight: 350 },
    include: /^(index\.html|launch\.js|favicon\.png|icon_128\.png|audio\/.+|css\/.+|textures(?:\.full)?\/.+|geometries\/.+|replays\/.+|LICENSE|README\.md)$/,
    notices: ['BebasNeue-OFL.txt', 'Three-LICENSE.txt', 'Leap-LICENSE.txt', 'Stats-LICENSE.txt', 'Apache-2.0.txt'],
    credits: 'HexGL by Thibaut Despoulain (BKcore). The root MIT grant is subject to file-specific licenses. Core gameplay, HUD, city track and ship scripts carry CC BY-NC 3.0 (https://creativecommons.org/licenses/by-nc/3.0/). See original file headers and README.md. Artwork credits: Charnel (HexMKI base model), Nobiax (track texture). See audio/LICENSE for named authors and terms. Three.js and Stats.js are MIT, LeapJS is BSD-2-Clause, dat.GUI is Apache 2.0, Bebas Neue is SIL OFL 1.1. ShaderExtras includes a CC BY 3.0 shader. The package removes external analytics and uses the local favicon.',
  },
  {
    id: 'breakout', name: 'JavaScript Breakout', repository: 'jakesgordon/javascript-breakout',
    revision: 'eed59e2affa9423b93d2ac8ff93061bb88b33284',
    sha256: '7508372f6622c0430de6415091220f3201a504065514cc149be20d41e1183d70',
    description: 'Jake Gordon 的十关打砖块。空格发球，左右键移动挡板，支持触屏。',
    icon: 'packaged/assets/icon_128.png', window: { width: 840, height: 710, minWidth: 380, minHeight: 400 },
    include: /^(index\.html|(?:game|levels|breakout)\.js|breakout\.css|images\/.+|sound\/breakout\/.+\.mp3|packaged\/assets\/icon_128\.png|README\.md|LICENSE)$/,
    notices: [],
    credits: 'Jake Gordon and contributors (MIT). The six original Freesound recordings are unmodified; attribution and CC BY-ND 2.0 terms are in LICENSE (https://creativecommons.org/licenses/by-nd/2.0/). The package loads those recordings through HTML audio in place of the original Flash-era sound manager and namespaces saved preferences.',
  },
];

async function readSource(game) {
  const cache = join(tmpdir(), 'wow-arcade-' + game.id + '-' + game.revision + '.zip');
  let archive;
  try {
    archive = await readFile(cache);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const url = 'https://codeload.github.com/' + game.repository + '/zip/' + game.revision;
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error('Unable to download ' + url + ' (' + response.status + ')');
    archive = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(archive).digest('hex') !== game.sha256) {
    throw new Error('Upstream archive checksum mismatch for ' + game.id + ' at ' + cache);
  }
  await writeFile(cache, archive);
  const source = {};
  for (const [path, data] of Object.entries(unzipSync(archive))) {
    if (!path.endsWith('/')) source[path.slice(path.indexOf('/') + 1)] = data;
  }
  return source;
}

function adapt(game, source, files) {
  let html = Buffer.from(files['index.html']).toString('utf8');
  if (game.id === 'hexgl') {
    for (const [, path] of html.matchAll(/<script src="([^"]+)"/g)) {
      if (!source[path]) throw new Error('Missing HexGL script: ' + path);
      files[path] = source[path];
    }
    html = html.replace(/<script type="text\/javascript">\s*\/\/analytics[\s\S]*?<\/script>/, '')
      .replaceAll('href="http://hexgl.bkcore.com/favicon.png"', 'href="favicon.png"');
  } else if (game.id === '2048') {
    const storage = Buffer.from(files['js/local_storage_manager.js']).toString('utf8');
    files['js/local_storage_manager.js'] = Buffer.from(storage.replace(/"(bestScore|gameState|test)"/g, '"wow.2048.$1"'));
    html = html.replace(/This site is the official version of 2048\.[^\n]+/, 'Packaged from <a href="https://github.com/gabrielecirulli/2048" target="_blank" rel="noopener">Gabriele Cirulli’s original 2048</a>.')
      .replace('</head>', '<style>@media (max-height: 820px) { body { margin: 16px 0; } }</style></head>');
  } else if (game.id === 'breakout') {
    const breakout = Buffer.from(files['breakout.js']).toString('utf8');
    files['breakout.js'] = Buffer.from(breakout.replace(/\.storage\.(sound|level|highscore)\b/g, '.storage["wow.breakout.$1"]'));
    html = html.replace('<script src="levels.js"></script>', '<script src="levels.js"></script>\n  <script src="breakout-audio.js"></script>');
  }
  files['index.html'] = Buffer.from(html);
}

await mkdir(output, { recursive: true });
for (const game of games) {
  const source = await readSource(game);
  const files = Object.fromEntries(Object.entries(source).filter(([path]) => game.include.test(path)));
  adapt(game, source, files);
  if (game.id === 'breakout') files['breakout-audio.js'] = await readFile(join(adapters, 'breakout-audio.js'));
  for (const notice of game.notices) files['licenses/' + notice] = await readFile(join(adapters, notice));
  const manifest = {
    format: 1, id: game.id, name: game.name, version: '1.0.0', description: game.description,
    icon: game.icon, entry: 'index.html', runtime: 'iframe', permissions: [], window: game.window,
  };
  if (!files[game.icon]) throw new Error('Missing upstream icon: ' + game.icon);
  files['manifest.json'] = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  files['SOURCES.txt'] = Buffer.from('Source: https://github.com/' + game.repository + '/tree/' + game.revision + '\nArchive SHA-256: ' + game.sha256 + '\n\n' + game.credits + '\n');
  const zip = zipSync(files, { level: 6, mtime: new Date(2000, 0, 1) });
  await writeFile(join(output, game.id + '.wow'), zip);
  console.log(game.id + '.wow: ' + zip.byteLength + ' bytes (' + Object.keys(files).length + ' files)');
}
