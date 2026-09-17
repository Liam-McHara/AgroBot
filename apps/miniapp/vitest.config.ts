import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte({ hot: false })],
  define: { __APP_VERSION__: JSON.stringify('test') },
  resolve: {
    // Components under test must run against the browser build of Svelte.
    conditions: ['browser'],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
