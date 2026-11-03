import { config } from './config'
import { closeDb } from './db/database'
import { createApp } from './app'
import { drainAsyncRoutes } from './middleware/asyncRoute'

const app = createApp()

const host = config.nodeEnv === 'production' ? '127.0.0.1' : '0.0.0.0'

const server = app.listen(config.port, host, () => {
  console.log(`[Server] Binwak API running at http://${host}:${config.port}`)
  console.log(`[Server] Environment: ${config.nodeEnv}`)
})

let shutdownStarted = false
function shutdown(): void {
  if (shutdownStarted) return
  shutdownStarted = true
  console.log('\n[Server] Shutting down...')
  let timedOut = false
  const deadline = setTimeout(() => {
    timedOut = true
    console.error('[Server] Shutdown exceeded 30 seconds; forcing exit')
    server.closeAllConnections()
    process.exit(1)
  }, 30_000)
  server.close(() => {
    void drainAsyncRoutes().then(() => {
      if (timedOut) return
      clearTimeout(deadline)
      closeDb()
      process.exit(0)
    })
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

export default app
