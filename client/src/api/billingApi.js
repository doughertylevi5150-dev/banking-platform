import { API_BASE, apiHeaders } from './config.js'

/**
 * Client for the Stripe checkout endpoint. Same endpoint style as the rest of
 * the bundle: hosted functions on a static host, /api in local dev.
 *
 * The secret key never reaches the browser. This module only asks the backend
 * for a hosted checkout URL, and can confirm afterwards that a session was paid.
 */
const API_URL = API_BASE

function here() {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}`
}

async function call(body) {
  let response
  try {
    response = await fetch(`${API_URL}/stripeCheckout`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error("Can't reach the payment endpoint. Check your connection.")
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || payload.error) {
    throw new Error(payload?.error || 'The payment endpoint did not answer.')
  }
  return payload
}

export const fetchPlans = () => call({ action: 'plans' })

export const startCheckout = (plan, email = '') => call({ action: 'create', plan, email, origin: here() })

export const verifySession = (sessionId) => call({ action: 'verify', session_id: sessionId })
