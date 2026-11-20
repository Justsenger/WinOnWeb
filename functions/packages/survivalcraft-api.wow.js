const packageKey = 'survivalcraft-api.wow';

async function servePackage({ env, request }) {
  const metadataOnly = request.method === 'HEAD';
  const object = metadataOnly
    ? await env.WOW_PACKAGES.head(packageKey)
    : await env.WOW_PACKAGES.get(packageKey);
  if (!object) return new Response(null, { status: 404 });
  return new Response(metadataOnly ? null : object.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(object.size),
      'ETag': object.httpEtag,
      'Cache-Control': 'no-cache',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
}

export const onRequestGet = servePackage;
export const onRequestHead = servePackage;
