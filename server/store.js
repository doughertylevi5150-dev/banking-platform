import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { config } from './config.js'

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
  renameSync(tmp, file)
}

function readAll() {
  return {
    users: readJson(config.usersFile, []),
    sessions: readJson(config.sessionsFile, []),
  }
}

export function createStore({ usersFile = config.usersFile, sessionsFile = config.sessionsFile } = {}) {
  const files = { users: usersFile, sessions: sessionsFile }

  function load() {
    return {
      users: readJson(files.users, []),
      sessions: readJson(files.sessions, []),
    }
  }

  function save({ users, sessions }) {
    writeJson(files.users, users)
    writeJson(files.sessions, sessions)
  }

  return {
    findUserByEmail(email) {
      return load().users.find((user) => user.email === email) || null
    },
    findUserById(id) {
      return load().users.find((user) => user.id === id) || null
    },
    findOwner() {
      return load().users.find((user) => user.role === 'owner') || null
    },
    createUser({ email, name, passwordHash, role = 'owner' }) {
      const state = load()
      const user = {
        id: randomUUID(),
        email,
        name,
        role,
        passwordHash,
        createdAt: new Date().toISOString(),
      }
      state.users.push(user)
      save(state)
      return user
    },
    createSession({ id, userId, expiresAt }) {
      const state = load()
      state.sessions.push({ id, userId, createdAt: new Date().toISOString(), expiresAt })
      save(state)
      return state.sessions.at(-1)
    },
    findSession(id) {
      return load().sessions.find((session) => session.id === id) || null
    },
    deleteSession(id) {
      const state = load()
      const next = state.sessions.filter((session) => session.id !== id)
      const removed = next.length !== state.sessions.length
      if (removed) {
        state.sessions = next
        save(state)
      }
      return removed
    },
    pruneSessions(now = Date.now()) {
      const state = load()
      const next = state.sessions.filter((session) => Date.parse(session.expiresAt) > now)
      if (next.length !== state.sessions.length) {
        state.sessions = next
        save(state)
      }
    },
    reset() {
      save({ users: [], sessions: [] })
    },
    raw: readAll,
  }
}
