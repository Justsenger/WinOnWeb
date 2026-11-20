importScripts('/wow-guest-resources.js', '/wow-survivalcraft.js');
const DB_NAME = 'win11-web-shell:wow-apps:v1';
const DB_VERSION = 2;
const FILES_STORE = 'files';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

let connection;
function openDb() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILES_STORE)) db.createObjectStore(FILES_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains('apps')) db.createObjectStore('apps', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { connection = undefined; db.close(); };
      db.onclose = () => { connection = undefined; };
      resolve(db);
    };
    request.onerror = () => { connection = undefined; reject(request.error); };
  });
  return connection;
}

function contentType(path) {
  const ext = path.split('.').pop().toLowerCase();
  return {
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json',
    wasm: 'application/wasm',
    zip: 'application/zip',
    webp: 'image/webp',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    data: 'application/octet-stream',
  }[ext] || 'application/octet-stream';
}

async function readFile(appId, path) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(FILES_STORE, 'readonly').objectStore(FILES_STORE).get(`${appId}:${path}`);
    request.onsuccess = () => {
      resolve(request.result?.data || null);
    };
    request.onerror = () => {
      reject(request.error);
    };
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !url.pathname.startsWith('/wow-apps/')) return;
  event.respondWith((async () => {
    const parts = url.pathname.split('/').slice(2);
    const appId = parts.shift();
    if (!appId) return new Response('Missing WOW app id', { status: 400 });
    const path = parts.filter(Boolean).join('/') || 'index.html';
    try {
      const blob = await readFile(appId, path);
      if (!blob) return new Response('WOW file not found', { status: 404 });
      let body = blob;
      if (/\.html?$/i.test(path) && ['document', 'iframe'].includes(event.request.destination)) {
        const html = await blob.text();
        const hook = '<script src="/wow-guest-resources.js"></script>';
        body = /<head(?:\s[^>]*)?>/i.test(html)
          ? html.replace(/<head(?:\s[^>]*)?>/i, match => match + hook)
          : html.replace(/^(\s*<!doctype[^>]*>)?/i, match => match + hook);
      } else if (appId === 'survivalcraft-api' && path === 'main.js') {
        body = adaptSurvivalcraftMain(await blob.text());
      } else if (event.request.destination === 'worker' || path.endsWith('/dotnet.native.worker.mjs')) {
        body = new Blob(['(' + installWowGuestResources.toString() + ')();\n', blob]);
      } else if (appId === 'survivalcraft-api' && path.endsWith('/dotnet.native.js')) {
        const js = await blob.text();
        body = js.replace(/(var wasmfsOPFS(?:FileHandles|Blobs) = )(new HandleAllocator);/g,
          '$1(globalThis[Symbol.for("winonweb.guest-resources.v1")]?.watchFileTable($2) ?? $2);');
      }
      return new Response(body, {
        headers: {
          'Content-Type': contentType(path),
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Cache-Control': 'no-cache',
        },
      });
    } catch {
      return new Response('WOW storage unavailable', { status: 503 });
    }
  })());
});
