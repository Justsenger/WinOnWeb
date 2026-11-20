import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// The package builders also work offline with a previously populated work/ cache.
const luantiBuild = 'https://wasmga.me/engines/luanti-6f532b5-p2/';
const luantiData = 'https://wasmga.me/files/luanti/';
const assets = {
  classicube: [
    ['ClassiCube.js', 'https://cdn.classicube.net/client/latest/ClassiCube.js', '6c2aecf0f0dcbaf74f9e0e764a2678d62afcf8e5c76654c17ce1037be11f20da'],
    ['default.zip', 'https://www.classicube.net/static/default.zip', '55eac12a9727d209b42694d07dfdca8d50349779ab77ffc11a31d2cb66b45635'],
    ['LICENSE.txt', 'https://raw.githubusercontent.com/ClassiCube/ClassiCube/38206c309f759fb7cec126e0857682d56eabbb08/license.txt', 'a3c404fb40407b79841d8c1d93f76ff406004a880a16cea29d74d767438dd48f'],
  ],
  luanti: [
    ['luanti.js', luantiBuild + 'luanti.js', 'dcfc7cf6774bcdba016f359e451cf005e54baa80bcd85c06aebc8dc848b57300'],
    ['luanti.wasm', luantiBuild + 'luanti.wasm', 'aeca3f71dda195198bb66ad1fe4aaa80a08897c1f7cbd63f59cee0347d4af861'],
    ['luanti.zip', luantiData + 'luanti-763badba8821.zip', '763badba8821f53cd8492860e05b1d6b4eb6c2cfe6252b6d94ee3af0bbac4c79'],
    ['minetest-game.zip', luantiData + 'minetest-game-67b10122fb77.zip', '67b10122fb773b72b013fd7432c4fe88010c106a61bc6c4fed08b6de5041a151'],
    ['build.sh', luantiBuild + 'build.sh', '350ff712952add3527f0ec4c0efb0dcf989a8630d166704c048debc6c258e47d'],
    ['webport.diff', luantiBuild + 'webport.diff', '7fc885a1562eb3b45f96060417f1ef8389795c2e52b2da22f389730162496762'],
    ['luanti.diff', luantiBuild + 'luanti.diff', 'e327bbc1cd4ec8c5640c44aa399e5c6ca81ca2e83ed96e29b34900e676b026c9'],
    ['LICENSE.txt', 'https://raw.githubusercontent.com/paradust7/luanti/6f532b5ed03a6aa70091412114b5dde3d33c6f87/LICENSE.txt', 'f37450f476f997f14fbed7a1ba96462864fe4f689024b6903f71cf31973e84a5'],
  ],
};
const source = {
  classicube: 'ClassiCube client: https://github.com/ClassiCube/ClassiCube\nWeb client integration: https://github.com/ClassiCube/ClassiCube/blob/master/doc/hosting-webclient.md',
  luanti: 'Engine and corresponding build sources: https://github.com/wasmga-me/luanti-wasm/tree/wasmgame/wasmgame\nEngine baseline: https://github.com/paradust7/luanti/tree/6f532b5ed03a6aa70091412114b5dde3d33c6f87\nMinetest Game: https://github.com/luanti-org/minetest_game/tree/c42e4d0c0ff9d27ff7b9b308c3cfc14098dd3a0f\nEngine and game licensing: see LICENSE.txt and the notices in the game archive.',
};
const digest = data => createHash('sha256').update(data).digest('hex');

for (const [id, files] of Object.entries(assets)) {
  const dir = new URL('../work/' + id + '-source/', import.meta.url);
  await mkdir(dir, { recursive: true });
  for (const [name, url, hash] of files) {
    const dest = new URL(name, dir);
    const cached = await readFile(dest).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (cached && digest(cached) === hash) continue;
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(url + ' HTTP ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== hash) throw new Error('Upstream content changed for ' + url + '. Review the version before repackaging.');
    const temp = fileURLToPath(dest) + '.' + process.pid + '.tmp';
    try {
      await writeFile(temp, bytes);
      await rename(temp, dest);
    } finally {
      await rm(temp, { force: true });
    }
  }
  await writeFile(new URL('SOURCES.txt', dir), source[id] + '\n\n' + files.map(([name, url, sha]) => [name, sha, url].join('  ')).join('\n') + '\n');
}

