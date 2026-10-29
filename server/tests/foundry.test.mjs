import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const dataDir = mkdtempSync(path.join(tmpdir(), 'foundry-api-'))
process.env.DATA_DIR = dataDir
process.env.TOKEN_TTL_SECONDS = '900'
process.env.OWNER_SETUP_KEY = 'setup-key-for-tests'

const { createApp } = await import('../app.js')
const { createStore } = await import('../store.js')

const owner = {
  name: 'Levi Dougherty',
  email: 'levi@levisbotuniverse.com',
  password: 'supersecret123',
  setupKey: 'setup-key-for-tests',
}

let server
let baseUrl
let token

before(async () => {
  const store = createStore({
    usersFile: path.join(dataDir, 'users.json'),
    sessionsFile: path.join(dataDir, 'sessions.json'),
  })
  store.reset()

  server = createApp({ store }).listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  const claim = await call('/api/bankingAuth', { action: 'setup', ...owner })
  token = claim.body.token
})

after(() => server?.close())

async function call(pathname, body, { bearer } = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  })

  return { status: res.status, body: await res.json().catch(() => null) }
}

test('the foundry is closed to anyone without the owner session', async () => {
  const response = await call('/api/foundryApi', { action: 'state' })
  assert.equal(response.status, 401)
})

test('the swarm starts seeded with the bots Levi asked for', async () => {
  const response = await call('/api/foundryApi', { action: 'state' }, { bearer: token })
  assert.equal(response.status, 200)

  const names = response.body.bots.map((bot) => bot.name)
  for (const name of ['Think Bot', 'Bot Maker', 'NFT Bot', 'Buy Bot', 'Sell Bot', 'Scraper Bot', 'Maintenance Bot']) {
    assert.ok(names.includes(name), `${name} should be in the swarm`)
  }
  assert.equal(response.body.totals.running, response.body.bots.length)
})

test('the think bot drafts proposals that wait for a decision', async () => {
  const drafted = await call('/api/foundryApi', { action: 'draft', limit: 2 }, { bearer: token })
  assert.equal(drafted.status, 200)

  const state = await call('/api/foundryApi', { action: 'state' }, { bearer: token })
  assert.ok(state.body.proposals.length >= 1)
  assert.ok(state.body.proposals.every((proposal) => proposal.status === undefined || proposal.title))
})

test('approving a proposal adds a running bot and logging the decision', async () => {
  const before = await call('/api/foundryApi', { action: 'state' }, { bearer: token })
  const proposal = before.body.proposals[0]
  assert.ok(proposal, 'a proposal should be waiting')

  const decided = await call(
    '/api/foundryApi',
    { action: 'decide', proposalId: proposal.id, decision: 'approve' },
    { bearer: token },
  )
  assert.equal(decided.body.status, 'approved')

  const after = await call('/api/foundryApi', { action: 'state' }, { bearer: token })
  assert.ok(after.body.bots.some((bot) => bot.name === proposal.title))
  assert.ok(after.body.events.some((event) => event.message.includes(proposal.title)))
  assert.equal(after.body.totals.decided, 1)
})

test('passing on a proposal never adds a bot', async () => {
  await call('/api/foundryApi', { action: 'draft', limit: 1 }, { bearer: token })
  const state = await call('/api/foundryApi', { action: 'state' }, { bearer: token })
  const proposal = state.body.proposals[0]

  await call('/api/foundryApi', { action: 'decide', proposalId: proposal.id, decision: 'reject' }, { bearer: token })

  const after = await call('/api/foundryApi', { action: 'state' }, { bearer: token })
  assert.ok(!after.body.bots.some((bot) => bot.name === proposal.title))
})

test('pausing and resuming a bot flips its status', async () => {
  const state = await call('/api/foundryApi', { action: 'state' }, { bearer: token })
  const bot = state.body.bots.find((item) => item.status === 'running')

  const paused = await call('/api/foundryApi', { action: 'toggle', botId: bot.id }, { bearer: token })
  assert.equal(paused.body.status, 'paused')

  const resumed = await call('/api/foundryApi', { action: 'toggle', botId: bot.id }, { bearer: token })
  assert.equal(resumed.body.status, 'running')
})

test('retiring a bot removes it from the swarm without deleting history', async () => {
  const state = await call('/api/foundryApi', { action: 'state' }, { bearer: token })
  const bot = state.body.bots.find((item) => item.status === 'running')

  const retired = await call('/api/foundryApi', { action: 'retire', botId: bot.id }, { bearer: token })
  assert.equal(retired.body.status, 'retired')

  const after = await call('/api/foundryApi', { action: 'state' }, { bearer: token })
  assert.ok(!after.body.bots.some((item) => item.id === bot.id))
  assert.ok(after.body.events.some((event) => event.message.includes(bot.name)))
})
