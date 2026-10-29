import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchFunding, fetchFoundry, setFundingStatus } from '../api/foundryApi'
import { compact, money, stamp } from '../lib/format'

const KIND_LABEL = {
  loan: 'Loan',
  credit: 'Credit',
  grant: 'Grant',
  credits: 'Credits',
  equity: 'Equity',
  revenue: 'Revenue',
}

const STATUS_FLOW = ['idea', 'preparing', 'ready', 'filed', 'approved', 'declined', 'skipped']
const STATUS_LABEL = {
  idea: 'Idea',
  preparing: 'Preparing',
  ready: 'Ready to sign',
  filed: 'Filed',
  approved: 'Approved',
  declined: 'Declined',
  skipped: 'Passed',
}

// Ranked the way Fund Bot ranks: fast, cheap, non-dilutive first.
function score(route) {
  let value = 0
  if (route.kind === 'credits' || route.kind === 'grant') value += 40
  if (route.kind === 'revenue') value += 30
  if (route.kind === 'loan') value += 12
  if (route.kind === 'credit') value += 18
  if (route.kind === 'equity') value -= 20
  if (route.effort === 'Low') value += 25
  if (route.effort === 'Medium') value += 10
  value += Math.min(Number(route.est_amount) / 5000, 20)
  if (route.status === 'ready') value += 60
  if (route.status === 'preparing') value += 40
  if (['filed', 'approved', 'skipped', 'declined'].includes(route.status)) value -= 100
  return value
}

function packetFor(route, totals) {
  const swarm = totals?.bots || []
  const running = swarm.length
  const projected = totals?.projected || 0
  const requested = Number(route.est_amount) || 0
  const annual = Math.round(projected * 12)

  return [
    `APPLICATION PACKET — ${route.title}`,
    `Route: ${KIND_LABEL[route.kind] || route.kind} · Requested: ${money(requested)} · Timeline: ${route.timeline}`,
    '',
    '1. WHAT THE BUSINESS IS',
    'LevisBotUniverse is an owner-operated console that runs a swarm of specialised autonomous finance bots. Each bot owns one narrow job (market reads, treasury sweeps, invoice chasing, fraud scoring, fee auditing) and reports to a single owner who approves every decision. The platform sells access to that swarm, not to a promise of returns.',
    `Today the console runs ${running} bots with ${money(projected)} of projected monthly revenue across the running ones.`,
    '',
    '2. WHAT THE MONEY BUYS',
    requested
      ? `The ${money(requested)} covers: provider access and API costs across the bot swarm, secure key handling and infrastructure, and the engineering time to move each bot from chartered to earning. No owner draw is included in the request.`
      : 'This route removes cost rather than adding cash: it offsets infrastructure and provider fees directly.',
    '',
    '3. HOW IT REPAYS',
    route.kind === 'loan' || route.kind === 'credit'
      ? `Repayment comes from bot revenue, not from a draw. At the current projection of ${money(annual)} a year, a ${money(requested)} request is covered inside the first year even at half the projection.`
      : route.kind === 'equity'
        ? 'This route is equity, so the cost is dilution and portal fees, repaid to investors through the value of the platform itself.'
        : 'There is nothing to repay on this route. The obligation is delivery and reporting.',
    '',
    '4. THE NUMBERS',
    `Bots in the swarm: ${running}`,
    `Projected monthly revenue: ${money(projected)}`,
    `Projected annual revenue: ${money(annual)}`,
    `Requested: ${money(requested)}`,
    '',
    '5. WHAT IS ALREADY IN PLACE',
    'Owner-only authentication with one account and no public sign-up · an auditable activity log of every bot action · per-bot earnings ledger · live provider reads where keys exist · every spending action gated on owner approval.',
    '',
    '6. WHAT THEY WILL ASK FOR',
    route.requirements
      .split('·')
      .map((item) => `  [ ] ${item.trim()}`)
      .join('\n'),
    '',
    'Filed by the owner. Fund Bot assembles the packet and the checklist; it never signs or submits.',
  ].join('\n')
}

export default function FundingPage({ token, onJump, focusRoute }) {
  const [data, setData] = useState(null)
  const [totals, setTotals] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [filter, setFilter] = useState('all')
  const [openRoute, setOpenRoute] = useState('')
  const [packet, setPacket] = useState(null)

  const load = useCallback(async () => {
    try {
      const [funding, state] = await Promise.all([fetchFunding(token), fetchFoundry(token)])
      setData(funding)
      setTotals(state)
      setError('')
    } catch (problem) {
      setError(problem.message)
    }
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!focusRoute) return
    setOpenRoute(focusRoute)
    const route = (data?.routes || []).find((item) => item.route === focusRoute)
    if (route) setPacket({ route, text: packetFor(route, totals) })
    // Only react when the console hands over a specific route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRoute, data])

  const routes = useMemo(() => {
    const list = data?.routes || []
    const scoped = filter === 'all' ? list : list.filter((route) => route.status === filter)
    return [...scoped].sort((a, b) => score(b) - score(a))
  }, [data, filter])

  const next = useMemo(
    () => (data?.routes || []).filter((route) => ['idea', 'preparing', 'ready'].includes(route.status)).sort((a, b) => score(b) - score(a)).slice(0, 3),
    [data],
  )

  async function move(route, status) {
    setBusy(route.route + status)
    try {
      const result = await setFundingStatus(token, route.route, status)
      setData(result)
      setError('')
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy('')
    }
  }

  async function copyPacket(route) {
    const text = packetFor(route, totals)
    setPacket({ route, text })
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Copying is a convenience; the packet stays on screen either way.
    }
  }

  const summary = data?.summary

  return (
    <section className="section page">
      <div className="page-head">
        <div>
          <span className="pill">Fund Bot</span>
          <h2>Money for the platform</h2>
          <p className="page-sub">
            Fund Bot reads every honest route, ranks it for a business at this stage, and builds the packet. You sign
            and file; nothing here applies for credit in your name.
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              const route = next[0]
              if (!route) return
              move(route, route.status === 'idea' ? 'preparing' : 'ready')
              copyPacket(route)
            }}
            disabled={!next.length}
          >
            Start next application
          </button>
          <button type="button" className="ghost-btn" onClick={() => onJump('console')}>
            Console
          </button>
        </div>
      </div>

      {error && <p className="foundry-error">{error}</p>}

      <div className="foundry-stats">
        <div className="foundry-stat">
          <span className="mini-label">Approved</span>
          <strong>{summary ? money(summary.approvedAmount) : '—'}</strong>
          <span className="foundry-delta">{summary ? `${summary.approved} route${summary.approved === 1 ? '' : 's'} through` : 'loading'}</span>
        </div>
        <div className="foundry-stat">
          <span className="mini-label">Pipeline</span>
          <strong>{summary ? money(summary.pipeline) : '—'}</strong>
          <span className="foundry-delta">{summary ? `${summary.filed} filed · ${summary.ready} ready to sign` : 'loading'}</span>
        </div>
        <div className="foundry-stat">
          <span className="mini-label">Still on the table</span>
          <strong>{summary ? money(summary.available) : '—'}</strong>
          <span className="foundry-delta">{summary ? `${summary.routes} routes ranked` : 'loading'}</span>
        </div>
        <div className="foundry-stat">
          <span className="mini-label">In motion</span>
          <strong>{summary ? summary.preparing : '—'}</strong>
          <span className="foundry-delta">packets being built</span>
        </div>
      </div>

      <div className="foundry-columns">
        <div className="foundry-panel">
          <div className="foundry-panel-head">
            <h3>What Fund Bot would file next</h3>
            <span className="foundry-count">{next.length ? `${next.length} ready` : ''}</span>
          </div>
          {!next.length && <p className="foundry-empty">Everything ranked is either filed or passed. Say the word and Fund Bot looks again.</p>}
          <div className="proposal-list">
            {next.map((route) => (
              <article className="proposal-card" key={route.route}>
                <div className="proposal-top">
                  <span className={`bot-badge ${route.kind === 'grant' || route.kind === 'credits' ? 'green' : route.kind === 'equity' ? 'purple' : 'blue'}`}>
                    {KIND_LABEL[route.kind] || route.kind}
                  </span>
                  <span className={`risk-tag ${route.effort === 'Low' ? 'risk-low' : route.effort === 'Medium' ? 'risk-mid' : 'risk-high'}`}>
                    {route.effort} effort
                  </span>
                </div>
                <h4>{route.title}</h4>
                <p>{route.why}</p>
                <dl className="proposal-facts">
                  <div>
                    <dt>Amount</dt>
                    <dd>{compact(route.est_amount)}</dd>
                  </div>
                  <div>
                    <dt>Cost</dt>
                    <dd>{route.cost}</dd>
                  </div>
                  <div>
                    <dt>Timeline</dt>
                    <dd>{route.timeline}</dd>
                  </div>
                </dl>
                <div className="proposal-actions">
                  <button type="button" className="primary-btn" onClick={() => copyPacket(route)}>
                    Build packet
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => move(route, route.status === 'idea' ? 'preparing' : 'ready')}
                    disabled={busy === route.route + (route.status === 'idea' ? 'preparing' : 'ready')}
                  >
                    {route.status === 'idea' ? 'Start packet' : 'Mark ready'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="foundry-panel">
          <div className="foundry-panel-head">
            <h3>All routes</h3>
            <select className="select-input" value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">Every status</option>
              {STATUS_FLOW.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          </div>

          <ul className="route-list">
            {routes.map((route) => {
              const isOpen = openRoute === route.route
              return (
                <li key={route.route} className={`route-row is-${route.status}`}>
                  <button type="button" className="route-main" onClick={() => setOpenRoute(isOpen ? '' : route.route)} aria-expanded={isOpen}>
                    <span className={`status-dot ${route.status === 'approved' ? 'on' : route.status === 'filed' || route.status === 'ready' ? 'idle' : 'off'}`} aria-hidden="true" />
                    <span className="route-title">{route.title}</span>
                    <span className="route-amount">{compact(route.est_amount)}</span>
                    <span className={`route-status tag-${route.status}`}>{STATUS_LABEL[route.status]}</span>
                  </button>

                  {isOpen && (
                    <div className="route-detail">
                      <p>{route.why}</p>
                      <p className="swarm-fact">
                        <strong>Cost:</strong> {route.cost} · <strong>Timeline:</strong> {route.timeline} ·{' '}
                        <strong>Effort:</strong> {route.effort}
                      </p>
                      <p className="swarm-fact">
                        <strong>They will ask for:</strong> {route.requirements}
                      </p>
                      {route.notes && <p className="swarm-fact"><strong>Note:</strong> {route.notes}</p>}
                      <p className="route-updated">{route.updated ? `updated ${stamp(route.updated)}` : 'not started'}</p>
                      <div className="bot-actions route-actions">
                        <button type="button" className="ghost-btn" onClick={() => copyPacket(route)}>
                          Build packet
                        </button>
                        {['preparing', 'ready', 'filed', 'approved', 'declined'].map((status) => (
                          <button
                            key={status}
                            type="button"
                            className="ghost-btn"
                            onClick={() => move(route, status)}
                            disabled={busy === route.route + status || route.status === status}
                          >
                            {STATUS_LABEL[status]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      {packet && (
        <div className="packet-panel">
          <div className="foundry-panel-head">
            <h3>{packet.route.title} packet</h3>
            <div className="page-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => navigator.clipboard?.writeText(packet.text).catch(() => {})}
              >
                Copy again
              </button>
              <button type="button" className="ghost-btn" onClick={() => setPacket(null)}>
                Close
              </button>
            </div>
          </div>
          <pre className="packet-body">{packet.text}</pre>
          <p className="packet-note">
            Fund Bot assembled this from the console's own numbers. Review it, correct anything that is not true, then
            file it yourself.
          </p>
        </div>
      )}
    </section>
  )
}
