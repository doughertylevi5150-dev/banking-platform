import { useEffect, useRef, useState } from 'react'
import { claimOwner, fetchOwner, getStatus, signIn, signOut } from './api/authApi'
import { clearToken, loadToken, saveToken } from './auth/session'
import Foundry from './components/Foundry'
import LoginButton from './components/LoginButton'
import LoginPage from './components/LoginPage'
import PushButton from './components/PushButton'

const signalBars = [42, 68, 55, 84, 62, 96, 74, 58, 88, 66, 92, 78]

const groundRules = [
  { label: 'Every bot', value: 'Needs you' },
  { label: 'Think Bot', value: 'Drafts daily' },
  { label: 'Access', value: 'You only' },
]

// Shown in the topbar so it is obvious which build the browser is running.
const BUILD = 'v9'

function App() {
  const initialToken = useRef(loadToken())
  const [token, setToken] = useState(initialToken.current)
  const [owner, setOwner] = useState(null)
  const [checking, setChecking] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  const [busy, setBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
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
    setNote(id === 'swarm' ? 'Jumped to the swarm.' : 'Jumped to the foundry.')
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
          <PushButton onClick={() => jumpTo('foundry')}>Control hub</PushButton>
        </div>
      </header>

      <main className="main">
        <section className="hero">
          <div className="hero-copy">
            <span className="pill">Always on</span>
            <h1>A swarm that grows itself. You hold the keys.</h1>
            <p>
              The Think Bot drafts new bots and revenue lines constantly. The swarm
              runs them. Every new idea waits in your queue until you approve it, and
              anything that spends money asks first.
            </p>
            <div className="hero-actions">
              <button type="button" className="primary-btn" onClick={() => jumpTo('foundry')}>
                Open the foundry
              </button>
              <button type="button" className="secondary-btn" onClick={() => jumpTo('swarm')}>
                Meet the swarm
              </button>
            </div>
          </div>

          <aside className="hero-panel">
            <div className="panel-header">
              <span>Swarm status</span>
              <span className="online-dot" aria-label="Online" />
            </div>
            <div className="mini-grid">
              {groundRules.map((item) => (
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

        <Foundry token={token} />
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
