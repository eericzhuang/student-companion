import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Standalone demo server (no CRXJS): serves demo/ with the real extension
// components against mock data. `npx vite --config vite.demo.config.ts`.
export default defineConfig({
  root: 'demo',
  plugins: [preact()],
  server: { port: 5199, strictPort: true },
});
