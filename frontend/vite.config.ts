import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      allowedHosts: true as true,
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Local dev proxy: forward /api/* and /socket.io/* to the FastAPI backend on :8001.
      // When accessed via the Emergent ingress URL, ingress already routes /api/*
      // to :8001 externally; this proxy makes localhost:3000 work in isolation too.
      proxy: {
        '/api': { target: 'http://127.0.0.1:8001', changeOrigin: true },
        '/socket.io': {
          target: 'http://127.0.0.1:8001',
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
