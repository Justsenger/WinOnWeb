import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

const revision = '9e0e24a5b474dc0d410ee06697119e63a3014754';
const project = 'https://github.com/CatanCats/Ouro';
const sourceUrl = 'https://codeload.github.com/CatanCats/Ouro/zip/' + revision;
const expected = '4e20f77bbf34c607eaf0f5e27b95fadd6236ebb571b42fa5237de2ba45c6df99';
const cache = new URL('../work/ouro-source/', import.meta.url);
const output = new URL('../public/packages/', import.meta.url);
await mkdir(cache, { recursive: true });
const archiveFile = new URL('source.zip', cache);
let archive;
try {
  archive = await readFile(archiveFile);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (!archive || createHash('sha256').update(archive).digest('hex') !== expected) {
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('Ouro download failed: ' + response.status);
  archive = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(archive).digest('hex') !== expected) throw new Error('Ouro source digest mismatch');
  await writeFile(archiveFile, archive);
}
const files = unzipSync(archive);
const prefix = 'Ouro-' + revision + '/';
const original = strFromU8(files[prefix + 'offline.html']);
const icon = original.match(/<link rel="icon" href="data:image\/svg\+xml,([^"]+)"/)?.[1];
if (!icon) throw new Error('Missing upstream Ouro icon');
const html = original
  .replace(/^<link [^>]*https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*$/gm, '')
  .replace('id="toOnline"', 'id="toOnline" hidden style="display:none"')
  .replace('href="offline.html" download=', 'href="index.html" download=');
const manifest = {
  format: 1, id: 'ouro', name: 'Ouro', version: revision.slice(0, 8),
  description: 'CatanCats 制作的蛇形竞技游戏，内含离线 AI 对手。',
  entry: 'index.html', icon: 'icon.svg', runtime: 'iframe',
  window: { width: 1050, height: 740, minWidth: 540, minHeight: 410 }
};
const packed = zipSync({
  'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
  'index.html': strToU8(html),
  'icon.svg': strToU8(decodeURIComponent(icon)),
  'LICENCE': files[prefix + 'LICENCE'],
  'SOURCES.txt': strToU8(`Ouro by CatanCats, AGPL-3.0.\n${project}/tree/${revision}\n\nThe complete original source is included in source.zip. The WOW entry uses offline.html with external Google Fonts removed, the multiplayer link hidden and its local download URL updated.\n`),
  'source.zip': archive
}, { level: 6, mtime: new Date(2000, 0, 1) });
await mkdir(output, { recursive: true });
await writeFile(new URL('ouro.wow', output), packed);
console.log('Ouro:', packed.length, 'bytes');
