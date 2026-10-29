/**
 * Thin client for the auth API. One endpoint, one action per call, so the same
 * bundle works against the local Express server (/api/*) and the hosted
 * functions build (…/functions/bankingAuth).
 *
 * Local dev: VITE_API_URL is unset, paths resolve under /api and Vite proxies
 * them to the Express server on port 4000.
 */
const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

function url(path) {
  return `${API_URL}${path}`
}

export class ApiError extends Error {
  constructor(message, { status = 0, fields = {} } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fields = fields
  }
}

async function call(action, { body = {}, token } = {}) {
  let response

  try {
    response = await fetch(url('/bankingAuth'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action, ...body }),
    })
  } catch {
    throw new ApiError("Can't reach the sign-in service. Check your connection.")
  }

  if (response.status === 204) return null

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new ApiError(payload?.error || 'Something went wrong signing you in.', {
      status: response.status,
      fields: payload?.fields || {},
    })
  }

  return payload
}

export function getStatus() {
  return call('status')
}

export function signIn(email, password) {
  return call('login', { body: { email, password } })
}

export function claimOwner({ name, email, password, setupKey }) {
  return call('setup', { body: { name, email, password, setupKey } })
}

export function fetchOwner(token) {
  return call('me', { token })
}

export function signOut(token) {
  return call('logout', { token })
}
