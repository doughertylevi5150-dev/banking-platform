import { Router } from 'express'
import { authenticate, hashPassword, issueToken, revokeSession, verifyPassword } from '../auth.js'
import { config } from '../config.js'
import { createAttemptLimiter } from '../rate-limit.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const LOCKED = 'This console is limited to its owner.'

function publicUser(user) {
  return { email: user.email, name: user.name, role: user.role, createdAt: user.createdAt }
}

function validateCredentials(body) {
  const errors = {}
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email) errors.email = 'Enter your email address.'
  else if (!EMAIL_PATTERN.test(email)) errors.email = 'That email address looks incomplete.'

  if (!password) errors.password = 'Enter your password.'
  else if (password.length < 8) errors.password = 'Passwords are at least 8 characters.'

  return { errors, email, password }
}

export function createAuthHandlers(store) {
  const limiter = createAttemptLimiter(config.loginAttempts)

  /**
   * Owner bootstrap. Works only while the console has no owner and only with the
   * deployment's setup key, so a public deploy cannot be claimed by a stranger.
   */
  async function setup(req, res) {
    if (store.findOwner()) return res.status(403).json({ error: LOCKED })

    if (!config.setupKey || req.body?.setupKey !== config.setupKey) {
      return res.status(403).json({ error: 'That setup key is not valid.' })
    }

    const { errors, email, password } = validateCredentials(req.body)
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    if (!name) errors.name = 'Enter your name.'
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Check the highlighted fields.', fields: errors })
    }

    const user = store.createUser({ email, name, passwordHash: await hashPassword(password) })
    const { token, expiresAt } = issueToken(store, user.id)
    return res.status(201).json({ token, expiresAt, user: publicUser(user) })
  }

  function status(_req, res) {
    res.json({ setupRequired: !store.findOwner(), setupConfigured: Boolean(config.setupKey) })
  }

  async function login(req, res) {
    const { errors, email, password } = validateCredentials(req.body)
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Check the highlighted fields.', fields: errors })
    }

    const gate = limiter.check(req, email)
    if (gate.blocked) {
      return res.status(429).json({
        error: `Too many attempts. Try again in ${Math.ceil(gate.retryAfterSeconds / 60)} minutes.`,
      })
    }

    const user = store.findUserByEmail(email)

    // Compare against a dummy hash so an unknown email takes about as long as a wrong password.
    const passwordHash =
      user?.passwordHash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv'
    const matches = await verifyPassword(password, passwordHash)

    if (!user || !matches) {
      limiter.fail(req, email)
      return res.status(401).json({ error: 'Email or password is incorrect.' })
    }

    if (user.role !== 'owner') {
      limiter.fail(req, email)
      return res.status(403).json({ error: LOCKED })
    }

    limiter.clear(req, email)
    const { token, expiresAt } = issueToken(store, user.id)
    return res.json({ token, expiresAt, user: publicUser(user) })
  }

  function me(req, res) {
    const auth = authenticate(req, store)
    if (!auth) return res.status(401).json({ error: 'Your session has expired. Sign in again.' })
    if (auth.user.role !== 'owner') return res.status(403).json({ error: LOCKED })

    return res.json({ user: publicUser(auth.user), expiresAt: auth.session.expiresAt })
  }

  function logout(req, res) {
    const auth = authenticate(req, store)
    if (auth) revokeSession(store, auth.session.id)
    return res.status(204).end()
  }

  return { setup, status, login, me, logout }
}

/**
 * Mounts the handlers twice: readable REST paths for local work, and the flat
 * /api/bankingAuth* paths the browser bundle always calls, so the same client
 * build can talk to this server or to the hosted functions.
 */
export function mountAuthRoutes(app, store) {
  const handlers = createAuthHandlers(store)

  const rest = Router()
  rest.post('/setup', handlers.setup)
  rest.get('/setup', handlers.status)
  rest.post('/login', handlers.login)
  rest.get('/me', handlers.me)
  rest.post('/logout', handlers.logout)
  app.use('/api/auth', rest)

  app.get('/api/bankingAuthStatus', handlers.status)
  app.post('/api/bankingAuthLogin', handlers.login)
  app.get('/api/bankingAuthMe', handlers.me)
  app.post('/api/bankingAuthLogout', handlers.logout)
  app.post('/api/bankingAuthSetup', handlers.setup)
  app.post('/api/bankingAuth', (req, res) => {
    const action = String(req.body?.action || 'status')
    const handler = handlers[action]
    if (!handler) return res.status(400).json({ error: 'Unknown action.' })
    return handler(req, res)
  })

  return handlers
}
