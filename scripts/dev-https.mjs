import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SSL_DIR = path.join(ROOT_DIR, '.cache', 'ssl');
export const PFX_PATH = path.join(SSL_DIR, 'dev.pfx');
export const PFX_PASSPHRASE = 'devpass';

function isPfxValid(filePath) {
  if (!existsSync(filePath)) return false;
  try {
    tls.createSecureContext({
      pfx: readFileSync(filePath),
      passphrase: PFX_PASSPHRASE,
    });
    return true;
  } catch {
    return false;
  }
}

export function collectDnsNamesAndIps() {
  const dnsNames = new Set(['localhost']);
  const host = os.hostname()?.trim();
  if (host) {
    dnsNames.add(host.toLowerCase());
    dnsNames.add(`${host.toLowerCase()}.local`);
  }
  const ipAddresses = new Set(['127.0.0.1']);
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const addr of entries ?? []) {
      if (!addr.internal && addr.family === 'IPv4' && !addr.address.startsWith('169.254.')) {
        ipAddresses.add(addr.address);
      }
    }
  }
  return { dnsNames: [...dnsNames], ipAddresses: [...ipAddresses] };
}

/**
 * Ensure a local self-signed HTTPS PKCS#12 certificate exists at `.cache/ssl/dev.pfx`.
 * Preserves an existing valid certificate so browser trust stays intact.
 */
export function ensureDevHttpsCert() {
  if (isPfxValid(PFX_PATH)) {
    return { ready: true, created: false, pfxPath: PFX_PATH };
  }

  mkdirSync(SSL_DIR, { recursive: true });
  const { dnsNames, ipAddresses } = collectDnsNamesAndIps();

  if (process.platform === 'win32') {
    const dnsList = dnsNames.map((d) => `'${d.replace(/'/g, "''")}'`).join(',');
    const ipList = ipAddresses.map((ip) => `'${ip.replace(/'/g, "''")}'`).join(',');
    const escapedPath = PFX_PATH.replace(/'/g, "''");
    const psScript = [
      '$ErrorActionPreference = "Stop"',
      `$sanParts = @(${dnsList}) | ForEach-Object { "dns=$_" }`,
      `$sanParts += @(${ipList}) | ForEach-Object { "ipaddress=$_" }`,
      '$sanExt = "2.5.29.17={text}" + ($sanParts -join "&")',
      '$cert = New-SelfSignedCertificate -Subject "CN=localhost" -CertStoreLocation "Cert:\\CurrentUser\\My" -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(1) -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.1", $sanExt)',
      `$pwd = ConvertTo-SecureString -String "${PFX_PASSPHRASE}" -Force -AsPlainText`,
      `Export-PfxCertificate -Cert $cert -FilePath '${escapedPath}' -Password $pwd | Out-Null`,
      'Remove-Item -Path $cert.PSPath -Force -ErrorAction SilentlyContinue',
    ].join('; ');

    const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      cwd: ROOT_DIR,
      stdio: 'pipe',
      windowsHide: true,
    });
    if (res.status === 0 && isPfxValid(PFX_PATH)) {
      return { ready: true, created: true, pfxPath: PFX_PATH };
    }
    const errText = res.stderr?.toString('utf8').trim() || res.error?.message || 'unknown error';
    return { ready: false, created: false, pfxPath: PFX_PATH, error: errText };
  }

  const sanArg = [
    ...dnsNames.map((d) => `DNS:${d}`),
    ...ipAddresses.map((ip) => `IP:${ip}`),
  ].join(',');
  const keyPath = path.join(SSL_DIR, 'dev-key.pem');
  const crtPath = path.join(SSL_DIR, 'dev-cert.pem');
  const gen = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-sha256',
      '-days',
      '365',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      crtPath,
      '-subj',
      '/CN=localhost',
      '-addext',
      `subjectAltName=${sanArg}`,
    ],
    { cwd: ROOT_DIR, stdio: 'pipe' },
  );
  if (gen.status === 0) {
    const pkcs = spawnSync(
      'openssl',
      ['pkcs12', '-export', '-out', PFX_PATH, '-inkey', keyPath, '-in', crtPath, '-passout', `pass:${PFX_PASSPHRASE}`],
      { cwd: ROOT_DIR, stdio: 'pipe' },
    );
    if (pkcs.status === 0 && isPfxValid(PFX_PATH)) {
      return { ready: true, created: true, pfxPath: PFX_PATH };
    }
  }
  return { ready: false, created: false, pfxPath: PFX_PATH, error: 'Failed to generate HTTPS certificate' };
}

/**
 * Load HTTPS options for Vite/Astro when `.cache/ssl/dev.pfx` is present.
 */
export function loadDevHttpsOptions() {
  if (!existsSync(PFX_PATH)) return undefined;
  try {
    return {
      pfx: readFileSync(PFX_PATH),
      passphrase: PFX_PASSPHRASE,
    };
  } catch {
    return undefined;
  }
}
