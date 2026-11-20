import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const violations = [];
const modules = [];
async function scan(dir) {
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const name = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scan(name);
      continue;
    }
    if (!/\.(ts|astro|m?js|html)$/.test(name)) continue;
    const source = await readFile(path.join(root, name), 'utf8');
    const layer = /^src\/wow\/(contracts|hal|kernel|runtime)\//.exec(name)?.[1];
    if (
      !name.startsWith('src/wow/hal/') &&
      !name.startsWith('public/wow/') &&
      /\b(?:indexedDB\s*\.\s*open|localStorage\s*\.|navigator\s*\.\s*serviceWorker|showDirectoryPicker\b)/.test(
        source,
      )
    ) {
      violations.push(name + ' directly uses a browser storage or hosting primitive');
    }
    if (!layer) continue;
    modules.push(name);
    const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
    const ranks = { contracts: 0, hal: 1, kernel: 2, runtime: 3 };
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        const spec = node.moduleSpecifier.text;
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), spec));
        const targetLayer = /^src\/wow\/(contracts|hal|kernel|runtime)(?:\/|$)/.exec(target)?.[1];
        if (
          (layer === 'contracts' && (!spec.startsWith('.') || targetLayer !== 'contracts')) ||
          (spec.startsWith('.') && (!targetLayer || ranks[targetLayer] > ranks[layer]))
        )
          violations.push(name + ' imports ' + spec);
      }
      if (
        ts.isIdentifier(node) &&
        !(ts.isPropertySignature(node.parent) && node.parent.name === node) &&
        ['contracts', 'kernel'].includes(layer) &&
        /^(window|document|navigator|HTMLElement|HTMLIFrameElement|MessagePort|MessageChannel|Worker|Element|localStorage|indexedDB|DOMException)$/.test(
          node.text,
        )
      ) {
        violations.push(name + ' references browser identifier ' + node.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
}
for (const dir of ['src', 'public', 'wow-packages', 'functions']) await scan(dir);
if (violations.length) throw Error(violations.join('\n'));
console.log(
  'WOW dependency, headless kernel and native storage boundaries passed (' + modules.length + ' OS modules)',
);
