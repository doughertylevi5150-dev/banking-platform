import { API_BASE, apiHeaders } from '../api/config.js'

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
const API_URL = API_BASE

const INTERVAL_MS = 5 * 60 * 1000

// The load tick, a focus tick and the interval can all land within the same
// second. The server only guards five minutes between writes, so a rapid pair
// would otherwise log the same read twice. One attempt a minute is plenty.
const MIN_GAP_MS = 60 * 1000
let lastAttemptAt = 0

async function tick() {
  const now = Date.now()
  if (now - lastAttemptAt < MIN_GAP_MS) return null
  lastAttemptAt = now

  try {
    const response = await fetch(`${API_URL}/foundryOps`, {
      method: 'POST',
      headers: apiHeaders(),
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
      headers: apiHeaders(token),
      body: JSON.stringify({}),
    })
    if (!response.ok) return null
    return await response.json().catch(() => null)
  } catch {
    return null
  }
}

/**
 * An explicit press of the console's "Run now" button.
 *
 * The automatic tick is rate limited so a tab cannot flood the event log, but a
 * deliberate press should always get through: reset the client-side guard and
 * run one foundry tick. The server still holds its own five-minute limit, so a
 * press straight after an automatic read answers `{ skipped: true }` instead of
 * writing the same read twice.
 */
export async function runSwarmNow() {
  if (typeof window === 'undefined') return null
  lastAttemptAt = 0
  return tick()
}
