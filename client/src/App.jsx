import { useState } from 'react'
import { clearSession, loadSession, saveSession } from './auth/session'
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

function App() {
  const [session, setSession] = useState(() => loadSession())

  function handleSignIn(email, { remember = true } = {}) {
    setSession(saveSession(email, remember))
  }

  function handleSignOut() {
    clearSession()
    setSession(null)
  }

  if (!session) {
    return <LoginPage onSignIn={handleSignIn} />
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-wrap">
          <div className="brand-mark">LU</div>
          <div>
            <div className="brand-name">LevisBotUniverse</div>
            <div className="brand-tag">Autonomous banking operations</div>
          </div>
        </div>
        <div className="hero-actions">
          <span className="session-chip" title={`Signed in since ${new Date(session.signedInAt).toLocaleString()}`}>
            {session.email}
          </span>
          <LoginButton label="Log out" onClick={handleSignOut} />
          <PushButton>Control hub</PushButton>
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
              <button type="button" className="primary-btn">
                Open dashboard
              </button>
              <button type="button" className="secondary-btn">
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

        <section className="stats">
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
            {bots.map((bot) => (
              <article className="bot-card" key={bot.id}>
                <span className={`bot-badge ${bot.badgeClass}`}>{bot.badge}</span>
                <h3>{bot.title}</h3>
                <p>{bot.description}</p>
                <div className="bot-meta">
                  <span>{bot.status}</span>
                  <span>{bot.detail}</span>
                </div>
                <button type="button" className="ghost-btn">
                  Open bot
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Recent activity</h2>
            <a href="#activity">Full log</a>
          </div>
          <div className="activity-list" id="activity">
            {activity.map((item) => (
              <div className="activity-item" key={item.title}>
                <span className={`dot ${item.dot}`} />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
