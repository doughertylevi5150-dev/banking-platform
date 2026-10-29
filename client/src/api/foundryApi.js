/**
 * Client for the bot foundry. Same endpoint style as the auth API so the bundle
 * works against the local Express server (/api/foundryApi) and the hosted
 * functions build (…/functions/foundryApi).
 */
const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

async function call(action, { body = {}, token } = {}) {
  let response

  try {
    response = await fetch(`${API_URL}/foundryApi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action, ...body }),
    })
  } catch {
    throw new Error("Can't reach the foundry. Check your connection.")
  }

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(payload?.error || 'The foundry did not answer.')
  }

  return payload
}

export const fetchFoundry = (token) => call('state', { token })

export const decideProposal = (token, proposalId, decision) =>
  call('decide', { token, body: { proposalId, decision } })

export const toggleBot = (token, botId) => call('toggle', { token, body: { botId } })

export const retireBot = (token, botId) => call('retire', { token, body: { botId } })

export const draftProposals = (token, limit = 2) => call('draft', { token, body: { limit } })
