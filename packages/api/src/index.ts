import { serve } from '@hono/node-server'
import { app } from './app.js'
import { startLeaseExpiryJob } from './jobs/leaseExpiry.js'
import { startOrchestratorLeaseExpiryJob } from './jobs/orchestratorLeaseExpiry.js'

const port = parseInt(process.env['PORT'] ?? '3001', 10)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`)
})

startLeaseExpiryJob()
console.log('[api] runner lease expiry job started (30s interval)')

startOrchestratorLeaseExpiryJob()
console.log('[api] orchestrator lease expiry job started (30s interval)')
