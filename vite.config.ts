import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest';

export default defineConfig({
  plugins: [preact(), crx({ manifest })],
  build: {
    target: 'es2022',
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
