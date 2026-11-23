/**
 * One place for the backend address.
 *
 * Hosted builds call the Supabase Edge Functions. Set VITE_API_BASE at build
 * time (e.g. https://abcd1234.supabase.co/functions/v1), or replace the
 * placeholder below. On localhost the Vite dev server proxies /api to the
 * Express server, unless VITE_API_BASE is set.
 */
export const DEFAULT_API_BASE = 'https://SUPABASE_REF.supabase.co/functions/v1'

const ON_LOCAL_HOST =
  typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)

const strip = (value) => String(value || '').replace(/\/$/, '')

/** The hosted functions base, ignoring the local dev proxy. */
export const HOSTED_API_BASE = strip(import.meta.env.VITE_API_BASE || DEFAULT_API_BASE)

/** Where calls go from this page: the hosted functions, or /api in local dev. */
export const API_BASE = strip(import.meta.env.VITE_API_BASE || (ON_LOCAL_HOST ? '/api' : DEFAULT_API_BASE))

const ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

/**
 * Request headers for every backend call.
 *
 * The console session token always travels in `x-console-token`. When a
 * Supabase anon key is configured it takes `apikey` and `Authorization`, so
 * the session token is never clobbered. Without an anon key (local Express
 * server, or functions deployed with verify_jwt = false and no key) the token
 * also goes in `Authorization: Bearer`, which the Express server reads.
 */
export function apiHeaders(token, base = API_BASE) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['x-console-token'] = token
  // The anon key is only for Supabase; the local /api proxy reads the token from Authorization.
  if (ANON_KEY && !base.startsWith('/')) {
    headers.apikey = ANON_KEY
    headers.Authorization = `Bearer ${ANON_KEY}`
  } else if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}
