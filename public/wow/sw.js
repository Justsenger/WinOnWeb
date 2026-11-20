importScripts('/wow/guest-probe.js');
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function contentType(path) {
  const ext = path.split('.').pop().toLowerCase();
  return (
    {
      html: 'text/html; charset=utf-8',
      js: 'text/javascript; charset=utf-8',
      mjs: 'text/javascript; charset=utf-8',
      css: 'text/css; charset=utf-8',
      json: 'application/json',
      wasm: 'application/wasm',
      ogg: 'audio/ogg',
      mp3: 'audio/mpeg',
      mp4: 'video/mp4',
      wav: 'audio/wav',
      gif: 'image/gif',
      ttf: 'font/ttf',
      otf: 'font/otf',
      txt: 'text/plain; charset=utf-8',
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
    }[ext] || 'application/octet-stream'
  );
}

async function content(id, hash, path) {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('wow:db:packages', 1);
    req.onupgradeneeded = () => {
      for (const name of ['apps', 'versions', 'files', 'grants', 'links']) req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  function get(store, key) {
    return new Promise((resolve, reject) => {
      const r = db.transaction(store).objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  try {
    const v = await get('versions', [id, hash]);
    if (v?.state !== 'verified') return;
    if (v.backend === 'idb') return await get('files', [id, hash, path]);
    const parts = ['wow-apps', id, hash, ...path.split('/')];
    const name = parts.pop();
    let dir = await navigator.storage.getDirectory();
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    return await (await dir.getFileHandle(name)).getFile();
  } finally {
    db.close();
  }
}

function rangeResponse(request, blob, headers) {
  const spec = request.headers.get('Range');
  let status = 200;
  headers['Accept-Ranges'] = 'bytes';
  if (spec) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(spec);
    const start = match?.[1] ? Number(match[1]) : Math.max(0, blob.size - Number(match?.[2]));
    const end = match?.[1] && match[2] ? Math.min(blob.size - 1, Number(match[2])) : blob.size - 1;
    if (
      !match ||
      !(match[1] || match[2]) ||
      !Number.isSafeInteger(start) ||
      start > end ||
      start >= blob.size
    ) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'Content-Range': 'bytes */' + blob.size },
      });
    }
    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + blob.size;
    status = 206;
    blob = blob.slice(start, end + 1);
  }
  headers['Content-Length'] = String(blob.size);
  return new Response(request.method === 'HEAD' ? null : blob, { status, headers });
}

self.addEventListener('fetch', (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    !url.pathname.startsWith('/wow/apps/') ||
    !['GET', 'HEAD'].includes(request.method)
  )
    return;
  if (url.pathname === '/wow/apps/.ready/') {
    const html =
      '<!doctype html><script>parent.postMessage({tag:"wow:vhost-ready",nonce:location.hash.slice(1)},"*")</script>';
    event.respondWith(
      new Response(request.method === 'HEAD' ? null : html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Cross-Origin-Embedder-Policy': 'credentialless',
          'Cross-Origin-Opener-Policy': 'same-origin',
        },
      }),
    );
    return;
  }
  event.respondWith(
    (async () => {
      const match = /^\/wow\/apps\/([a-z0-9_-]+)\/v\/([a-f0-9]{64})\/(.*)$/.exec(url.pathname);
      if (!match) return new Response(null, { status: 404 });
      try {
        const path = match[3]
          .split('/')
          .map((part) => {
            const decoded = decodeURIComponent(part);
            if (decoded === '.' || decoded === '..' || /[\\\\/]/.test(decoded)) throw new URIError();
            return decoded;
          })
          .join('/');
        let blob = await content(
          match[1],
          match[2],
          path.endsWith('/') || !path ? path + 'index.html' : path,
        );
        if (!blob) return new Response(null, { status: 404 });
        const type = contentType(path.endsWith('/') || !path ? 'index.html' : path);
        let rewritten = false;
        if (type.startsWith('text/html') && url.searchParams.has('__wow_compute')) {
          rewritten = true;
          blob = new Blob([
            `<!doctype html><meta charset="utf-8"><body><script>
          const url=new URL(location.href),fallback=url.searchParams.get('__wow_fallback');
          url.searchParams.delete('__wow_compute');url.searchParams.delete('__wow_fallback');
          if (crossOriginIsolated && typeof SharedArrayBuffer==='function') location.replace(url.href);
          else if (fallback && new URL(fallback).origin===location.origin) location.replace(fallback);
          else document.body.textContent='该应用需要多线程 Wasm。请在支持跨源隔离的浏览器中独立打开桌面，或请宿主委派 cross-origin-isolated。';
        </script></body>`,
          ]);
        } else if (type.startsWith('text/html')) {
          rewritten = true;
          const hook = '<script>(' + installWowGuestResources.toString() + ')();</script>';
          const html = await blob.text();
          blob = new Blob([
            /<head(?:\s[^>]*)?>/i.test(html)
              ? html.replace(/<head(?:\s[^>]*)?>/i, (m) => m + hook)
              : html.replace(/^(\s*<!doctype[^>]*>)?/i, (m) => m + hook),
          ]);
        } else if (request.destination === 'worker') {
          rewritten = true;
          blob = new Blob(['(' + installWowGuestResources.toString() + ')();\n', blob]);
        }
        return rangeResponse(request, blob, {
          'Content-Type': type,
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'credentialless',
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Cache-Control': rewritten ? 'no-cache' : 'private, max-age=31536000, immutable',
          Vary: 'Sec-Fetch-Dest',
        });
      } catch (error) {
        return new Response(null, {
          status: error instanceof URIError ? 400 : error.name === 'NotFoundError' ? 404 : 503,
        });
      }
    })(),
  );
});
