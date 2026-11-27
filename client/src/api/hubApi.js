import { API_BASE, apiHeaders } from './config.js'

/** Owner-only Control Hub API (hub) and the bot runner (bot-run). */
async function post(path, body, token) {
  let response
  try {
    response = await fetch(`${API_BASE}/${path}`, {
      method: 'POST',
      headers: apiHeaders(token),
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error("Can't reach the Control Hub. Check your connection.")
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(payload?.error || 'The Control Hub did not answer.')
    error.needsKey = Boolean(payload?.needsKey)
    throw error
  }
  return payload
}

const hub = (action, token, body = {}) => post('hub', { action, ...body }, token)

export const listBots = (token) => hub('list', token)
export const setBotStatus = (token, slug, status) => hub('setStatus', token, { slug, status })
export const listRuns = (token, opts = {}) => hub('runs', token, opts)
export const rateRun = (token, id, value) => hub('thumbs', token, { id, value })
export const listApprovals = (token, status = 'pending') => hub('approvals', token, { status })
export const decideApproval = (token, id, decision) => hub('decide', token, { id, decision })
export const runBot = (token, slug, message, history = [], lead = {}) =>
  post('bot-run', { slug, message, history, lead }, token)
export const connectAiKey = (token, key) => hub('setAiKey', token, { key })
