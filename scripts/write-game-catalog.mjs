import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

const definitions = JSON.parse(await readFile(new URL('../wow-packages/catalog.json', import.meta.url), 'utf8'));
export async function writeGameCatalog(directory, publicRelease = false) {
  await mkdir(directory, { recursive: true });
  const available = new Set(await readdir(directory));
  const games = definitions.filter(game =>
    available.has(game.id + '.wow') && !(publicRelease && game.localOnly)
  );
  await writeFile(new URL('catalog.json', directory), JSON.stringify(games, null, 2) + '\n');
  return games;
}
export const publicPackages = new URL('../public/packages/', import.meta.url);
if (import.meta.main) await writeGameCatalog(publicPackages);
