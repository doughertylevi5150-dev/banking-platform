import { useEffect, useRef, useState } from 'react'
import { claimOwner, fetchOwner, getStatus, signIn, signOut } from './api/authApi'
import { clearToken, loadToken, saveToken } from './auth/session'
import LoginButton from './components/LoginButton'
import LoginPage from './components/LoginPage'
import PushButton from './components/PushButton'

const bots = [
  {
    id: 'treasury',
    badge: 'Treasury',
    badgeClass: 'blue',
    title: 'Treasury Bot',
    description:
      'Sweeps idle balances into the highest-yielding pockets every hour and keeps the checking buffer topped up.',
    status: 'Running',
    detail: 'Updated 2m ago',
  },
  {
    id: 'fraud',
    badge: 'Security',
    badgeClass: 'green',
    title: 'Fraud Watch',
    description:
      'Scores every card authorization in under 80ms and freezes anything that drifts from your normal pattern.',
    status: 'Running',
    detail: 'Updated 14s ago',
  },
  {
    id: 'payroll',
    badge: 'Operations',
    badgeClass: 'purple',
    title: 'Payroll Runner',
    description:
      'Queues payouts, checks funding, and files the ledger entries before the window closes each cycle.',
    status: 'Paused',
    detail: 'Resumes Nov 1',
  },
  {
    id: 'insights',
    badge: 'Insights',
    badgeClass: 'amber',
    title: 'Spend Analyst',
    description:
      'Tags transactions, flags recurring charges, and writes a plain-English weekly summary of where money went.',
    status: 'Running',
    detail: 'Updated 1h ago',
  },
]

const stats = [
  { value: '$482,910.44', label: 'Total balance across 1,204 accounts' },
  { value: '1,842', label: 'Transactions settled today' },
  { value: '12 / 14', label: 'Bots online right now' },
]

const miniStats = [
  { label: 'Active bots', value: '12' },
  { label: 'Tasks today', value: '348' },
  { label: 'Uptime', value: '99.98%' },
  { label: 'Avg response', value: '240ms' },
]

const activity = [
  {
    dot: 'green',
    title: 'Fraud Watch blocked a $1,240 charge',
    detail: 'Card ending 4417, merchant flagged as unusual for this account.',
  },
  {
    dot: 'blue',
    title: 'Treasury Bot moved $25,000',
    detail: 'Idle balance swept into the 4.6% reserve pocket.',
  },
  {
    dot: 'purple',
    title: 'Payroll Runner paused',
    detail: 'Waiting on funding confirmation before the next cycle.',
  },
]

const signalBars = [42, 68, 55, 84, 62, 96, 74, 58, 88, 66, 92, 78]

// Shown in the topbar so it is obvious which build the browser is running.
const BUILD = 'v7'

function App() {
  const initialToken = useRef(loadToken())
  const [token, setToken] = useState(initialToken.current)
  const [owner, setOwner] = useState(null)
  const [checking, setChecking] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  const [busy, setBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [botList, setBotList] = useState(bots)
  const [openBot, setOpenBot] = useState(null)
  const [feed, setFeed] = useState(activity)
  const [openActivity, setOpenActivity] = useState(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!note) return undefined
    const timer = setTimeout(() => setNote(''), 3200)
    return () => clearTimeout(timer)
  }, [note])

  useEffect(() => {
    let cancelled = false

    async function restore() {
      try {
        const status = await getStatus()
        if (!cancelled) setSetupRequired(Boolean(status.setupRequired))
      } catch {
        // Offline or the API is not configured; the form reports it on submit.
      }

      if (initialToken.current) {
        try {
          const { user } = await fetchOwner(initialToken.current)
          if (!cancelled) setOwner(user)
        } catch {
          clearToken()
          if (!cancelled) setToken(null)
        }
      }

      if (!cancelled) setChecking(false)
    }

    restore()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSignIn(email, password, remember) {
    setBusy(true)
    setAuthError('')
    setFieldErrors({})

    try {
      const result = await signIn(email, password)
      saveToken(result.token, remember)
      setToken(result.token)
      setOwner(result.user)
    } catch (error) {
      setAuthError(error.message)
      setFieldErrors(error.fields || {})
    } finally {
      setBusy(false)
    }
  }

  async function handleClaimOwner(values) {
    setBusy(true)
    setAuthError('')
    setFieldErrors({})

    try {
      const result = await claimOwner(values)
      saveToken(result.token, true)
      setToken(result.token)
      setOwner(result.user)
      setSetupRequired(false)
    } catch (error) {
      setAuthError(error.message)
      setFieldErrors(error.fields || {})
    } finally {
      setBusy(false)
    }
  }

  function jumpTo(id) {
    if (typeof document === 'undefined') return
    const target = document.getElementById(id)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setNote(id === 'bots' ? 'Jumped to your bots.' : 'Jumped to the overview.')
  }

  function toggleBot(id) {
    setOpenBot((current) => (current === id ? null : id))
  }

  function setBotRunning(id, running) {
    const bot = botList.find((item) => item.id === id)
    if (!bot) return

    setBotList((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              status: running ? 'Running' : 'Paused',
              detail: running ? 'Resumed just now' : 'Paused just now',
            }
          : item,
      ),
    )

    setFeed((current) =>
      [
        {
          dot: running ? 'green' : 'amber',
          title: `${bot.title} ${running ? 'resumed' : 'paused'}`,
          detail: running
            ? 'Picked its schedule back up from the console.'
            : 'Stopped on request from the console. Balances are untouched.',
        },
        ...current,
      ].slice(0, 6),
    )

    setNote(`${bot.title} ${running ? 'resumed' : 'paused'}.`)
  }

  function runBot(id) {
    const bot = botList.find((item) => item.id === id)
    if (!bot) return

    setFeed((current) =>
      [
        {
          dot: 'blue',
          title: `${bot.title} accepted a manual run`,
          detail: 'Queued from the console and picked up within a second.',
        },
        ...current,
      ].slice(0, 6),
    )

    setNote(`${bot.title} is working on it now.`)
  }

  async function handleSignOut() {
    const current = token
    clearToken()
    setToken(null)
    setOwner(null)

    try {
      if (current) await signOut(current)
    } catch {
      // The local token is already gone; a failed revoke should not trap the owner.
    }
  }

  if (checking) {
    return (
      <div className="auth-shell">
        <p className="auth-loading">Opening the console…</p>
      </div>
    )
  }

  if (!owner) {
    return (
      <LoginPage
        onSignIn={handleSignIn}
        onClaimOwner={handleClaimOwner}
        setupRequired={setupRequired}
        busy={busy}
        error={authError}
        fieldErrors={fieldErrors}
      />
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-wrap">
          <div className="brand-mark">LU</div>
          <div>
            <div className="brand-name">LevisBotUniverse</div>
            <div className="brand-tag">
              Autonomous banking operations <span className="build-tag">{BUILD}</span>
            </div>
          </div>
        </div>
        <div className="hero-actions">
          <span className="session-chip" title={`Signed in as ${owner.email}`}>
            {owner.name || owner.email}
          </span>
          <LoginButton label="Log out" onClick={handleSignOut} />
          <PushButton onClick={() => jumpTo('bots')}>Control hub</PushButton>
        </div>
      </header>

      <main className="main">
        <section className="hero">
          <div className="hero-copy">
            <span className="pill">Always on</span>
            <h1>Banking that runs itself.</h1>
            <p>
              A swarm of bots watches your balances, payments, and fraud signals
              around the clock, so the boring decisions are already made before you
              open the app.
            </p>
            <div className="hero-actions">
              <button type="button" className="primary-btn" onClick={() => jumpTo('overview')}>
                Open dashboard
              </button>
              <button type="button" className="secondary-btn" onClick={() => jumpTo('bots')}>
                Meet the bots
              </button>
            </div>
          </div>

          <aside className="hero-panel">
            <div className="panel-header">
              <span>Swarm status</span>
              <span className="online-dot" aria-label="Online" />
            </div>
            <div className="mini-grid">
              {miniStats.map((item) => (
                <div className="mini-card" key={item.label}>
                  <span className="mini-label">{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
            <div className="signal-bars">
              {signalBars.map((height, index) => (
                <span key={index} style={{ height: `${height}%` }} />
              ))}
            </div>
          </aside>
        </section>

        <section className="stats" id="overview">
          {stats.map((stat) => (
            <div className="stat-card" key={stat.label}>
              <div className="stat-value">{stat.value}</div>
              <div className="stat-label">{stat.label}</div>
            </div>
          ))}
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Your bots</h2>
            <a href="#bots">View all</a>
          </div>
          <div className="bot-grid" id="bots">
            {botList.map((bot) => {
              const isOpen = openBot === bot.id
              const isRunning = bot.status === 'Running'

              return (
                <article
                  className={`bot-card${isOpen ? ' is-open' : ''}`}
                  key={bot.id}
                  onClick={() => toggleBot(bot.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      toggleBot(bot.id)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                >
                  <span className={`bot-badge ${bot.badgeClass}`}>{bot.badge}</span>
                  <h3>{bot.title}</h3>
                  <p>{bot.description}</p>
                  <div className="bot-meta">
                    <span className={isRunning ? 'state-running' : 'state-paused'}>{bot.status}</span>
                    <span>{bot.detail}</span>
                  </div>

                  {isOpen && (
                    <div className="bot-detail">
                      <p>
                        Runs on a {bot.id === 'treasury' ? 'hourly' : 'steady'} schedule and keeps a full
                        trail of what it touched.
                      </p>
                      <div className="bot-actions">
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={(event) => {
                            event.stopPropagation()
                            setBotRunning(bot.id, !isRunning)
                          }}
                        >
                          {isRunning ? 'Pause bot' : 'Resume bot'}
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={(event) => {
                            event.stopPropagation()
                            runBot(bot.id)
                          }}
                        >
                          Run now
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    className="ghost-btn bot-open"
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleBot(bot.id)
                    }}
                  >
                    {isOpen ? 'Close bot' : 'Open bot'}
                  </button>
                </article>
              )
            })}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Recent activity</h2>
            <a href="#activity">Full log</a>
          </div>
          <div className="activity-list" id="activity">
            {feed.map((item) => {
              const isOpen = openActivity === item.title

              return (
                <div
                  className={`activity-item${isOpen ? ' is-open' : ''}`}
                  key={item.title}
                  onClick={() => setOpenActivity(isOpen ? null : item.title)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setOpenActivity(isOpen ? null : item.title)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                >
                  <span className={`dot ${item.dot}`} />
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                    {isOpen && (
                      <p className="activity-extra">
                        Logged {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·
                        Nothing leaves this console without your say-so.
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </main>

      {note && (
        <p className="console-note" role="status">
          {note}
        </p>
      )}
    </div>
  )
}

export default App
