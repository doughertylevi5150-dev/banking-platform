import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const dataDir = mkdtempSync(path.join(tmpdir(), 'auth-api-'))
process.env.DATA_DIR = dataDir
process.env.TOKEN_TTL_SECONDS = '900'
process.env.OWNER_SETUP_KEY = 'setup-key-for-tests'

const { createApp } = await import('../app.js')
const { createStore } = await import('../store.js')

const owner = {
  name: 'Levi Dougherty',
  email: 'Levi@LevisBotUniverse.com',
  password: 'supersecret123',
  setupKey: 'setup-key-for-tests',
}

let server
let baseUrl
let store

before(async () => {
  store = createStore({
    usersFile: path.join(dataDir, 'users.json'),
    sessionsFile: path.join(dataDir, 'sessions.json'),
  })
  store.reset()
  server = createApp({ store }).listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(() => server?.close())

async function call(pathname, { method, body, token } = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

test('reports that the console needs its owner', async () => {
  const res = await call('/api/bankingAuthStatus')
  assert.equal(res.status, 200)
  assert.equal(res.body.setupRequired, true)
  assert.equal(res.body.setupConfigured, true)
})

test('refuses to create an owner without the setup key', async () => {
  const res = await call('/api/bankingAuthSetup', { body: { ...owner, setupKey: 'guess' } })
  assert.equal(res.status, 403)
  assert.equal(res.body.error, 'That setup key is not valid.')
  assert.equal(store.findOwner(), null)
})

test('creates the owner once and hashes the password', async () => {
  const res = await call('/api/bankingAuthSetup', { body: owner })

  assert.equal(res.status, 201)
  assert.equal(res.body.user.email, 'levi@levisbotuniverse.com')
  assert.equal(res.body.user.role, 'owner')
  assert.ok(res.body.token)
  assert.ok(!('passwordHash' in res.body.user))

  const stored = store.findOwner()
  assert.match(stored.passwordHash, /^\$2[aby]\$/)
  assert.ok(!stored.passwordHash.includes(owner.password))
})

test('closes the door behind the owner', async () => {
  const again = await call('/api/bankingAuthSetup', { body: { ...owner, email: 'intruder@bank.com' } })
  assert.equal(again.status, 403)
  assert.equal(again.body.error, 'This console is limited to its owner.')
  assert.equal(store.findUserByEmail('intruder@bank.com'), null)
})

test('signs in with the right password only', async () => {
  const good = await call('/api/bankingAuthLogin', {
    body: { email: 'levi@levisbotuniverse.com', password: owner.password },
  })
  assert.equal(good.status, 200)
  assert.ok(good.body.token)

  const bad = await call('/api/bankingAuthLogin', {
    body: { email: 'levi@levisbotuniverse.com', password: 'wrongpassword' },
  })
  assert.equal(bad.status, 401)
  assert.equal(bad.body.error, 'Email or password is incorrect.')

  const unknown = await call('/api/bankingAuthLogin', {
    body: { email: 'nobody@bank.com', password: 'wrongpassword' },
  })
  assert.equal(unknown.status, 401)
})

test('resolves the owner and rejects tampered or absent tokens', async () => {
  const login = await call('/api/bankingAuthLogin', {
    body: { email: 'levi@levisbotuniverse.com', password: owner.password },
  })

  const me = await call('/api/bankingAuthMe', { token: login.body.token })
  assert.equal(me.status, 200)
  assert.equal(me.body.user.email, 'levi@levisbotuniverse.com')

  const tampered = await call('/api/bankingAuthMe', {
    token: `${login.body.token.slice(0, -2)}aa`,
  })
  assert.equal(tampered.status, 401)

  const anonymous = await call('/api/bankingAuthMe')
  assert.equal(anonymous.status, 401)
})

test('logout revokes the token', async () => {
  const login = await call('/api/bankingAuthLogin', {
    body: { email: 'levi@levisbotuniverse.com', password: owner.password },
  })

  const out = await call('/api/bankingAuthLogout', { method: 'POST', token: login.body.token })
  assert.equal(out.status, 204)

  const me = await call('/api/bankingAuthMe', { token: login.body.token })
  assert.equal(me.status, 401)
})

test('a non-owner record can never sign in', async () => {
  const bcrypt = (await import('bcryptjs')).default
  const state = store.raw()
  state.users.push({
    id: 'guest-1',
    email: 'guest@bank.com',
    name: 'Guest',
    role: 'guest',
    passwordHash: bcrypt.hashSync('supersecret123', 4),
    createdAt: new Date().toISOString(),
  })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify(state.users))

  const res = await call('/api/bankingAuthLogin', {
    body: { email: 'guest@bank.com', password: 'supersecret123' },
  })
  assert.equal(res.status, 403)
  assert.equal(res.body.error, 'This console is limited to its owner.')
})

test('locks out after five wrong passwords', async () => {
  for (let i = 0; i < 5; i += 1) {
    const attempt = await call('/api/bankingAuthLogin', {
      body: { email: 'levi@levisbotuniverse.com', password: 'wrongpassword' },
    })
    assert.equal(attempt.status, 401)
  }

  const blocked = await call('/api/bankingAuthLogin', {
    body: { email: 'levi@levisbotuniverse.com', password: owner.password },
  })
  assert.equal(blocked.status, 429)
  assert.match(blocked.body.error, /Too many attempts/)
})
