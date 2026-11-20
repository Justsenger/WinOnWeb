import { defineConfig } from 'astro/config';
import { ensureDevHttpsCert, loadDevHttpsOptions } from './scripts/dev-https.mjs';

const isBuild = process.argv.includes('build');
if (!isBuild) {
  ensureDevHttpsCert();
}
const httpsOptions = isBuild ? undefined : loadDevHttpsOptions();
const isolationHeaders = {
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  server: { host: '0.0.0.0', port: 5190, headers: isolationHeaders },
  vite: {
    build: { assetsInlineLimit: 0 },
    server: {
      strictPort: true,
      headers: isolationHeaders,
      ...(httpsOptions ? { https: httpsOptions } : {}),
      watch: { ignored: ['**/.cache/**'] },
    },
    ...(httpsOptions ? { preview: { https: httpsOptions, headers: isolationHeaders } } : { preview: { headers: isolationHeaders } }),
  },
});
