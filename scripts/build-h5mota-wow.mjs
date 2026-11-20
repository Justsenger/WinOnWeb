import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: {
  'zip-dir': { type: 'string' },
  'out-dir': { type: 'string' },
} });
const output = resolve(values['out-dir'] ?? resolve(root, 'public/packages'));
const titles = [
  {
    id: '24', name: '24层魔塔', original: '胖老鼠', port: '小艾、秋橙、北海小羊',
    hash: '59175adfc2b0d619686a3a9ca72a2e4a4c674cdc6d8e868e583d0c212a32609f',
  },
  {
    id: '51', name: '50层魔塔', original: 'N.W', port: '数码宝贝51、鹿间裕贵',
    hash: '15d4ace682538b7d991dee5aec6dedfdb399ce22df1ac033c6150b88278a449f',
  },
  {
    id: 'xinxin', name: '新新魔塔', original: 'cos105hk', port: '劒橫酱沽月、杨子默、水波神木',
    hash: '375e4454ab68d35fd4f43883aa8ce1ee47d9ee252995a0b78721dbb25fff044c',
  },
];

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`下载 ${url} 失败（HTTP ${response.status}）`);
  return new Uint8Array(await response.arrayBuffer());
}

function getRuntimeFiles(archive) {
  const files = {};
  for (const [name, bytes] of Object.entries(unzipSync(archive))) {
    const path = name.slice(name.indexOf('/') + 1);
    if (path.endsWith('/')) continue;
    if (/^(?:index\.html|styles\.css|logo\.png|main\.js)$/.test(path) ||
        /^(?:libs|extensions|project)\//.test(path)) {
      files[path] = bytes;
    }
  }
  return files;
}

function verifyGame(files, id) {
  const source = strFromU8(files['project/data.js']);
  const data = JSON.parse(source.slice(source.indexOf('=') + 1).trim().replace(/;$/, ''));
  if (data.firstData.name !== id) throw new Error(`作品标识不符：${data.firstData.name}`);
  const required = ['index.html', 'main.js', 'styles.css', 'logo.png', data.main.styles.startBackground];
  for (const [key, directory, suffix] of [
    ['floorIds', 'floors', '.js'], ['images', 'images', ''], ['tilesets', 'tilesets', ''],
    ['animates', 'animates', '.animate'], ['bgms', 'bgms', ''], ['sounds', 'sounds', ''],
    ['fonts', 'fonts', '.ttf'],
  ]) {
    for (const name of data.main[key]) required.push(`project/${directory}/${name}${suffix}`);
  }
  for (const path of required) {
    if (!files[path]?.length) throw new Error(`${id} 缺少 ${path}`);
  }
  if (!/this\.bgmRemote\s*=\s*false/.test(strFromU8(files['main.js']))) {
    throw new Error(`${id} 需要远程音乐`);
  }
  return data;
}

function adaptOffline(files, id) {
  // Apply after the original definitions load. Keep local saves and replay export available.
  function append(file, script) {
    files[file] = strToU8(strFromU8(files[file]) + '\n' + script.trim() + '\n');
  }
  append('main.js', `
    main.loadFloors = function (callback) {
      var remaining = main.floorIds.length;
      main.setMainTipsText('正在加载楼层文件...');
      main.floorIds.forEach(function (id) {
        main.loadFloor(id, function () {
          if (--remaining === 0) {
            main.dom.mainTips.style.display = 'none';
            callback();
          }
        });
      });
    };
  `);
  // The official extensions edit the map and write saves on the editor's local file server.
  append('libs/extensions.js', 'extensions.prototype._load = function (callback) { callback(); };');
  // Reading slot thumbnails may finish after Enter loads a save or closes the panel.
  const ui = strFromU8(files['libs/ui.js']);
  const readSlots = '    core.getSaves(ids, function (data) {';
  if (ui.split(readSlots).length !== 2) throw new Error('无法识别存档预览加载逻辑');
  files['libs/ui.js'] = strToU8(ui.replace(readSlots, [
    '    var panel = core.status.event.ui;',
    readSlots,
    '        if (core.status.event.ui !== panel) return;',
  ].join('\n')));
  append('libs/events.js', `
    events.prototype._startGame_upload = function () {};
    events.prototype._gameOver_confirmUpload = function (ending) {
      core.ui.closePanel();
      this._gameOver_confirmDownload(ending);
    };
  `);
  append('libs/control.js', `
    control.prototype.syncSave = control.prototype.syncLoad = function () {
      core.ui.closePanel();
      core.drawTip('离线游戏可使用本地存档或存档文件');
    };
  `);
  if (id === '24') {
    append('project/plugins.js', 'delete plugins_bb40132b_638b_4a9f_b028_d3fe47acc8d1.hotReload;');
  }
}

await mkdir(output, { recursive: true });
for (const title of titles) {
  const slug = title.id;
  const downloadUrl = `https://h5mota.com/games/${slug}/${slug}.zip`;
  const archive = values['zip-dir']
    ? await readFile(resolve(values['zip-dir'], slug + '.zip'))
    : await download(downloadUrl);
  if (createHash('sha256').update(archive).digest('hex') !== title.hash) {
    throw new Error(`${slug}.zip 与已验证的官方版本不同，请重新核对作品、署名和资源后更新摘要。`);
  }
  const files = getRuntimeFiles(archive);
  const data = verifyGame(files, slug);
  adaptOffline(files, slug);
  const id = 'h5mota-' + slug;
  const manifest = {
    format: 1, id, name: title.name, version: data.firstData.version.replace(/^Ver\s+/i, ''),
    description: `${title.original}原作，${title.port}复刻。来自 H5魔塔广场的离线游戏，支持本地存档。`,
    icon: data.main.styles.startBackground, entry: 'index.html', runtime: 'iframe',
    permissions: ['fullscreen'], window: { width: 960, height: 720, minWidth: 400, minHeight: 400 },
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  files['SOURCES.txt'] = strToU8([
    `${title.name} · ${data.firstData.version}`,
    `原作　${title.original}`, `H5复刻　${title.port}`, '翻新　三原塔翻新小组', '作品主页发布者　大化术士',
    `作品主页　https://h5mota.com/tower/?name=${slug}`, `官方离线下载　${downloadUrl}`,
    `原始 ZIP SHA-256　${title.hash}`, '',
    'WinOnWeb 适配了离线启动、存档与回放。引擎的第三方库许可见 libs/thirdparty/LICENSE.md。',
    '本包供本地安装。官方对完整作品的公开再分发许可尚未核实。',
  ].join('\n') + '\n');
  const packed = zipSync(files, { level: 6, mtime: new Date(2000, 0, 1) });
  const target = resolve(output, id + '.wow');
  const temporary = target + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, packed);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(`${target}　${packed.length} bytes　${data.main.floorIds.length} 张地图　${data.main.bgms.length} 首配乐`);
}
