/**
 * Client for the Plaid bank link. Uses the hosted functions build so the static
 * Pages bundle can reach it without a proxy, and sends the owner's console token
 * the same way the foundry desk does.
 */
const HOSTED_API = 'https://base44.app/api/apps/6ae17320e2bf99b777448a91/functions'
const API_URL = (import.meta.env.VITE_API_URL || HOSTED_API).replace(/\/$/, '')

async function call(action, { token, body = {} } = {}) {
  let response

  try {
    response = await fetch(`${API_URL}/plaidApi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
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
