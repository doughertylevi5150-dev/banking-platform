import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves project sites from /<repo>/, local dev and other
  // hosts stay at the root.
  base: process.env.GITHUB_PAGES ? '/banking-platform/' : '/',
  plugins: [react()],
  server: {
    proxy: {
      // Local dev talks to the Express auth server; production uses VITE_API_URL.
      '/api': {
        target: process.env.VITE_DEV_API || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
