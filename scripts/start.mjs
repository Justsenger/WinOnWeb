import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDevHttpsCert, loadDevHttpsOptions } from './dev-https.mjs';
import { publicPackages, writeGameCatalog } from './write-game-catalog.mjs';

function listLanUrls(port) {
  const ips = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const addr of entries ?? []) {
      if (!addr.internal && addr.family === 'IPv4' && !addr.address.startsWith('169.254.')) {
        ips.push(addr.address);
      }
    }
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  ips.sort((a, b) => rank(a) - rank(b));
  const urls = ips.map((ip) => `https://${ip}:${port}/`);
  const host = os.hostname()?.trim();
  if (host) urls.push(`https://${host.toLowerCase()}.local:${port}/`);
  return urls;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const astro = path.join(root, 'node_modules/astro/bin/astro.mjs');
const mode = process.argv.includes('preview') ? 'preview' : 'dev';
if (mode === 'dev') await writeGameCatalog(publicPackages);

const certResult = ensureDevHttpsCert();
const httpsOptions = loadDevHttpsOptions();
if (!certResult.ready || !httpsOptions) {
  console.error(`HTTPS 证书就绪失败，拒绝以非加密 HTTP 启动：${certResult.error || 'unknown error'}`);
  process.exit(1);
}

const { default: config } = await import('../astro.config.mjs');
const listenHost = config.server?.host || '0.0.0.0';
const listenPort = config.server?.port || 5190;
const lanUrls = listLanUrls(listenPort);

console.log(`WinOnWeb (${mode}) 默认启用 HTTPS（https://0.0.0.0:${listenPort}/）：https://localhost:${listenPort}/  ${lanUrls.join('  ')}`);

const child = spawn(
  process.execPath,
  [astro, mode, '--host', listenHost, '--port', String(listenPort)],
  { cwd: root, stdio: 'inherit', windowsHide: true },
);
child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
