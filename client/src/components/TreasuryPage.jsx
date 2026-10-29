import { useCallback, useEffect, useState } from 'react'
import { fetchTreasury, recordMoney, runLiveRead } from '../api/foundryApi'
import { money, stamp } from '../lib/format'

export default function TreasuryPage({ token, onJump }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [live, setLive] = useState(null)
  const [amount, setAmount] = useState('')
  const [slug, setSlug] = useState('treasury')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await fetchTreasury(token))
      setError('')
    } catch (problem) {
      setError(problem.message)
    }
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  async function handleLive() {
    setBusy('live')
    try {
      const result = await runLiveRead(token)
      setLive(result)
      await load()
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy('')
    }
  }

  async function handleRecord(event) {
    event.preventDefault()
    const value = Number(amount)
    if (!value) return
    setBusy('record')
    try {
      await recordMoney(token, { botSlug: slug, kind: 'earning', amount: value, note })
      setAmount('')
      setNote('')
      await load()
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy('')
    }
  }

  const providers = data?.providers || []

  return (
    <section className="section page">
      <div className="page-head">
        <div>
          <span className="pill">Treasury</span>
          <h2>What the money actually is</h2>
          <p className="page-sub">
            Two different numbers, kept apart on purpose: what the swarm has booked, and what a live provider read says
            is really sitting in the accounts.
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="secondary-btn" onClick={handleLive} disabled={busy === 'live'}>
            {busy === 'live' ? 'Reading…' : 'Run live read'}
          </button>
          <button type="button" className="ghost-btn" onClick={() => onJump('console')}>
            Console
          </button>
        </div>
      </div>

      {error && <p className="foundry-error">{error}</p>}

      <div className="foundry-stats">
        <div className="foundry-stat">
          <span className="mini-label">Booked earnings</span>
          <strong>{data ? money(data.cashIn) : '—'}</strong>
          <span className="foundry-delta">{data ? `${money(data.cashOut)} in costs booked` : 'loading'}</span>
        </div>
        <div className="foundry-stat">
          <span className="mini-label">Funding received</span>
          <strong>{data ? money(data.raised) : '—'}</strong>
          <span className="foundry-delta">approved loans and grants</span>
        </div>
        <div className="foundry-stat">
          <span className="mini-label">Net booked</span>
          <strong>{data ? money(data.net) : '—'}</strong>
          <span className="foundry-delta">earnings minus costs</span>
        </div>
        <div className="foundry-stat">
          <span className="mini-label">Live in accounts</span>
          <strong>{data ? money(data.liveBalance) : '—'}</strong>
          <span className="foundry-delta">{data?.liveAt ? `${data.liveProvider} at ${stamp(data.liveAt)}` : 'no live read yet'}</span>
        </div>
      </div>

      {live && (
        <div className="live-result">
          {live.results.map((result) => (
            <p key={result.id} className={result.ok ? 'is-ok' : 'is-off'}>
              <strong>{result.id}</strong>{' '}
              {result.ok
                ? `answered: ${money(result.total)} across ${result.holdings?.length || 0} holding(s)`
                : `did not answer — ${result.error}`}
            </p>
          ))}
        </div>
      )}

      <div className="foundry-columns">
        <div className="foundry-panel">
          <div className="foundry-panel-head">
            <h3>Providers</h3>
            <span className="foundry-count">
              {providers.filter((provider) => provider.connected).length}/{providers.length} wired
            </span>
          </div>
          <ul className="account-list">
            {providers.map((provider) => (
              <li key={provider.id} className={`account-row is-${provider.connected ? 'connected' : 'needed'}`}>
                <span className={`status-dot ${provider.connected ? 'on' : 'off'}`} aria-hidden="true" />
                <div className="account-main">
                  <span className="account-name">{provider.label}</span>
                  <span className="account-need">
                    {provider.connected
                      ? `${provider.wired ? 'Live reads on' : 'Key stored, sweep not built'} · ${provider.note}`
                      : `Needs ${provider.env.join(' + ')} · ${provider.note}`}
                  </span>
                </div>
                <div className="account-actions">
                  {!provider.connected && (
                    <a className="ghost-btn account-link" href={provider.keyPage} target="_blank" rel="noreferrer">
                      Get key
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <form className="money-form" onSubmit={handleRecord}>
            <h4>Book an earning</h4>
            <div className="money-row">
              <select className="select-input" value={slug} onChange={(event) => setSlug(event.target.value)}>
                {(data?.byBot || []).map((bot) => (
                  <option key={bot.slug} value={bot.slug}>
                    {bot.name}
                  </option>
                ))}
              </select>
              <input
                className="select-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <input
                className="select-input grow"
                placeholder="What for"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <button type="submit" className="secondary-btn" disabled={busy === 'record' || !amount}>
                Book it
              </button>
            </div>
          </form>
        </div>

        <div className="foundry-panel">
          <div className="foundry-panel-head">
            <h3>Earnings by bot</h3>
            <span className="foundry-count">{data ? data.byBot.length : ''}</span>
          </div>
          <ul className="earn-list">
            {(data?.byBot || []).map((bot) => {
              const ceiling = Math.max(...(data?.byBot || []).map((item) => Math.max(item.earned, item.estMonthly, 1)), 1)
              const width = Math.max((bot.earned / ceiling) * 100, bot.earned ? 4 : 0)
              return (
                <li key={bot.slug}>
                  <button
                    type="button"
                    className="link-btn earn-name"
                    onClick={() => {
                      window.location.hash = `#/bot/${bot.slug}`
                    }}
                  >
                    {bot.name}
                  </button>
                  <span className="earn-bar">
                    <span style={{ width: `${width}%` }} />
                  </span>
                  <span className="earn-value">{bot.earned ? money(bot.earned) : '—'}</span>
                  <span className="earn-projection">{bot.estMonthly ? `${money(bot.estMonthly)}/mo planned` : 'indirect'}</span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      <div className="foundry-log">
        <h3>Ledger</h3>
        <ul>
          {(data?.entries || []).map((entry) => (
            <li key={entry.id}>
              <span className="log-time">{stamp(entry.at)}</span>
              <span className={`dot ${entry.kind === 'earning' ? 'green' : entry.kind === 'expense' ? 'amber' : 'blue'}`} aria-hidden="true" />
              <span>
                {entry.kind === 'expense' ? '−' : '+'}
                {money(entry.amount, { cents: true })} · {entry.note || entry.kind}
                {entry.botSlug ? ` · ${entry.botSlug}` : ''}
              </span>
            </li>
          ))}
          {!data?.entries?.length && <li className="foundry-empty">Nothing booked yet.</li>}
        </ul>
      </div>
    </section>
  )
}
