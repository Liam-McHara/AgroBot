import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

/**
 * The Mini App is a plain single-page Svelte app (ADR-0006). In development it runs on Vite
 * and proxies `/api` to the Worker on `wrangler dev` so the browser sees one origin; the
 * production build in `dist/` is what `wrangler.jsonc` serves as static assets (ARCH §15).
 */
export default defineConfig({
  plugins: [svelte()],
  // ARCH §12: Settings shows the app version.
  define: { __APP_VERSION__: JSON.stringify(version) },
  // One `.env` for the whole workspace (ARCH §13); Vite exposes the `VITE_*` keys only.
  envDir: '../../',
  server: {
    port: 5173,
    proxy: {
      // `ws: true` carries the realtime socket of ARCH §7 through the same proxy.
      '/api': { target: 'http://localhost:8080', changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
