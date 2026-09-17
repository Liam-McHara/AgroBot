import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/**
 * The Mini App is a plain single-page Svelte app (ADR-0006). In development it runs on Vite
 * and proxies `/api` to the server so the browser sees one origin; the production build is
 * copied into the server image and served from there (ARCH §15).
 */
export default defineConfig({
  plugins: [svelte()],
  // One `.env` for the whole workspace (ARCH §13); Vite exposes the `VITE_*` keys only.
  envDir: '../../',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
