import 'dotenv/config'
import { createApp } from './app.js'
import { config } from './config.js'
import { createStore } from './store.js'

const store = createStore()
store.pruneSessions()

const app = createApp({ store })

app.listen(config.port, () => {
  console.log(`Auth API listening on http://localhost:${config.port}`)
  console.log(`Allowed origins: ${config.allowedOrigins.length ? config.allowedOrigins.join(', ') : 'any'}`)
})
