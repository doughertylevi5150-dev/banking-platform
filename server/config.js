import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(here, '.data')

mkdirSync(dataDir, { recursive: true })

/**
 * Tokens are signed with JWT_SECRET when the deployment provides one. Locally we
 * generate one once and keep it in the data directory so restarting the dev
 * server does not invalidate every open session.
 */
function resolveSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production.')
  }

  const secretFile = path.join(dataDir, 'jwt-secret')
  if (existsSync(secretFile)) return readFileSync(secretFile, 'utf8').trim()

  const secret = randomBytes(48).toString('hex')
  writeFileSync(secretFile, secret, { mode: 0o600 })
  return secret
}

export const config = {
  port: Number(process.env.PORT || 4000),
  dataDir,
  usersFile: path.join(dataDir, 'users.json'),
  sessionsFile: path.join(dataDir, 'sessions.json'),
  foundryFile: path.join(dataDir, 'foundry.json'),
  secret: resolveSecret(),
  tokenTtlSeconds: Number(process.env.TOKEN_TTL_SECONDS || 60 * 60 * 24 * 7),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  loginAttempts: { max: 5, windowMs: 15 * 60 * 1000 },
  setupKey: process.env.OWNER_SETUP_KEY || '',
}
