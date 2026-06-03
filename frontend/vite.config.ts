import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Inlined at build time — exposes the miniapp build version to tracking.ts
// so every event payload carries `app_version`. `npm_package_version` is
// populated by npm whenever a script runs through `npm run ...`.
const APP_VERSION = process.env.npm_package_version || '0.0.0'
const ORCHESTRATOR_PROXY_TARGET =
  process.env.VITE_DREAMY_ORCHESTRATOR_PROXY_TARGET ||
  process.env.STUDIO_ORCHESTRATOR_PROXY_TARGET ||
  'http://127.0.0.1:8090'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  server: {
    proxy: {
      '/api': {
        target: ORCHESTRATOR_PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
})
