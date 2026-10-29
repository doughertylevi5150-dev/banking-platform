import { useCallback, useEffect, useState } from 'react'
import { changePassword, claimOwner, fetchOwner, getStatus, signIn, signOut } from './api/authApi'
import { clearToken, loadToken, saveToken } from './auth/session'
import ActivityPage from './components/ActivityPage'
import BotPage from './components/BotPage'
import Foundry from './components/Foundry'
import FundingPage from './components/FundingPage'
import LoginButton from './components/LoginButton'
import LoginPage from './components/LoginPage'
import PushButton from './components/PushButton'
import TreasuryPage from './components/TreasuryPage'

const signalBars = [42, 68, 55, 84, 62, 96, 74, 58, 88, 66, 92, 78]

const groundRules = [
  { label: 'Every bot', value: 'Needs you' },
  { label: 'Think Bot', value: 'Drafts daily' },
  { label: 'Access', value: 'You only' },
]

const NAV = [
  { key: 'console', label: 'Console', hash: '#/' },
  { key: 'activity', label: 'Activity', hash: '#/activity' },
  { key: 'funding', label: 'Funding', hash: '#/funding' },
  { key: 'treasury', label: 'Treasury', hash: '#/treasury' },
]

// Shown in the topbar so it is obvious which build the browser is running.
const BUILD = 'v14'

function readRoute() {
  const raw = (typeof window === 'undefined' ? '' : window.location.hash).replace(/^#\/?/, '').replace(/\/$/, '')
  if (!raw) return { name: 'console', anchor: '' }
  if (raw === 'foundry' || raw === 'swarm') return { name: 'console', anchor: raw }

  const [head, tail] = raw.split('/')
  if (head === 'activity') return { name: 'activity' }
  if (head === 'funding') return { name: 'funding', route: tail || '' }
  if (head === 'treasury') return { name: 'treasury' }
  if (head === 'bot' && tail) return { name: 'bot', slug: tail }
  return { name: 'console', anchor: '' }
}

function App() {
  const [token, setToken] = useState(loadToken())
  const [owner, setOwner] = useState(null)
  const [checking, setChecking] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  const [busy, setBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [note, setNote] = useState('')
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwDone, setPwDone] = useState('')
  const [pwValues, setPwValues] = useState({ current: '', next: '' })
  const [route, setRoute] = useState(readRoute)

  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!note) return undefined
    const timer = setTimeout(() => setNote(''), 3200)
    return () => clearTimeout(timer)
  }, [note])

  // Anchor links like #foundry still have to land on the console section.
  useEffect(() => {
    if (route.name !== 'console' || !route.anchor) return
    const target = document.getElementById(route.anchor)
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [route])

  useEffect(() => {
    let cancelled = false

    async function restore() {
      try {
        const status = await getStatus()
        if (!cancelled) setSetupRequired(Boolean(status.setupRequired))
      } catch {
        // Offline or the API is not configured; the form reports it on submit.
      }

      const stored = loadToken()
      if (stored) {
        try {
          const { user } = await fetchOwner(stored)
          if (!cancelled) {
            setOwner(user)
            setToken(stored)
          }
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

  const jumpTo = useCallback((target) => {
    if (target === 'console' || target === 'activity' || target === 'funding' || target === 'treasury') {
      window.location.hash = target === 'console' ? '#/' : `#/${target}`
      if (target === 'console') window.scrollTo({ top: 0, behavior: 'smooth' })
      setNote(target === 'console' ? 'Back to the console.' : `Opened ${target}.`)
      return
    }
    window.location.hash = `#/${target}`
  }, [])

  const jumpToSection = useCallback((id) => {
    const target = document.getElementById(id)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setNote(id === 'swarm' ? 'Jumped to the swarm.' : 'Jumped to the foundry.')
  }, [])

  async function handleChangePassword(event) {
    event.preventDefault()
    setPwBusy(true)
    setPwError('')
    setPwDone('')

    try {
      await changePassword(token, pwValues.current, pwValues.next)
      setPwDone('Password updated. Use it the next time you sign in.')
      setPwValues({ current: '', next: '' })
    } catch (error) {
      setPwError(error.message)
    } finally {
      setPwBusy(false)
    }
  }

  function closePasswordPanel() {
    setPasswordOpen(false)
    setPwError('')
    setPwDone('')
    setPwValues({ current: '', next: '' })
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
        <nav className="topnav" aria-label="Sections">
          {NAV.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`topnav-link${route.name === item.key ? ' is-active' : ''}`}
              onClick={() => {
                window.location.hash = item.hash
                if (item.key === 'console') window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="hero-actions">
          <span className="session-chip" title={`Signed in as ${owner.email}`}>
            {owner.name || owner.email}
          </span>
          <LoginButton label="Password" onClick={() => setPasswordOpen(true)} ariaLabel="Change your password" />
          <LoginButton label="Log out" onClick={handleSignOut} />
          <PushButton onClick={() => jumpToSection('foundry')}>Control hub</PushButton>
        </div>
      </header>

      <main className="main">
        {route.name === 'console' && (
          <>
            <section className="hero">
              <div className="hero-copy">
                <span className="pill">Always on</span>
                <h1>A swarm that grows itself. You hold the keys.</h1>
                <p>
                  The Think Bot drafts new bots and revenue lines constantly. The swarm runs them. Every new idea waits
                  in your queue until you approve it, and anything that spends money asks first.
                </p>
                <div className="hero-actions">
                  <button type="button" className="primary-btn" onClick={() => jumpToSection('foundry')}>
                    Open the foundry
                  </button>
                  <button type="button" className="secondary-btn" onClick={() => jumpToSection('swarm')}>
                    Meet the swarm
                  </button>
                  <button type="button" className="ghost-btn" onClick={() => jumpTo('funding')}>
                    Fund Bot
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

            <Foundry token={token} onOpenBot={(slug) => jumpTo(`bot/${slug}`)} onOpenPage={jumpTo} />
          </>
        )}

        {route.name === 'activity' && <ActivityPage token={token} onJump={jumpTo} />}
        {route.name === 'funding' && <FundingPage token={token} onJump={jumpTo} focusRoute={route.route} />}
        {route.name === 'treasury' && <TreasuryPage token={token} onJump={jumpTo} />}
        {route.name === 'bot' && <BotPage token={token} slug={route.slug} onJump={jumpTo} />}
      </main>

      {passwordOpen && (
        <div className="pw-overlay" role="dialog" aria-modal="true" aria-label="Change password">
          <div className="auth-shell">
            <div className="login-card auth-card">
              <div className="auth-head">
                <h1>Change password</h1>
                <p>Signed in as {owner.email}. Pick a password only you know.</p>
              </div>

              {pwError && (
                <p className="auth-error" role="alert">
                  <span className="dot" />
                  {pwError}
                </p>
              )}

              {pwDone ? (
                <p className="pw-note" role="status">
                  {pwDone}
                </p>
              ) : null}

              <form className="auth-form" onSubmit={handleChangePassword} noValidate>
                <div className="login-field">
                  <label htmlFor="pw-current">Current password</label>
                  <input
                    id="pw-current"
                    className="login-input"
                    type="password"
                    autoComplete="current-password"
                    value={pwValues.current}
                    onChange={(event) => setPwValues((v) => ({ ...v, current: event.target.value }))}
                  />
                </div>

                <div className="login-field">
                  <label htmlFor="pw-next">New password</label>
                  <input
                    id="pw-next"
                    className="login-input"
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={pwValues.next}
                    onChange={(event) => setPwValues((v) => ({ ...v, next: event.target.value }))}
                  />
                </div>

                <div className="pw-actions">
                  <button className="primary-btn auth-submit" type="submit" disabled={pwBusy}>
                    {pwBusy ? 'Saving…' : 'Save password'}
                  </button>
                  <button className="secondary-btn" type="button" onClick={closePasswordPanel}>
                    Close
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {note && (
        <p className="console-note" role="status">
          {note}
        </p>
      )}
    </div>
  )
}

export default App
