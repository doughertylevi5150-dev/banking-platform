import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves project sites from /<repo>/, local dev and other
  // hosts stay at the root.
  base: process.env.GITHUB_PAGES ? '/banking-platform/' : '/',
  plugins: [react()],
})
