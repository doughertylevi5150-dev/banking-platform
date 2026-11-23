import { API_BASE, apiHeaders } from './config.js'

/**
 * Client for the Operator, the in-console intelligence. Same endpoint style as
 * the rest of the bundle: hosted functions on a static host, /api in local dev.
 */
const API_URL = API_BASE

async function call(action, { token, body = {} } = {}) {
  let response

  try {
    response = await fetch(`${API_URL}/operatorAI`, {
      method: 'POST',
      headers: apiHeaders(token),
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
