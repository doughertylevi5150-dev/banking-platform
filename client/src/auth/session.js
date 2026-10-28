const SESSION_KEY = 'levisbotuniverse.session'

function readFrom(store) {
  try {
    const raw = store.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.email !== 'string' || !parsed.email) return null
    return parsed
  } catch {
    return null
  }
}

export function loadSession() {
  return readFrom(window.sessionStorage) || readFrom(window.localStorage)
}

export function saveSession(email, remember = true) {
  const session = { email, signedInAt: new Date().toISOString() }
  const target = remember ? window.localStorage : window.sessionStorage
  const other = remember ? window.sessionStorage : window.localStorage
  other.removeItem(SESSION_KEY)
  target.setItem(SESSION_KEY, JSON.stringify(session))
  return session
}

export function clearSession() {
  window.localStorage.removeItem(SESSION_KEY)
  window.sessionStorage.removeItem(SESSION_KEY)
}
