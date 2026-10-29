/**
 * Small in-memory attempt counter for the login route. Enough for a single
 * instance; swap for Redis if this ever runs behind more than one process.
 */
export function createAttemptLimiter({ max, windowMs }) {
  const hits = new Map()

  function key(req, email) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown'
    return `${ip}:${String(email || '').toLowerCase()}`
  }

  return {
    check(req, email) {
      const entry = hits.get(key(req, email))
      if (!entry || entry.resetAt <= Date.now()) return { blocked: false }

      if (entry.count >= max) {
        return { blocked: true, retryAfterSeconds: Math.ceil((entry.resetAt - Date.now()) / 1000) }
      }

      return { blocked: false }
    },
    fail(req, email) {
      const k = key(req, email)
      const entry = hits.get(k)

      if (!entry || entry.resetAt <= Date.now()) {
        hits.set(k, { count: 1, resetAt: Date.now() + windowMs })
        return
      }

      entry.count += 1
    },
    clear(req, email) {
      hits.delete(key(req, email))
    },
    reset() {
      hits.clear()
    },
  }
}
