/**
 * Client for the Operator, the in-console intelligence. Same endpoint style as
 * the rest of the bundle: hosted functions on a static host, /api in local dev.
 */
const HOSTED_API = 'https://base44.app/api/apps/6ae17320e2bf99b777448a91/functions'
const ON_LOCAL_HOST =
  typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
const API_URL = (import.meta.env.VITE_API_URL || (ON_LOCAL_HOST ? '/api' : HOSTED_API)).replace(/\/$/, '')

async function call(action, { token, body = {} } = {}) {
  let response

  try {
    response = await fetch(`${API_URL}/operatorAI`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action, ...body }),
    })
  } catch {
    throw new Error("Can't reach the Operator. Check your connection.")
  }

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(payload?.error || 'The Operator did not answer.')
  }

  return payload
}

export const fetchBrief = (token) => call('brief', { token })

export const askOperator = (token, message, history = []) => call('ask', { token, body: { message, history } })

export const runOperatorAction = (token, input) => call('apply', { token, body: { input } })
