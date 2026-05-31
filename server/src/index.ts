import { config } from './config'
import { closeDb } from './db/database'
import { createApp } from './app'

const app = createApp()

const host = config.nodeEnv === 'production' ? '127.0.0.1' : '0.0.0.0'

const server = app.listen(config.port, host, () => {
  console.log(`[Server] Binwak API running at http://${host}:${config.port}`)
  console.log(`[Server] Environment: ${config.nodeEnv}`)
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...')
  closeDb()
  server.close(() => {
    process.exit(0)
  })
})

process.on('SIGTERM', () => {
  closeDb()
  server.close(() => {
    process.exit(0)
  })
})

export default app
