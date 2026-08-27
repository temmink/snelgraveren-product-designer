import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Dev-only harness (never part of a plugin build): serves the repo root so the
// relative imports into frontend/js/designer resolve as they do in the bundle.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  root: repoRoot,
  server: {
    port: 5178,
    open: false,
    fs: { allow: [repoRoot] },
    // The font proxy is same-origin in production; from localhost it would be a
    // cross-origin fetch the REST API sends no CORS header for.
    proxy: {
      '/pf-api': {
        target: 'https://www.snelgraveren.nl/wp-json/pf/v1',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/pf-api/, ''),
      },
    },
  },
});
