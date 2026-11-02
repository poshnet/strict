import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The app is static; /api, /m and /media go to the worker: wrangler dev on :8789, or production with
// API_TARGET=https://bounced.fun npm run dev:web
const target = process.env.API_TARGET || 'http://localhost:8789';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5291,
    proxy: Object.fromEntries(['/api', '/m', '/media'].map((p) => [p, { target, changeOrigin: true, secure: true }])),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: { charts: ['lightweight-charts'], react: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'] } } },
  },
});
