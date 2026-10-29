import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchActivity } from '../api/foundryApi'
import { clock, dayLabel, timeOnly } from '../lib/format'

const KIND_TONE = {
  approved: 'green',
  proposal: 'purple',
  funding: 'amber',
  earning: 'green',
  expense: 'amber',
  live: 'blue',
  feed: 'blue',
}

const PAGE = 60

export default function ActivityPage({ token, onJump }) {
  const [data, setData] = useState(null)
  const [events, setEvents] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState('')
  const [botSlug, setBotSlug] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [startedAt] = useState(() => Date.now())

  useEffect(() => {
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(tick)
  }, [startedAt])

  const load = useCallback(
    async ({ append = false } = {}) => {
      setBusy(true)
      try {
        const next = await fetchActivity(token, { botSlug, kind, limit: PAGE, skip: append ? events.length : 0 })
        setData(next)
        setEvents(append ? [...events, ...next.events] : next.events)
        setError('')
      } catch (problem) {
        setError(problem.message)
      } finally {
        setBusy(false)
      }
    },
    [token, botSlug, kind, events],
  )

  useEffect(() => {
    load()
    // Filters are the only reason to refetch from the top.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, botSlug, kind])

  const grouped = useMemo(() => {
    const map = new Map()
    for (const event of events) {
      const label = dayLabel(event.at)
      const list = map.get(label) || []
      list.push(event)
      map.set(label, list)
    }
    return [...map.entries()]
  }, [events])

  return (
    <section className="section page" id="activity">
      <div className="page-head">
        <div>
          <span className="pill">Always on</span>
          <h2>Everything the swarm did</h2>
          <p className="page-sub">
            One record per action, oldest to newest by day. {data ? `${data.total} entries on file.` : ''}
          </p>
        </div>
        <div className="page-actions">
          <span className="live-chip">
            <span className="live-dot" aria-hidden="true" />
            live · {clock(elapsed)}
          </span>
          <button type="button" className="ghost-btn" onClick={() => onJump('console')}>
            Console
          </button>
        </div>
      </div>

      {error && <p className="foundry-error">{error}</p>}

      <div className="filter-row">
        <select className="select-input" value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="">Every kind</option>
          {(data?.kinds || []).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select className="select-input" value={botSlug} onChange={(event) => setBotSlug(event.target.value)}>
          <option value="">Every bot</option>
          {(data?.bots || []).map((bot) => (
            <option key={bot.slug} value={bot.slug}>
              {bot.name}
            </option>
          ))}
        </select>
        {(kind || botSlug) && (
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              setKind('')
              setBotSlug('')
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="foundry-log activity-page-log">
        {!events.length && !busy && <p className="foundry-empty">Nothing matches that filter yet.</p>}
        {grouped.map(([label, list]) => (
          <div className="activity-day" key={label}>
            <h4 className="activity-day-label">{label}</h4>
            <ul>
              {list.map((event) => (
                <li key={event.id}>
                  <span className="log-time">{timeOnly(event.at)}</span>
                  <span className={`dot ${KIND_TONE[event.kind] || 'blue'}`} aria-hidden="true" />
                  <span className="activity-text">
                    {event.message}
                    {event.botSlug && (
                      <button
                        type="button"
                        className="bot-link"
                        onClick={() => {
                          window.location.hash = `#/bot/${event.botSlug}`
                        }}
                      >
                        {event.botName}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {data?.hasMore && (
        <div className="page-actions center">
          <button type="button" className="secondary-btn" onClick={() => load({ append: true })} disabled={busy}>
            {busy ? 'Loading…' : 'Load older'}
          </button>
        </div>
      )}
    </section>
  )
}
