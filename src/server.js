import { createApp } from './app.js'
import { env } from './config/env.js'
import { prisma } from './lib/prisma.js'
import { createOltSync } from './lib/olt-sync.js'
import { getOpticalLookup } from './modules/customers/optical-lookup.js'
import { customerRepository } from './modules/customers/customer.repository.js'

const server = createApp().listen(env.port, () => {
  console.log(`API listening on port ${env.port} (${env.nodeEnv})`)
})

// Keep stored customer connection status fresh (<= 30 lookups/min, well under
// the OLT API's own limit). Only here, never in createApp(), so tests don't run it.
let oltSync = null
const optical = getOpticalLookup()
if (optical.enabled && process.env.NODE_ENV !== 'test' && env.olt.sync !== false) {
  oltSync = createOltSync({ lookup: optical, repo: customerRepository })
  oltSync.start()
  console.log('OLT status refresh: on (30/min)')
}

// Graceful shutdown: stop accepting connections, then close the DB pool, so
// container restarts/deploys don't drop in-flight requests or leak connections.
async function shutdown(signal) {
  console.log(`${signal} received — shutting down`)
  oltSync?.stop()
  server.close(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  // Force-exit if graceful close hangs.
  setTimeout(() => process.exit(1), 10000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
