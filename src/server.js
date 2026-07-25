import { createApp } from './app.js'
import { env } from './config/env.js'
import { prisma } from './lib/prisma.js'

const server = createApp().listen(env.port, () => {
  console.log(`API listening on port ${env.port} (${env.nodeEnv})`)
})

// Graceful shutdown: stop accepting connections, then close the DB pool, so
// container restarts/deploys don't drop in-flight requests or leak connections.
async function shutdown(signal) {
  console.log(`${signal} received — shutting down`)
  server.close(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  // Force-exit if graceful close hangs.
  setTimeout(() => process.exit(1), 10000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
