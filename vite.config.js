import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves project sites at https://<user>.github.io/<repo>/, so
// the production build needs that repo-name base path baked into asset URLs.
// Local dev keeps base '/' so `npm run dev` is unaffected.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/techpack-ai-builder/' : '/',
  server: { port: 3000 }
}))
