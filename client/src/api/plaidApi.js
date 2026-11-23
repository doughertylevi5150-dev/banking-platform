import { HOSTED_API_BASE, apiHeaders } from './config.js'

/**
 * Client for the Plaid bank link. Uses the hosted functions build so the static
 * Pages bundle can reach it without a proxy, and sends the owner's console token
 * the same way the foundry desk does.
 */
const API_URL = HOSTED_API_BASE

async function call(action, { token, body = {} } = {}) {
  let response

  try {
    response = await fetch(`${API_URL}/plaidApi`, {
      method: 'POST',
      headers: apiHeaders(token, API_URL),
      body: JSON.stringify({ action, ...body }),
    })
  } catch {
    throw new Error("Can't reach the bank link service. Check your connection.")
  }

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const detail = payload?.error?.error_message || payload?.error?.display_message || payload?.error
    throw new Error(typeof detail === 'string' ? detail : 'The bank link service did not answer.')
  }

  return payload
}

export const fetchLinkToken = (token, env) => call('link_token', { token, body: { env } })

export const exchangePublicToken = (token, publicToken, institutionName, env) =>
  call('exchange', { token, body: { public_token: publicToken, institution_name: institutionName, env } })

export const fetchLinkedAccounts = (token) => call('accounts', { token })
