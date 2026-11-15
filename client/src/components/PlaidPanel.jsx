import { useCallback, useEffect, useRef, useState } from 'react'
import { exchangePublicToken, fetchLinkToken, fetchLinkedAccounts } from '../api/plaidApi'

const LINK_SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'

/** Plaid ships Link as a plain script; load it once and reuse it. */
function loadPlaidLink() {
  if (typeof window !== 'undefined' && window.Plaid) return Promise.resolve(window.Plaid)

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${LINK_SCRIPT}"]`)
    if (existing) {
      existing.addEventListener('load', () => (window.Plaid ? resolve(window.Plaid) : reject(new Error('Plaid Link did not load.'))))
      existing.addEventListener('error', () => reject(new Error("Couldn't load Plaid Link. Check your connection.")))
      return
    }

    const script = document.createElement('script')
    script.src = LINK_SCRIPT
    script.async = true
    script.onload = () => (window.Plaid ? resolve(window.Plaid) : reject(new Error('Plaid Link did not load.')))
    script.onerror = () => reject(new Error("Couldn't load Plaid Link. Check your connection."))
    document.head.appendChild(script)
  })
}

export default function PlaidPanel({ token }) {
  const [env, setEnv] = useState('production')
  const [items, setItems] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const handlerRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const payload = await fetchLinkedAccounts(token)
      setItems(payload.items || [])
    } catch (problem) {
      setError(problem.message)
    } finally {
      setLoaded(true)
    }
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  async function handleConnect() {
    setBusy(true)
    setError('')
    setNote('')

    try {
      const [Plaid, link] = await Promise.all([loadPlaidLink(), fetchLinkToken(token, env)])

      handlerRef.current = Plaid.create({
        token: link.link_token,
        onSuccess: async (publicToken, metadata) => {
          try {
            const result = await exchangePublicToken(
              token,
              publicToken,
              metadata?.institution?.name || '',
              env,
            )
            const count = Number(result.account_count || 0)
            setNote(`${result.institution || 'Bank'} linked · ${count} account${count === 1 ? '' : 's'}`)
            await load()
          } catch (problem) {
            setError(problem.message)
          } finally {
            setBusy(false)
          }
        },
        onExit: (problem) => {
          setBusy(false)
          if (problem) setError(problem.display_message || problem.error_message || 'Link closed before it finished.')
        },
      })

      handlerRef.current.open()
    } catch (problem) {
      setError(problem.message)
      setBusy(false)
    }
  }

  const accounts = items.reduce((total, item) => total + Number(item.account_count || 0), 0)

  return (
    <div className="foundry-panel">
      <div className="foundry-panel-head">
        <h3>Bank connections</h3>
        <span className="foundry-count">
          {loaded ? (items.length ? `${items.length} bank${items.length === 1 ? '' : 's'} · ${accounts} accounts` : 'none linked') : '…'}
        </span>
      </div>

      <ul className="account-list">
        {items.map((item) => (
          <li key={item.item_id} className="account-row is-connected">
            <span className="status-dot on" aria-hidden="true" />
            <div className="account-main">
              <span className="account-name">{item.institution || 'Linked bank'}</span>
              <span className="account-need">
                {item.account_count || (item.accounts || []).length} account
                {(item.account_count || (item.accounts || []).length) === 1 ? '' : 's'} · {item.env}
                {item.balances_ok ? ' · balances live' : ''}
              </span>
            </div>
          </li>
        ))}
        {loaded && !items.length && <li className="foundry-empty">No bank linked yet.</li>}
      </ul>

      <div className="money-row">
        <select className="select-input" value={env} onChange={(event) => setEnv(event.target.value)}>
          <option value="production">Live banks</option>
          <option value="sandbox">Plaid test mode</option>
        </select>
        <button type="button" className="secondary-btn" onClick={handleConnect} disabled={busy}>
          {busy ? 'Opening…' : 'Connect a bank'}
        </button>
      </div>

      {note && <p className="is-ok">{note}</p>}
      {error && <p className="is-off">{error}</p>}
    </div>
  )
}
