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
  build: {
    rollupOptions: {
      output: {
        // Keep vendor libraries in stable, cacheable chunks. The generated
        // detector JSON is intentionally loaded eagerly from a single source of
        // truth and remains in the app chunk.
        manualChunks: {
          react: ['react', 'react-dom'],
          leaflet: ['leaflet'],
        },
      },
    },
  },
});
