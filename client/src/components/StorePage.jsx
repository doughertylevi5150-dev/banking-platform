import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchPlans, startCheckout, verifySession } from '../api/billingApi'
import { money } from '../lib/format'

/**
 * Public storefront. No account needed: a shop owner lands here, picks a plan,
 * pays on Stripe, and comes back to a confirmation. Everything about money is
 * decided by the backend (prices live in Stripe), so this page only displays
 * what the endpoint reports.
 */

const COPY = {
  install: {
    title: 'Counter install',
    kicker: 'One time',
    blurb:
      'The whole station, installed and tested in about three hours. Reader, screen, mount, 100 tap cards, and the person behind the counter trained.',
    includes: [
      'Contactless reader and a 10-inch station',
      'Lockable counter stand, hub and cabling',
      '100 MIFARE DESFire EV3 reload cards',
      'Balance screen wired to your own account',
      'Three-card test: reload, redeem, check the balance',
      'One-page sheet for whoever works the counter',
    ],
    cta: 'Buy the install',
  },
  monthly: {
    title: 'Monthly service',
    kicker: 'Per site, per month',
    blurb:
      'Hosting, support, card reorders and a monthly balance report. Cancel any time. Cards already in customers’ hands keep their balances.',
    includes: [
      'Hosting, backups and uptime checks',
      'Support by email or text',
      'Card reorders at cost',
      'Monthly reload and redemption report',
      'A second site for the same owner is $600 installed',
    ],
    cta: 'Start the service',
  },
  founding: {
    title: 'Founding seat',
    kicker: 'One time',
    blurb:
      'A seat in the LevisBot Universe console before it opens to anyone else, with a direct line to the person building it.',
    includes: [
      'Console access at launch',
      'A direct line to the builder',
      'Founding price locked',
    ],
    cta: 'Take a founding seat',
  },
}

const INDUSTRIES = [
  'Laundromats',
  'Car washes',
  'Gyms',
  'Batting cages',
  'Arcades',
  'Self-serve pet washes',
  'Unattended parking',
]

const STEPS = [
  { at: 'Hour 1', what: 'Walk the counter, pick the reload spot, confirm power and wifi. Weak wifi is the usual failure, so we plan for it.' },
  { at: 'Hour 2', what: 'Mount the stand, connect the reader, seat the opening card batch and set the reload amounts you want to sell.' },
  { at: 'Hour 3', what: 'Test three cards end to end, hand-write the counter price card, and train the person behind the counter in five minutes.' },
]

const FAQ = [
  {
    q: 'Whose money is on the card?',
    a: 'Yours. The balance lives in your account, not with a processor and not on the card itself. The card only proves which card was tapped, never how much is on it.',
  },
  {
    q: 'Can the card be cloned?',
    a: 'The cards are MIFARE DESFire EV3, not the MIFARE Classic cards $30 phone apps can copy. More importantly, every balance is a row in your database, so a copied card still cannot invent money.',
  },
  {
    q: 'Do the cards expire?',
    a: 'No. California rules do not allow it here. Unclaimed balances eventually go to the state as unclaimed property, so that is spelled out on the card and the receipt.',
  },
  {
    q: 'Do you touch customer funds?',
    a: 'Never. Your shop collects the cash at the counter. I install and support the station, which keeps this a vending arrangement rather than money transmission.',
  },
  {
    q: 'What if I already use Square gift cards?',
    a: 'Then stay where you are. This is for places Square and Clover serve badly: reload counters where customers top up their own card and the attendant taps it at the register.',
  },
]

export default function StorePage({ query, signedInEmail = '', onOpenConsole }) {
  const [plans, setPlans] = useState([])
  const [live, setLive] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState(null)
  const [checking, setChecking] = useState(false)

  const paidFlag = query?.get?.('paid') || ''
  const sessionId = query?.get?.('session_id') || ''
  const returnedPlan = query?.get?.('plan') || ''

  useEffect(() => {
    const previous = document.title
    document.title = 'Tap Card System — LevisBot Universe'
    return () => {
      document.title = previous
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const result = await fetchPlans()
      setPlans(result.plans || [])
      setLive(Boolean(result.live))
      setLoadError('')
    } catch (problem) {
      setLoadError(problem.message)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Landing back from Stripe: confirm the session with the backend rather than
  // trusting the query string.
  useEffect(() => {
    if (paidFlag !== '1' || !sessionId) return undefined
    let cancelled = false
    setChecking(true)
    verifySession(sessionId)
      .then((result) => {
        if (!cancelled) setReceipt(result)
      })
      .catch((problem) => {
        if (!cancelled) setError(problem.message)
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [paidFlag, sessionId])

  const byPlan = useMemo(() => {
    const map = {}
    for (const plan of plans) map[plan.id] = plan
    return map
  }, [plans])

  async function buy(plan) {
    setBusy(plan)
    setError('')
    try {
      const result = await startCheckout(plan, email.trim())
      if (!result?.url) throw new Error('Stripe did not return a checkout link. Try again in a moment.')
      window.location.assign(result.url)
    } catch (problem) {
      setError(problem.message)
      setBusy('')
    }
  }

  function scrollToPricing() {
    document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const cancelled = paidFlag === '0'

  return (
    <div className="store-shell">
      <header className="store-topbar">
        <div className="store-brand">
          <div className="brand-mark">LU</div>
          <div>
            <div className="brand-name">LevisBot Universe</div>
            <div className="brand-tag">Tap Card System</div>
          </div>
        </div>
        <div className="store-top-actions">
          <button type="button" className="ghost-btn" onClick={scrollToPricing}>
            Pricing
          </button>
          {onOpenConsole && (
            <button type="button" className="secondary-btn" onClick={onOpenConsole}>
              {signedInEmail ? 'Console' : 'Owner login'}
            </button>
          )}
        </div>
      </header>

      {!live && (
        <p className="store-banner" role="status">
          Preview mode: this store is wired to Stripe in test mode, so a card entered here is not charged. Say the word
          and it goes live the moment the Stripe account is activated.
        </p>
      )}

      {receipt && (
        <div className="store-receipt" role="status">
          <h2>{receipt.paid ? 'Paid. You’re in.' : 'Payment not finished'}</h2>
          {receipt.paid ? (
            <p>
              {COPY[receipt.plan]?.title || 'Your order'} is paid
              {byPlan[receipt.plan] ? ` (${money(byPlan[receipt.plan].amount)})` : ''}. Stripe emailed a receipt to{' '}
              {receipt.email || 'the address you used'}. I’ll be in touch within one business day to lock in the install
              day.
            </p>
          ) : (
            <p>
              Stripe says that checkout was not completed, so nothing was charged. You can pick it up again below, or
              reply to any email from me and I’ll send a fresh link.
            </p>
          )}
        </div>
      )}

      {cancelled && !receipt && (
        <p className="store-banner is-quiet" role="status">
          Checkout cancelled. Nothing was charged.
        </p>
      )}

      <section className="store-hero">
        <div className="store-hero-copy">
          <span className="pill">Installed in three hours</span>
          <h1>A reload counter your customers run themselves.</h1>
          <p className="store-lede">
            You’re running prepaid cards through a system that doesn’t know your business. I install a station at the
            counter where customers top up a card you own, and the balance lives in your account, not a processor’s.
          </p>
          <p className="store-price-line">
            <strong>$950</strong> installed <span>·</span> <strong>$39</strong> a month after
          </p>
          <div className="store-hero-actions">
            <button type="button" className="primary-btn" onClick={scrollToPricing}>
              See the plans
            </button>
            <a className="ghost-btn" href="mailto:doughertylevi3@gmail.com?subject=Tap%20card%20system%20question">
              Ask a question
            </a>
          </div>
          <ul className="store-industries">
            {INDUSTRIES.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <aside className="store-card store-hero-card">
          <div className="store-card-head">
            <span>What the counter does</span>
            <span className="online-dot" aria-label="Working" />
          </div>
          <ol className="store-flow">
            <li>
              <strong>Tap</strong>
              <span>A customer taps their card on the reader.</span>
            </li>
            <li>
              <strong>Top up</strong>
              <span>They pay cash or card at the counter and watch the balance go up.</span>
            </li>
            <li>
              <strong>Spend</strong>
              <span>The attendant taps the same card and the balance goes down.</span>
            </li>
          </ol>
          <p className="store-small">
            No app for the customer, no new account for you, no cut taken out of every reload.
          </p>
        </aside>
      </section>

      <section className="store-section" id="pricing">
        <div className="store-section-head">
          <h2>Plans</h2>
          <p>One install, one monthly line. Second site for the same owner is $600 installed plus the same $39.</p>
        </div>

        <div className="store-email-row">
          <label htmlFor="store-email">Email for the receipt (optional)</label>
          <input
            id="store-email"
            className="login-input"
            type="email"
            placeholder="owner@theirshop.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        {error && <p className="foundry-error">{error}</p>}
        {loadError && <p className="foundry-error">{loadError}</p>}

        <div className="store-plans">
          {plans.map((plan) => {
            const copy = COPY[plan.id] || { title: plan.label, kicker: '', blurb: '', includes: [], cta: 'Buy' }
            const featured = plan.id === 'install'
            return (
              <article key={plan.id} className={`store-card store-plan${featured ? ' is-featured' : ''}`}>
                <div className="store-plan-head">
                  <h3>{copy.title}</h3>
                  {featured && <span className="store-flag">Start here</span>}
                </div>
                <div className="store-plan-price">
                  <strong>{money(plan.amount)}</strong>
                  <span>{plan.mode === 'subscription' ? 'per month' : copy.kicker || 'one time'}</span>
                </div>
                <p className="store-plan-blurb">{copy.blurb}</p>
                <ul className="store-includes">
                  {copy.includes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={featured ? 'primary-btn' : 'secondary-btn'}
                  onClick={() => buy(plan.id)}
                  disabled={busy === plan.id}
                >
                  {busy === plan.id ? 'Opening checkout…' : copy.cta}
                </button>
              </article>
            )
          })}
          {!plans.length && !loadError && <p className="store-small">Reading plans…</p>}
        </div>
        <p className="store-small">
          Paying by card, Apple Pay or Link. Nothing renews without telling you, and a subscription can be stopped any
          month.
        </p>
      </section>

      <section className="store-section">
        <div className="store-section-head">
          <h2>Install day</h2>
          <p>About three hours on site, start to a working balance screen. You keep the hardware.</p>
        </div>
        <div className="store-steps">
          {STEPS.map((step) => (
            <div key={step.at} className="store-step">
              <span className="store-step-at">{step.at}</span>
              <p>{step.what}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="store-section">
        <div className="store-section-head">
          <h2>Straight answers</h2>
          <p>The things a shop owner should ask before paying for this.</p>
        </div>
        <div className="store-faq">
          {FAQ.map((item) => (
            <details key={item.q} className="store-card store-faq-item">
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="store-footer">
        <p>
          Questions before you buy: <a href="mailto:doughertylevi3@gmail.com">doughertylevi3@gmail.com</a>. Payments run
          through Stripe; the card details never touch this site.
        </p>
        {checking && <p className="store-small">Checking that payment with Stripe…</p>}
      </footer>
    </div>
  )
}
