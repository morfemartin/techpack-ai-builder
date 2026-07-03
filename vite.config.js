import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves project sites at https://<user>.github.io/<repo>/, so
// the production build needs that repo-name base path baked into asset URLs.
// Local dev keeps base '/' so `npm run dev` is unaffected.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/techpack-ai-builder/' : '/',
  server: {
    port: 3000,
    // api/deepseek.js is a Vercel serverless function - plain `vite dev`
    // never executes /api/* on its own. scripts/dev.mjs starts a local shim
    // that runs the same handler code; this proxy forwards to it so
    // fetch('/api/deepseek') works identically in dev and in production.
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
}))
