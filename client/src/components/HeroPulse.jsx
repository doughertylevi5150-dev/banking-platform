import { useEffect, useState } from 'react'
import { fetchFoundry } from '../api/foundryApi'
import { compact } from '../lib/format'

const PULSE_MS = 30_000

/**
 * The hero panel's numbers, read live from the swarm instead of fixed labels.
 * The bars are each running bot's projected monthly revenue, tallest first.
 */
function HeroPulse({ token }) {
  const [state, setState] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    async function read() {
      try {
        const next = await fetchFoundry(token)
        if (!alive) return
        setState(next)
        setFailed(false)
      } catch {
        if (alive) setFailed(true)
      }
    }
    read()
    const timer = window.setInterval(read, PULSE_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [token])

  const totals = state?.totals
  const cards = [
    { label: 'Bots running', value: totals ? String(totals.running) : '—' },
    { label: 'Ideas waiting', value: totals ? String(totals.pending) : '—' },
    { label: 'Projected / mo', value: totals ? compact(totals.projected) : '—' },
    { label: 'Net to date', value: totals ? compact(totals.net) : '—' },
  ]

  const running = (state?.bots || []).filter((bot) => bot.status === 'running')
  const top = Math.max(1, ...running.map((bot) => bot.estMonthly || 0))
  const bars = running
    .slice()
    .sort((a, b) => (b.estMonthly || 0) - (a.estMonthly || 0))
    .slice(0, 12)

  return (
    <aside className="hero-panel">
      <div className="panel-header">
        <span>Swarm pulse</span>
        <span
          className={failed ? 'offline-dot' : 'online-dot'}
          aria-label={failed ? 'Swarm not answering' : 'Online'}
          title={failed ? 'Swarm not answering' : 'Live, refreshes every 30 seconds'}
        />
      </div>
      <div className="mini-grid pulse-grid">
        {cards.map((item) => (
          <div className="mini-card" key={item.label}>
            <span className="mini-label">{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
      <div className="signal-bars" aria-label="Projected monthly revenue per running bot">
        {bars.length === 0 && <span className="signal-empty">No bots running yet</span>}
        {bars.map((bot) => (
          <span
            key={bot.id}
            title={`${bot.name}: $${Math.round(bot.estMonthly || 0).toLocaleString()}/mo`}
            style={{ height: `${Math.max(8, Math.round(((bot.estMonthly || 0) / top) * 100))}%` }}
          />
        ))}
      </div>
    </aside>
  )
}

export default HeroPulse
