import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { changePassword, claimOwner, fetchOwner, getStatus, signIn, signOut } from './api/authApi'
import { clearToken, loadToken, saveToken } from './auth/session'
import { runMaintenanceOnce, runSwarmNow, startSwarmTick } from './lib/swarmTick'
import CommandPalette from './components/CommandPalette'
import HeroPulse from './components/HeroPulse'
import LoginButton from './components/LoginButton'
import LoginPage from './components/LoginPage'
import PushButton from './components/PushButton'

// Each page loads only when it is opened, so the sign-in screen and the store
// no longer download the whole console up front.
const ActivityPage = lazy(() => import('./components/ActivityPage'))
const BotPage = lazy(() => import('./components/BotPage'))
const Foundry = lazy(() => import('./components/Foundry'))
const FundingPage = lazy(() => import('./components/FundingPage'))
const OperatorPage = lazy(() => import('./components/OperatorPage'))
const ProspectsPage = lazy(() => import('./components/ProspectsPage'))
const StorePage = lazy(() => import('./components/StorePage'))
const TreasuryPage = lazy(() => import('./components/TreasuryPage'))

// Warm the console pages in the background once the owner is in.
function prefetchPages() {
  import('./components/Foundry')
  import('./components/ActivityPage')
  import('./components/FundingPage')
  import('./components/TreasuryPage')
  import('./components/OperatorPage')
}

const pageFallback = <p className="auth-loading page-loading">Loading…</p>

const NAV = [
  { key: 'console', label: 'Console', hash: '#/' },
  { key: 'activity', label: 'Activity', hash: '#/activity' },
  { key: 'funding', label: 'Funding', hash: '#/funding' },
  { key: 'treasury', label: 'Treasury', hash: '#/treasury' },
  { key: 'operator', label: 'Operator', hash: '#/operator' },
  { key: 'prospects', label: 'Prospects', hash: '#/prospects' },
  { key: 'store', label: 'Store', hash: '#/store' },
]

// Shown in the topbar so it is obvious which build the browser is running.
const BUILD = 'v19'

function readRoute() {
  const empty = new URLSearchParams()
  if (typeof window === 'undefined') return { name: 'console', anchor: '', query: empty }

  // Stripe sends people back with a query string after the hash, so the query
  // has to be peeled off before the path is split.
  const raw = (window.location.hash || '').replace(/^#\/?/, '')
  const [pathPart, queryPart] = raw.split('?')
  const query = new URLSearchParams(queryPart || '')
  const path = pathPart.replace(/\/$/, '')

  if (!path) return { name: 'console', anchor: '', query }
  if (path === 'foundry' || path === 'swarm') return { name: 'console', anchor: path, query }

  const [head, tail] = path.split('/')
  if (head === 'store') return { name: 'store', query }
  if (head === 'activity') return { name: 'activity', query }
  if (head === 'funding') return { name: 'funding', route: tail || '', query }
  if (head === 'treasury') return { name: 'treasury', query }
  if (head === 'operator') return { name: 'operator', query }
  if (head === 'prospects') return { name: 'prospects', query }
  if (head === 'bot' && tail) return { name: 'bot', slug: tail, query }
  return { name: 'console', anchor: '', query }
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
  const [runBusy, setRunBusy] = useState(false)
  const [runNote, setRunNote] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwDone, setPwDone] = useState('')
  const [pwValues, setPwValues] = useState({ current: '', next: '' })
  const [route, setRoute] = useState(readRoute)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    if (owner) prefetchPages()
  }, [owner])

  // Ctrl+K / Cmd+K opens the command palette anywhere in the console.
  useEffect(() => {
    if (!owner) return undefined
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [owner])

  // The swarm ticks from here while the console is open, because the platform
  // scheduler is not running workflows for this app.
  useEffect(() => startSwarmTick(), [])

  // Once the owner is signed in, the same console load runs a maintenance pass.
  useEffect(() => {
    if (token) runMaintenanceOnce(token)
  }, [token])

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

  // One press makes the swarm move now, instead of waiting on the throttled
  // GitHub schedule or the five-minute console tick.
  async function handleRunNow() {
    if (runBusy) return
    setRunBusy(true)
    setRunNote('')
    try {
      const result = await runSwarmNow()
      if (result && result.skipped !== true) setRunNote('Swarm moved')
      else if (result?.skipped) setRunNote('Already read in the last 5 min')
      else setRunNote('Nothing came back')
    } catch {
      setRunNote('Could not reach the swarm')
    } finally {
      setRunBusy(false)
      window.setTimeout(() => setRunNote(''), 6000)
    }
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

  const paletteActions = useMemo(
    () => ({
      openBot: (slug) => jumpTo(`bot/${slug}`),
      list: [
        ...NAV.map((item) => ({
          id: `nav-${item.key}`,
          group: 'Go to',
          label: item.label,
          run: () => {
            window.location.hash = item.hash
            if (item.key === 'console') window.scrollTo({ top: 0, behavior: 'smooth' })
          },
        })),
        { id: 'act-foundry', group: 'Go to', label: 'Foundry', hint: 'Approve ideas, run bots', run: () => { window.location.hash = '#/foundry' } },
        { id: 'act-swarm', group: 'Go to', label: 'Swarm', hint: 'Every bot and its account', run: () => { window.location.hash = '#/swarm' } },
        { id: 'act-run', group: 'Actions', label: 'Run the swarm now', run: handleRunNow },
        { id: 'act-ask', group: 'Actions', label: 'Ask the Operator', hint: 'AI over live state', run: () => { window.location.hash = '#/operator' } },
        { id: 'act-money', group: 'Actions', label: 'Record money or link a bank', hint: 'Treasury', run: () => { window.location.hash = '#/treasury' } },
        { id: 'act-prospects', group: 'Actions', label: 'Find Tap Card prospects', hint: 'Google Places', run: () => { window.location.hash = '#/prospects' } },
        { id: 'act-fund', group: 'Actions', label: 'Start a funding packet', hint: 'Fund Bot', run: () => { window.location.hash = '#/funding' } },
        { id: 'act-pw', group: 'Account', label: 'Change password', run: () => setPasswordOpen(true) },
        { id: 'act-out', group: 'Account', label: 'Log out', run: handleSignOut },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jumpTo, token, runBusy],
  )

  // A saved session still gets the short "opening" screen while it is checked,
  // but anyone without a token sees the sign-in card with its Log in button
  // immediately, even if the auth service is slow or unreachable.
  // The store is public: a shop owner should be able to buy without an account.
  if (route.name === 'store') {
    return (
      <Suspense fallback={pageFallback}>
      <StorePage
        query={route.query}
        signedInEmail={owner?.email || ''}
        onOpenConsole={() => {
          window.location.hash = '#/'
          window.scrollTo({ top: 0 })
        }}
      />
      </Suspense>
    )
  }

  if (checking && token) {
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
        restoring={checking}
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
          <button
            type="button"
            className="primary-btn"
            onClick={handleRunNow}
            disabled={runBusy}
            aria-label="Run the swarm now"
          >
            {runBusy ? 'Running…' : 'Run now'}
          </button>
          <button
            type="button"
            className="ghost-btn cmdk-trigger"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open the command palette"
            title="Jump anywhere (Ctrl+K)"
          >
            Search <kbd>⌘K</kbd>
          </button>
          <LoginButton label="Password" onClick={() => setPasswordOpen(true)} ariaLabel="Change your password" />
          <LoginButton label="Log out" onClick={handleSignOut} />
          <PushButton onClick={() => jumpToSection('foundry')}>Control hub</PushButton>
          {runNote && <span className="session-chip" role="status">{runNote}</span>}
        </div>
      </header>

      <main className="main">
        <Suspense fallback={pageFallback}>
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

              <HeroPulse token={token} />
            </section>

            <Foundry token={token} onOpenBot={(slug) => jumpTo(`bot/${slug}`)} onOpenPage={jumpTo} />
          </>
        )}

        {route.name === 'activity' && <ActivityPage token={token} onJump={jumpTo} />}
        {route.name === 'funding' && <FundingPage token={token} onJump={jumpTo} focusRoute={route.route} />}
        {route.name === 'treasury' && <TreasuryPage token={token} onJump={jumpTo} />}
        {route.name === 'operator' && <OperatorPage token={token} onJump={jumpTo} />}
        {route.name === 'prospects' && <ProspectsPage token={token} onJump={jumpTo} />}
        {route.name === 'bot' && <BotPage token={token} slug={route.slug} onJump={jumpTo} />}
        </Suspense>
      </main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        token={token}
        actions={paletteActions}
      />

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
