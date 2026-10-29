const TOKEN_KEY = 'levisbotuniverse.token'

/** Stores the API session token; "keep me signed in" chooses localStorage over sessionStorage. */
export function saveToken(token, remember = true) {
  clearToken()
  const store = remember ? window.localStorage : window.sessionStorage
  store.setItem(TOKEN_KEY, token)
  return token
}

export function loadToken() {
  return window.sessionStorage.getItem(TOKEN_KEY) || window.localStorage.getItem(TOKEN_KEY)
}

export function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY)
  window.sessionStorage.removeItem(TOKEN_KEY)
}
