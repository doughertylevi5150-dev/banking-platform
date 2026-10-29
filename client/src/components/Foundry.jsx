import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  decideProposal,
  draftProposals,
  fetchFoundry,
  retireBot,
  runFeed,
  setBotAccount,
  toggleBot,
} from '../api/foundryApi'

// Where the owner actually gets each provider's key. Opening a link is not a connection.
const PROVIDER_LINKS = {
  Kraken: 'https://pro.kraken.com/app/settings/api',
  OpenSea: 'https://opensea.io/settings/developer',
  Mercury: 'https://app.mercury.com/settings/api',
  'Stripe Radar': 'https://dashboard.stripe.com/apikeys',
  Gusto: 'https://dev.gusto.com',
  Plaid: 'https://dashboard.plaid.com/team/keys',
}

const RISK_CLASS = { Low: 'risk-low', Medium: 'risk-mid', High: 'risk-high' }
const AUTO_DRAFT_MS = 60_000
const POLL_MS = 12_000

function money(value) {
  return `$${Math.round(value || 0).toLocaleString()}`
}

function clock(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

function Foundry({ token }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [openBot, setOpenBot] = useState(null)
  const [note, setNote] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [feed, setFeed] = useState(null)
  const [feedBusy, setFeedBusy] = useState(false)
  const mountedAt = useRef(Date.now())

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      try {
        const next = await fetchFoundry(token)
        setData(next)
        setError('')
        return next
      } catch (problem) {
        if (!quiet) setError(problem.message)
        return null
      }
    },
    [token],
  )

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const poll = setInterval(() => load({ quiet: true }), POLL_MS)
    return () => clearInterval(poll)
  }, [load])

  useEffect(() => {
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - mountedAt.current) / 1000)), 1000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    if (!note) return undefined
    const timer = setTimeout(() => setNote(''), 3200)
    return () => clearTimeout(timer)
  }, [note])

  // The Think Bot keeps drafting while the console is open, at most one batch a minute.
  useEffect(() => {
    const draft = setInterval(async () => {
      if (!data || data.totals.pending >= 3) return
      try {
        const result = await draftProposals(token, 1)
        if (result?.drafted) {
          await load({ quiet: true })
          setNote('Think Bot added a new concept to your queue.')
        }
      } catch {
        // Silent: the background job keeps the queue moving even if this misses.
      }
    }, AUTO_DRAFT_MS)

    return () => clearInterval(draft)
  }, [data, load, token])

  async function handleDraft() {
    setBusy('draft')
    try {
      const result = await draftProposals(token, 2)
      await load({ quiet: true })
      setNote(result?.drafted ? `${result.drafted} new concept${result.drafted > 1 ? 's' : ''} drafted.` : 'Nothing new to draft yet.')
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy('')
    }
  }

  async function handleDecide(proposal, decision) {
    setBusy(proposal.id)
    try {
      await decideProposal(token, proposal.id, decision)
      await load({ quiet: true })
      setNote(decision === 'approve' ? `${proposal.title} is running.` : `Passed on ${proposal.title}.`)
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy('')
    }
  }

  async function handleFeed() {
    setFeedBusy(true)
    try {
      const result = await runFeed(token)
      setFeed({ line: result.line, at: result.at })
      await load({ quiet: true })
      setNote('Scraper Bot read the live market.')
    } catch (problem) {
      setError(problem.message)
    } finally {
      setFeedBusy(false)
    }
  }

  async function handleAccount(bot, status) {
    setBusy(bot.id)
    try {
      await setBotAccount(token, bot.id, status, bot.accountProvider)
      await load({ quiet: true })
      setNote(
        status === 'connected'
          ? `${bot.name} marked live on ${bot.accountProvider || 'your own account'}.`
          : `${bot.name} is back on the waiting list.`,
      )
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy('')
    }
  }

  async function handleToggle(bot) {
    setBusy(bot.id)
    try {
      const result = await toggleBot(token, bot.id)
      await load({ quiet: true })
      setNote(`${bot.name} ${result.status === 'running' ? 'resumed' : 'paused'}.`)
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy('')
    }
  }

  async function handleRetire(bot) {
    setBusy(bot.id)
    try {
      await retireBot(token, bot.id)
      await load({ quiet: true })
      setNote(`${bot.name} retired.`)
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy('')
    }
  }

  const groups = useMemo(() => {
    const map = new Map()
    for (const bot of data?.bots || []) {
      if (bot.status === 'retired') continue
      const list = map.get(bot.classLabel) || []
      list.push(bot)
      map.set(bot.classLabel, list)
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [data])

  const totals = data?.totals
  const proposals = data?.proposals || []
  const scraper = (data?.bots || []).find((bot) => bot.slug === 'scraper')
  const liveRead = feed || (scraper?.lastResult ? { line: scraper.lastResult, at: scraper.lastRun } : null)

  return (
    <section className="section foundry" id="foundry">
      <div className="foundry-head">
        <div>
          <h2>Bot foundry</h2>
          <p className="foundry-sub">
            The Think Bot drafts, you decide. Nothing joins the swarm without your say-so.
          </p>
        </div>
        <span className="live-chip">
          <span className="live-dot" aria-hidden="true" />
          live · {clock(elapsed)}
        </span>
      </div>

      <div className="foundry-stats">
        <div className="foundry-stat">
          <span className="mini-label">Bots in the swarm</span>
          <strong>{totals ? totals.running + totals.paused : '—'}</strong>
          <span className="foundry-delta">{totals ? `${totals.running} running · ${totals.paused} paused` : 'loading'}</span>
        </div>
        <div className="foundry-stat">
          <span className="mini-label">Waiting on you</span>
          <strong>{totals ? totals.pending : '—'}</strong>
          <span className="foundry-delta">{totals ? `${totals.decided} decided so far` : 'loading'}</span>
        </div>
        <div className="foundry-stat">
          <span className="mini-label">Accounts live</span>
          <strong>{totals ? `${totals.connected}/${(data?.bots || []).length}` : '—'}</strong>
          <span className="foundry-delta">{totals ? `${totals.awaitingAccount} still need one` : 'loading'}</span>
        </div>
        <div className="foundry-stat">
          <span className="mini-label">Projected each month</span>
          <strong>{totals ? money(totals.projected) : '—'}</strong>
          <span className="foundry-delta">sum of the running bots’ own plans</span>
        </div>
      </div>

      {error && <p className="foundry-error">{error}</p>}

      <div className="foundry-columns">
        <div className="foundry-panel">
          <div className="foundry-panel-head">
            <h3>Decision queue</h3>
            <button type="button" className="ghost-btn foundry-draft" onClick={handleDraft} disabled={busy === 'draft'}>
              {busy === 'draft' ? 'Drafting…' : 'Ask for ideas'}
            </button>
          </div>

          {!proposals.length && <p className="foundry-empty">Nothing waiting. The Think Bot drafts on its own within a minute.</p>}

          <div className="proposal-list">
            {proposals.map((proposal) => (
              <article className="proposal-card" key={proposal.id}>
                <div className="proposal-top">
                  <span className="bot-badge blue">{proposal.classLabel}</span>
                  <span className={`risk-tag ${RISK_CLASS[proposal.riskLevel] || 'risk-low'}`}>{proposal.riskLevel} risk</span>
                </div>
                <h4>{proposal.title}</h4>
                <p>{proposal.charter}</p>
                <dl className="proposal-facts">
                  <div>
                    <dt>Revenue</dt>
                    <dd>{proposal.revenueModel}</dd>
                  </div>
                  <div>
                    <dt>Est. monthly</dt>
                    <dd>{proposal.estMonthly ? money(proposal.estMonthly) : 'Indirect'}</dd>
                  </div>
                </dl>
                <div className="proposal-actions">
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => handleDecide(proposal, 'approve')}
                    disabled={busy === proposal.id}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => handleDecide(proposal, 'reject')}
                    disabled={busy === proposal.id}
                  >
                    Pass
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="foundry-panel" id="swarm">
          <div className="foundry-panel-head">
            <h3>The swarm</h3>
            <span className="foundry-count">{totals ? `${totals.running} awake` : ''}</span>
          </div>

          <div className="swarm">
            {groups.map(([label, list]) => (
              <div className="swarm-group" key={label}>
                <span className="swarm-label">{label}</span>
                <div className="swarm-list">
                  {list.map((bot) => {
                    const isOpen = openBot === bot.id
                    return (
                      <div className={`swarm-bot${isOpen ? ' is-open' : ''}`} key={bot.id}>
                        <button
                          type="button"
                          className="swarm-row"
                          onClick={() => setOpenBot(isOpen ? null : bot.id)}
                          aria-expanded={isOpen}
                        >
                          <span className={`status-dot ${bot.status === 'running' ? 'on' : 'off'}`} aria-hidden="true" />
                          <span className="swarm-name">{bot.name}</span>
                          <span className="swarm-status">{bot.status === 'running' ? 'Running' : 'Paused'}</span>
                        </button>

                        {isOpen && (
                          <div className="swarm-detail">
                            <p>{bot.charter}</p>
                            <p className="swarm-fact">
                              <strong>Revenue:</strong> {bot.revenueModel}
                              {bot.estMonthly ? ` · ${money(bot.estMonthly)}/mo` : ''}
                            </p>
                            <p className="swarm-fact">
                              <strong>Last:</strong> {bot.lastAction || 'Charter written.'}
                            </p>
                            <div className="bot-actions">
                              <button
                                type="button"
                                className="secondary-btn"
                                onClick={() => handleToggle(bot)}
                                disabled={busy === bot.id}
                              >
                                {bot.status === 'running' ? 'Pause' : 'Resume'}
                              </button>
                              <button
                                type="button"
                                className="ghost-btn"
                                onClick={() => handleRetire(bot)}
                                disabled={busy === bot.id}
                              >
                                Retire
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="foundry-log accounts-panel">
        <div className="foundry-panel-head">
          <h3>Accounts</h3>
          <button type="button" className="ghost-btn foundry-draft" onClick={handleFeed} disabled={feedBusy}>
            {feedBusy ? 'Reading…' : 'Run a live read'}
          </button>
        </div>

        <p className="foundry-empty">
          {liveRead
            ? `Scraper Bot at ${new Date(liveRead.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: ${liveRead.line}`
            : 'Scraper Bot needs no account. Run a live read to pull real prices now.'}
        </p>

        <ul className="account-list">
          {(data?.bots || []).map((bot) => {
            const link = PROVIDER_LINKS[bot.accountProvider]
            return (
              <li key={bot.id} className={`account-row is-${bot.accountStatus}`}>
                <span className={`status-dot ${bot.accountStatus === 'connected' ? 'on' : bot.accountStatus === 'needed' ? 'off' : 'idle'}`} aria-hidden="true" />
                <div className="account-main">
                  <span className="account-name">{bot.name}</span>
                  <span className="account-need">
                    {bot.accountStatus === 'connected'
                      ? `Live on ${bot.accountProvider || 'your own account'}`
                      : bot.accountStatus === 'needed'
                        ? `Needs ${bot.accountProvider || 'an account'}: ${bot.accountNeeds}`
                        : bot.accountNeeds || 'No account needed.'}
                  </span>
                </div>
                <div className="account-actions">
                  {bot.accountStatus !== 'connected' && link && (
                    <a className="ghost-btn account-link" href={link} target="_blank" rel="noreferrer">
                      Get key
                    </a>
                  )}
                  {bot.accountStatus === 'connected' ? (
                    <button type="button" className="ghost-btn" onClick={() => handleAccount(bot, 'needed')} disabled={busy === bot.id}>
                      Revoke
                    </button>
                  ) : (
                    <button type="button" className="secondary-btn account-connect" onClick={() => handleAccount(bot, 'connected')} disabled={busy === bot.id}>
                      Mark live
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="foundry-log">
        <h3>What the swarm just did</h3>
        <ul>
          {(data?.events || []).slice(0, 8).map((event) => (
            <li key={event.id}>
              <span className="log-time">
                {new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span>{event.message}</span>
            </li>
          ))}
          {!data?.events?.length && <li className="foundry-empty">No activity yet.</li>}
        </ul>
      </div>

      {note && (
        <p className="console-note" role="status">
          {note}
        </p>
      )}
    </section>
  )
}

export default Foundry
