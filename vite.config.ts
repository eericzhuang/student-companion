import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest';

export default defineConfig({
  plugins: [preact(), crx({ manifest })],
  build: {
    target: 'es2022',
    // Extension pages load from local disk, so preload hints buy nothing — and
    // when the planner is embedded in a Workday page as a web-accessible
    // resource, Chrome logs every one of them as a "cross-world extension
    // resource mismatch" plus an "preloaded but not used" warning.
    modulePreload: false,
    rollupOptions: {
      input: {
        options: 'src/options/index.html',
        planner: 'src/planner/index.html',
        subscribe: 'src/subscribe/index.html',
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
});
