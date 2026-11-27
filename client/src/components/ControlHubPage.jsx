import { useCallback, useEffect, useState } from 'react'
import {
  connectAiKey,
  decideApproval,
  listApprovals,
  listBots,
  listRuns,
  rateRun,
  runBot,
  setBotStatus,
} from '../api/hubApi'

const STATUSES = ['off', 'test', 'live']

function when(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function money(amount) {
  if (amount == null) return ''
  return Number(amount).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

/** Paste the free Gemini key once; it is checked with Google and stored encrypted in Supabase Vault. */
function AiKeyBox({ token, onDone }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e) {
    e.preventDefault()
    if (!key.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await connectAiKey(token, key.trim())
      setKey('')
      onDone?.()
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="hub-card hub-keybox" onSubmit={save}>
      <p className="hub-flag">AI key not connected yet. Bots answer once the free Gemini key is added.</p>
      <p className="hub-muted">Paste the key from aistudio.google.com/apikey (it starts with AIza). It is checked with Google, then stored encrypted. It is never shown again.</p>
      <div className="hub-compose">
        <input className="login-input" type="password" autoComplete="off" value={key} placeholder="AIza…" onChange={(e) => setKey(e.target.value)} />
        <button className="primary-btn" type="submit" disabled={busy || !key.trim()}>{busy ? 'Checking…' : 'Connect'}</button>
      </div>
      {error && <p className="hub-error">{error}</p>}
    </form>
  )
}

/** One bot's test chat. MissedCall starts with a simulated missed call. */
function TestChat({ token, bot, onRan }) {
  const isMissedCall = bot.slug === 'missedcall-bot'
  const [thread, setThread] = useState([])
  const [lead, setLead] = useState({})
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [meta, setMeta] = useState(null)

  async function send(message) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const history = thread.map((t) => ({ from: t.from, text: t.text }))
      const result = await runBot(token, bot.slug, message, history, lead)
      const next = [...thread]
      if (message) next.push({ from: 'caller', text: message })
      next.push({ from: 'bot', text: result.reply })
      setThread(next)
      if (result.lead) setLead(result.lead)
      setMeta(result)
      setText('')
      onRan?.()
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
  }

  if (bot.status === 'off') {
    return <p className="hub-muted">Switch this bot to test or live to try it.</p>
  }

  return (
    <div className="hub-chat">
      <div className="hub-thread">
        {thread.length === 0 && (
          <p className="hub-muted">
            {isMissedCall ? 'Press "Missed call" to start, then reply as the caller.' : 'Type a message to test this bot.'}
          </p>
        )}
        {thread.map((t, i) => (
          <div key={i} className={`hub-bubble ${t.from === 'bot' ? 'is-bot' : 'is-you'}`}>
            {t.text}
          </div>
        ))}
      </div>
      {meta?.intent && (
        <p className="hub-muted">
          Intent: <strong>{meta.intent}</strong>
          {meta.owner_alert ? ` · Owner alert: ${meta.owner_alert}` : ''}
        </p>
      )}
      {meta?.approval && <p className="hub-flag">Sent to Approvals: {meta.approval.summary}</p>}
      {error && <p className="hub-error">{error}</p>}
      <form
        className="hub-compose"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) send(text.trim())
        }}
      >
        {isMissedCall && thread.length === 0 ? (
          <button type="button" className="primary-btn" disabled={busy} onClick={() => send('')}>
            {busy ? 'Calling…' : 'Missed call'}
          </button>
        ) : (
          <>
            <input
              className="login-input"
              value={text}
              maxLength={600}
              placeholder="Type a message"
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="primary-btn" disabled={busy || !text.trim()}>
              {busy ? '…' : 'Send'}
            </button>
          </>
        )}
        {thread.length > 0 && (
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              setThread([])
              setLead({})
              setMeta(null)
              setError('')
            }}
          >
            Reset
          </button>
        )}
      </form>
    </div>
  )
}

export default function ControlHubPage({ token }) {
  const [data, setData] = useState(null)
  const [runs, setRuns] = useState([])
  const [approvals, setApprovals] = useState([])
  const [open, setOpen] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [tab, setTab] = useState('bots')

  const load = useCallback(async () => {
    try {
      const [list, r, a] = await Promise.all([listBots(token), listRuns(token, { limit: 40 }), listApprovals(token)])
      setData(list)
      setRuns(r.runs)
      setApprovals(a.approvals)
      setError('')
    } catch (problem) {
      setError(problem.message)
    }
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  async function changeStatus(slug, status) {
    try {
      await setBotStatus(token, slug, status)
      setNote(`Set to ${status}.`)
      load()
    } catch (problem) {
      setError(problem.message)
    }
  }

  async function thumbs(run, value) {
    const next = run.thumbs === value ? 0 : value
    try {
      const { run: saved } = await rateRun(token, run.id, next)
      setRuns((list) => list.map((r) => (r.id === run.id ? { ...r, ...saved } : r)))
    } catch (problem) {
      setError(problem.message)
    }
  }

  async function decide(id, decision) {
    try {
      const result = await decideApproval(token, id, decision)
      setNote(result.note || 'Saved.')
      load()
    } catch (problem) {
      setError(problem.message)
    }
  }

  const bots = data?.bots || []
  const names = Object.fromEntries(bots.map((b) => [b.slug, b.name]))

  return (
    <section className="section page hub" id="hub">
      <div className="page-head">
        <div>
          <span className="pill">Control Hub</span>
          <h2>Your bots</h2>
          <p className="page-sub">Switch bots off, test or live, try them, rate their answers, and decide anything that touches money.</p>
        </div>
      </div>

      {data && !data.aiConnected && <AiKeyBox token={token} onDone={load} />}
      {error && <p className="hub-error">{error}</p>}
      {note && <p className="hub-muted" role="status">{note}</p>}

      <div className="hub-tabs">
        <button type="button" className={tab === 'bots' ? 'is-on' : ''} onClick={() => setTab('bots')}>
          Bots
        </button>
        <button type="button" className={tab === 'runs' ? 'is-on' : ''} onClick={() => setTab('runs')}>
          Runs{data?.flaggedRuns ? ` · ${data.flaggedRuns} flagged` : ''}
        </button>
        <button type="button" className={tab === 'approvals' ? 'is-on' : ''} onClick={() => setTab('approvals')}>
          Approvals{approvals.length ? ` · ${approvals.length}` : ''}
        </button>
      </div>

      {!data && !error && <p className="hub-muted">Loading…</p>}

      {tab === 'bots' && (
        <div className="hub-list">
          {bots.map((bot) => (
            <article key={bot.slug} className="hub-card">
              <div className="hub-card-top">
                <div>
                  <h3>
                    {bot.name} <span className="hub-ver">{bot.version}</span>
                  </h3>
                  <p className="hub-muted">{bot.one_task}</p>
                  <p className="hub-score">Score: {bot.score || 'not graded'}</p>
                  <p className="hub-muted">
                    Last 7 days: {bot.week.runs} runs · 👍 {bot.week.up} · 👎 {bot.week.down}
                    {bot.publicDemo && bot.status === 'live' ? ' · public demo on' : ''}
                  </p>
                </div>
              </div>
              <div className="hub-seg" role="group" aria-label={`${bot.name} status`}>
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`hub-seg-btn is-${s}${bot.status === s ? ' is-on' : ''}`}
                    onClick={() => bot.status !== s && changeStatus(bot.slug, s)}
                  >
                    {s === 'off' ? 'Off' : s === 'test' ? 'Test' : 'Live'}
                  </button>
                ))}
              </div>
              <button type="button" className="ghost-btn hub-open" onClick={() => setOpen(open === bot.slug ? '' : bot.slug)}>
                {open === bot.slug ? 'Close test chat' : 'Test chat'}
              </button>
              {open === bot.slug && <TestChat token={token} bot={bot} onRan={load} />}
            </article>
          ))}
        </div>
      )}

      {tab === 'runs' && (
        <div className="hub-list">
          {runs.length === 0 && <p className="hub-muted">No runs yet.</p>}
          {runs.map((run) => (
            <article key={run.id} className={`hub-card${run.flagged ? ' is-flagged' : ''}`}>
              <p className="hub-muted">
                {names[run.bot] || run.bot} · {when(run.created_at)} · {run.source === 'public' ? 'public demo' : 'you'}
                {run.flagged ? ' · flagged for Evolver' : ''}
              </p>
              <p className="hub-in">{run.input}</p>
              <p className="hub-out">{run.output}</p>
              <div className="hub-thumbs">
                <button type="button" className={run.thumbs === 1 ? 'is-on' : ''} onClick={() => thumbs(run, 1)} aria-label="Good answer">
                  👍
                </button>
                <button type="button" className={run.thumbs === -1 ? 'is-on is-down' : ''} onClick={() => thumbs(run, -1)} aria-label="Bad answer">
                  👎
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {tab === 'approvals' && (
        <div className="hub-list">
          <p className="hub-muted">
            Bots never buy, sell, spend or commit on their own. Those requests wait here. Approving records your decision only; nothing is paid in this build.
          </p>
          {approvals.length === 0 && <p className="hub-muted">Nothing waiting on you.</p>}
          {approvals.map((a) => (
            <article key={a.id} className="hub-card">
              <p className="hub-muted">
                {names[a.bot] || a.bot} · {a.kind} · {when(a.created_at)}
              </p>
              <p className="hub-out">
                {a.summary} {a.amount != null && <strong>{money(a.amount)}</strong>}
              </p>
              <div className="hub-decide">
                <button type="button" className="primary-btn" onClick={() => decide(a.id, 'approve')}>
                  Approve
                </button>
                <button type="button" className="secondary-btn" onClick={() => decide(a.id, 'reject')}>
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
