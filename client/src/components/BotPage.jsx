import { useCallback, useEffect, useState } from 'react'
import { fetchBot, recordMoney, setBotAccount, toggleBot } from '../api/foundryApi'
import { money, stamp } from '../lib/format'

const RISK_CLASS = { Low: 'risk-low', Medium: 'risk-mid', High: 'risk-high' }

export default function BotPage({ token, slug, onJump }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [entryKind, setEntryKind] = useState('earning')

  const load = useCallback(async () => {
    try {
      setData(await fetchBot(token, slug))
      setError('')
    } catch (problem) {
      setError(problem.message)
    }
  }, [token, slug])

  useEffect(() => {
    load()
  }, [load])

  async function handleToggle() {
    setBusy('toggle')
    try {
      await toggleBot(token, data.bot.id)
      await load()
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy('')
    }
  }

  async function handleAccount(status) {
    setBusy('account')
    try {
      await setBotAccount(token, data.bot.id, status, data.bot.accountProvider)
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
      await recordMoney(token, { botSlug: data.bot.slug, kind: entryKind, amount: value, note })
      setAmount('')
      setNote('')
      await load()
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy('')
    }
  }

  if (!data) {
    return (
      <section className="section page">
        <div className="page-head">
          <h2>{error || 'Opening the bot…'}</h2>
        </div>
        {error && (
          <button type="button" className="secondary-btn" onClick={() => onJump('console')}>
            Back to the console
          </button>
        )}
      </section>
    )
  }

  const bot = data.bot

  return (
    <section className="section page">
      <div className="page-head">
        <div>
          <div className="breadcrumb">
            <button type="button" className="link-btn" onClick={() => onJump('console')}>
              Console
            </button>
            <span>/</span>
            <span>{bot.classLabel}</span>
          </div>
          <h2>{bot.name}</h2>
          <p className="page-sub">{bot.charter}</p>
        </div>
        <div className="page-actions">
          <span className={`status-chip ${bot.status === 'running' ? 'on' : 'off'}`}>
            {bot.status === 'running' ? 'Running' : 'Paused'}
          </span>
          <button type="button" className="secondary-btn" onClick={handleToggle} disabled={busy === 'toggle'}>
            {bot.status === 'running' ? 'Pause' : 'Resume'}
          </button>
        </div>
      </div>

      {error && <p className="foundry-error">{error}</p>}

      <div className="foundry-stats">
        <div className="foundry-stat">
          <span className="mini-label">Earned to date</span>
          <strong>{money(bot.earned)}</strong>
          <span className="foundry-delta">{money(bot.spent)} in costs</span>
        </div>
        <div className="foundry-stat">
          <span className="mini-label">Projected each month</span>
          <strong>{bot.estMonthly ? money(bot.estMonthly) : 'Indirect'}</strong>
          <span className="foundry-delta">{bot.revenueModel}</span>
        </div>
        <div className="foundry-stat">
          <span className="mini-label">Account</span>
          <strong className="small-strong">{bot.accountProvider || 'None needed'}</strong>
          <span className="foundry-delta">{bot.accountStatus === 'connected' ? 'live' : bot.accountStatus === 'needed' ? 'waiting on you' : 'no account needed'}</span>
        </div>
        <div className="foundry-stat">
          <span className="mini-label">Risk</span>
          <strong className="small-strong">{bot.riskLevel}</strong>
          <span className={`risk-tag ${RISK_CLASS[bot.riskLevel] || 'risk-low'}`}>{bot.riskLevel} risk</span>
        </div>
      </div>

      <div className="foundry-columns">
        <div className="foundry-panel">
          <div className="foundry-panel-head">
            <h3>How it runs</h3>
          </div>
          <dl className="detail-facts">
            <div>
              <dt>Last action</dt>
              <dd>{bot.lastAction || 'Charter written.'}</dd>
            </div>
            <div>
              <dt>Last run</dt>
              <dd>{bot.lastRun ? `${stamp(bot.lastRun)} — ${bot.lastResult || 'ran clean'}` : 'Not run yet'}</dd>
            </div>
            <div>
              <dt>Account needs</dt>
              <dd>{bot.accountNeeds || 'Nothing.'}</dd>
            </div>
            <div>
              <dt>In the swarm since</dt>
              <dd>{stamp(bot.createdAt)}</dd>
            </div>
          </dl>

          <div className="bot-actions">
            {bot.accountStatus === 'connected' ? (
              <button type="button" className="ghost-btn" onClick={() => handleAccount('needed')} disabled={busy === 'account'}>
                Revoke account
              </button>
            ) : (
              <button type="button" className="secondary-btn" onClick={() => handleAccount('connected')} disabled={busy === 'account'}>
                Mark live
              </button>
            )}
            {data.providers.map((provider) => (
              <a key={provider.id} className="ghost-btn account-link" href={provider.keyPage} target="_blank" rel="noreferrer">
                {provider.connected ? `${provider.label} key stored` : `Get ${provider.label} key`}
              </a>
            ))}
          </div>

          <form className="money-form" onSubmit={handleRecord}>
            <h4>Book money</h4>
            <div className="money-row">
              <select className="select-input" value={entryKind} onChange={(event) => setEntryKind(event.target.value)}>
                <option value="earning">Earned</option>
                <option value="expense">Spent</option>
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
            <h3>Ledger</h3>
            <span className="foundry-count">{data.entries.length}</span>
          </div>
          <ul className="money-list">
            {data.entries.map((entry) => (
              <li key={entry.id}>
                <span className={`dot ${entry.kind === 'earning' ? 'green' : 'amber'}`} aria-hidden="true" />
                <span className="money-kind">{entry.kind}</span>
                <span className="money-amount">{money(entry.amount, { cents: true })}</span>
                <span className="money-note">{entry.note || entry.source}</span>
                <span className="log-time">{stamp(entry.at)}</span>
              </li>
            ))}
            {!data.entries.length && <li className="foundry-empty">No money booked for this bot yet.</li>}
          </ul>
        </div>
      </div>

      <div className="foundry-log">
        <h3>History</h3>
        <ul>
          {data.events.map((event) => (
            <li key={event.id}>
              <span className="log-time">{stamp(event.at)}</span>
              <span>{event.message}</span>
            </li>
          ))}
          {!data.events.length && <li className="foundry-empty">No activity recorded for this bot yet.</li>}
        </ul>
      </div>
    </section>
  )
}
