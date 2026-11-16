import { useCallback, useEffect, useState } from 'react'
import { fetchPlans, startCheckout } from '../api/billingApi'
import { money } from '../lib/format'

/**
 * Selling panel. Each plan is a price that already exists in Stripe; this only
 * asks the backend for a hosted checkout URL, so a customer can pay from a
 * phone without an account here.
 */
export default function BillingPanel() {
  const [plans, setPlans] = useState([])
  const [live, setLive] = useState(false)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [made, setMade] = useState(null)

  const load = useCallback(async () => {
    try {
      const result = await fetchPlans()
      setPlans(result.plans || [])
      setLive(Boolean(result.live))
      setError('')
    } catch (problem) {
      setError(problem.message)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleCheckout(plan) {
    setBusy(plan.id)
    setError('')
    setMade(null)
    try {
      const result = await startCheckout(plan.id, email.trim())
      setMade(result)
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy('')
    }
  }

  async function copyLink() {
    if (!made?.url) return
    try {
      await navigator.clipboard.writeText(made.url)
      setError('')
    } catch {
      setError('Copy it from the box below.')
    }
  }

  return (
    <div className="foundry-panel">
      <div className="foundry-panel-head">
        <h3>Get paid</h3>
        <span className="foundry-count">{live ? 'live keys' : 'test mode'}</span>
      </div>

      <p className="foundry-delta">
        Card payments through Stripe. A customer can pay by link — card, Apple Pay, or Amazon Pay — without an account
        here.
      </p>

      <div className="login-field">
        <label htmlFor="billing-email">Customer email (optional)</label>
        <input
          id="billing-email"
          className="login-input"
          type="email"
          placeholder="owner@theirshop.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      {error && <p className="foundry-error">{error}</p>}

      <ul className="account-list">
        {plans.map((plan) => (
          <li key={plan.id} className="account-row is-connected">
            <div className="account-main">
              <span className="account-name">{plan.label}</span>
              <span className="account-need">
                {money(plan.amount)}
                {plan.mode === 'subscription' ? ' per month' : ' one time'}
              </span>
            </div>
            <div className="account-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => handleCheckout(plan)}
                disabled={busy === plan.id}
              >
                {busy === plan.id ? 'Opening…' : 'Checkout link'}
              </button>
            </div>
          </li>
        ))}
        {!plans.length && !error && <li className="account-row is-needed">Reading plans…</li>}
      </ul>

      {made?.url && (
        <div className="live-result">
          <p className="is-ok">
            Link ready for {made.plan} at {money(made.amount)}
            {made.live ? '' : ' (test mode — no real money moves)'}.
          </p>
          <div className="page-actions">
            <a className="primary-btn" href={made.url} target="_blank" rel="noreferrer">
              Open checkout
            </a>
            <button type="button" className="secondary-btn" onClick={copyLink}>
              Copy link
            </button>
          </div>
          <input className="login-input" type="text" readOnly value={made.url} onFocus={(e) => e.target.select()} />
        </div>
      )}
    </div>
  )
}
