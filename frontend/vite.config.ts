import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The detector outputs live in ../data/demo/processed and are imported at build
// time from a single source of truth. `server.fs.allow` lets the dev server
// read those files outside the frontend root.
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: ['..'],
    },
  },
});
