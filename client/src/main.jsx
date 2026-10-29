import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

/**
 * GitHub Pages caches index.html for ten minutes, so a browser can keep running
 * an older bundle after a publish. The old bundle is the one that could not sign
 * in, so a stale copy checks version.json once and reloads itself onto the new
 * build instead of leaving the owner on a dead page.
 */
const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'

async function reloadIfStale() {
  try {
    const base = import.meta.env.BASE_URL || '/'
    const response = await fetch(`${base}version.json?ts=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) return

    const published = await response.json()
    if (!published?.build || published.build === BUILD_ID) return

    // Never fight an earlier reload; give the new build a moment to settle.
    const last = Number(window.sessionStorage.getItem('levisbotuniverse.reloaded') || 0)
    if (Date.now() - last < 20000) return
    window.sessionStorage.setItem('levisbotuniverse.reloaded', String(Date.now()))

    const url = new URL(window.location.href)
    url.searchParams.set('v', published.build)
    window.location.replace(url.toString())
  } catch {
    // Offline or blocked; the app itself still runs.
  }
}

reloadIfStale()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
