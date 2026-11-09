/**
 * Keeps the universe ticking from the console.
 *
 * The Base44 workflow scheduler is refusing every run for this app right now, so
 * a timer inside the platform cannot be trusted to keep the swarm alive. The
 * foundry exposes a public, server-throttled `tick` action (one write per five
 * minutes, enforced on the server), so the console pings it once on load and
 * then every five minutes while a tab is open, plus whenever the tab comes back
 * into view.
 *
 * Nothing here needs the owner's session and nothing here can flood the event
 * log: the server holds the rate limit and answers `{ skipped: true }` when a
 * read already happened.
 */
const HOSTED_API = 'https://base44.app/api/apps/6ae17320e2bf99b777448a91/functions'
const ON_LOCAL_HOST =
  typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
const API_URL = (import.meta.env.VITE_API_URL || (ON_LOCAL_HOST ? '/api' : HOSTED_API)).replace(/\/$/, '')

const INTERVAL_MS = 5 * 60 * 1000

async function tick() {
  try {
    const response = await fetch(`${API_URL}/foundryOps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'tick' }),
    })
    if (!response.ok) return null
    return await response.json().catch(() => null)
  } catch {
    // Offline is not an error worth showing; the next tick tries again.
    return null
  }
}

export function startSwarmTick() {
  if (typeof window === 'undefined') return () => {}

  let stopped = false
  tick()

  const timer = window.setInterval(() => {
    if (!stopped) tick()
  }, INTERVAL_MS)

  const onVisible = () => {
    if (!stopped && document.visibilityState === 'visible') tick()
  }
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    stopped = true
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

/**
 * One maintenance pass per console load, run with the owner's own session.
 *
 * The maintenance chief is admin-only, and an owner token is exactly that, so
 * this gives the universe a self-audit whenever the console is opened without
 * adding a timer that could flood the event log. Failures stay quiet: the next
 * console load tries again.
 */
let maintenanceRequested = false

export async function runMaintenanceOnce(token) {
  if (typeof window === 'undefined' || !token || maintenanceRequested) return null
  maintenanceRequested = true
  try {
    const response = await fetch(`${API_URL}/maintenanceChief`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    })
    if (!response.ok) return null
    return await response.json().catch(() => null)
  } catch {
    return null
  }
}
