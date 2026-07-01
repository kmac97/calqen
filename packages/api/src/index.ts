import { serve } from '@hono/node-server'
import { apiEnvSchema, validateEnv, closeDb } from '@calqen/shared'
import { app } from './app.js'
import { startLeaseExpiryJob } from './jobs/leaseExpiry.js'
import { startOrchestratorLeaseExpiryJob } from './jobs/orchestratorLeaseExpiry.js'

validateEnv(apiEnvSchema, 'api')

const port = parseInt(process.env['PORT'] ?? '3001', 10)

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`)
})

const leaseExpiryInterval = startLeaseExpiryJob()
console.log('[api] runner lease expiry job started (30s interval)')

const orchestratorLeaseExpiryInterval = startOrchestratorLeaseExpiryJob()
console.log('[api] orchestrator lease expiry job started (30s interval)')

async function shutdown() {
  clearInterval(leaseExpiryInterval)
  clearInterval(orchestratorLeaseExpiryInterval)
  server.close()
  await closeDb()
  console.log('[api] shutting down')
  process.exit(0)
}

process.on('SIGINT', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })
