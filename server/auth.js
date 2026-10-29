import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { config } from './config.js'

const BCRYPT_ROUNDS = 12

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash)
}

export function issueToken(store, userId) {
  const id = randomUUID()
  const expiresAt = new Date(Date.now() + config.tokenTtlSeconds * 1000).toISOString()
  store.createSession({ id, userId, expiresAt })

  const token = jwt.sign({ sub: userId, sid: id }, config.secret, {
    expiresIn: config.tokenTtlSeconds,
  })

  return { token, expiresAt }
}

function readBearer(req) {
  const header = req.get('authorization') || ''
  const [scheme, value] = header.split(' ')
  if (!value || scheme.toLowerCase() !== 'bearer') return null
  return value
}

/** Resolves the caller from the Authorization header, or null when absent/invalid. */
export function authenticate(req, store) {
  const token = readBearer(req)
  if (!token) return null

  let payload
  try {
    payload = jwt.verify(token, config.secret)
  } catch {
    return null
  }

  const session = store.findSession(payload.sid)
  if (!session || session.userId !== payload.sub) return null
  if (Date.parse(session.expiresAt) <= Date.now()) {
    store.deleteSession(session.id)
    return null
  }

  const user = store.findUserById(payload.sub)
  if (!user) return null

  return { user, session }
}

export function revokeSession(store, sessionId) {
  return store.deleteSession(sessionId)
}
