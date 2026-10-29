/**
 * Client for the bot foundry. Same endpoint style as the auth API so the bundle
 * works against the local Express server (/api/foundryApi) and the hosted
 * functions build (…/functions/foundryApi).
 */
const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

async function call(action, { body = {}, token, desk = false } = {}) {
  let response

  try {
    response = await fetch(`${API_URL}/${desk ? 'foundryOps' : 'foundryApi'}`, {
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

// State, accounts and the live market read come from the accounts desk.
export const fetchFoundry = (token) => call('state', { token, desk: true })

export const runFeed = (token) => call('feed', { token, desk: true })

export const setBotAccount = (token, botId, status, provider) =>
  call('setAccount', { token, desk: true, body: { botId, status, provider } })

export const decideProposal = (token, proposalId, decision) =>
  call('decide', { token, body: { proposalId, decision } })

export const toggleBot = (token, botId) => call('toggle', { token, body: { botId } })

export const retireBot = (token, botId) => call('retire', { token, body: { botId } })

export const draftProposals = (token, limit = 2) => call('draft', { token, body: { limit } })

/* Activity, money, funding and bot detail all live on the accounts desk. */

const desk = (action, token, body = {}) => call(action, { token, desk: true, body })

export const fetchActivity = (token, { botSlug = '', kind = '', limit = 80, skip = 0 } = {}) =>
  desk('activity', token, { botSlug, kind, limit, skip })

export const fetchBot = (token, slug) => desk('bot', token, { slug })

export const fetchTreasury = (token) => desk('treasury', token)

export const recordMoney = (token, { botSlug, kind, amount, note }) =>
  desk('record', token, { botSlug, kind, amount, note })

export const runLiveRead = (token, provider = '') => desk('live', token, { provider })

export const fetchFunding = (token) => desk('funding', token)

export const setFundingStatus = (token, route, status, note = '') =>
  desk('updateFunding', token, { route, status, note })
