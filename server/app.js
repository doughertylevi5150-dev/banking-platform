import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { config } from './config.js'
import { mountAuthRoutes } from './routes/auth.js'

export function createApp({ store, allowedOrigins = config.allowedOrigins } = {}) {
  const app = express()

  app.set('trust proxy', 1)
  app.use(helmet())
  app.use(
    cors({
      origin: allowedOrigins.length ? allowedOrigins : true,
      credentials: false,
      allowedHeaders: ['Content-Type', 'Authorization'],
      methods: ['GET', 'POST', 'OPTIONS'],
      maxAge: 600,
    }),
  )
  app.use(express.json({ limit: '64kb' }))

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }))

  mountAuthRoutes(app, store)

  app.use((_req, res) => res.status(404).json({ error: 'Not found.' }))

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err)
    res.status(500).json({ error: 'Something went wrong on our side.' })
  })

  return app
}
