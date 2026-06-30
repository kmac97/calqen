import { serve } from '@hono/node-server'
import { app } from './app.js'
import { startLeaseExpiryJob } from './jobs/leaseExpiry.js'

const port = parseInt(process.env['PORT'] ?? '3001', 10)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`)
})

startLeaseExpiryJob()
console.log('[api] lease expiry job started (30s interval)')
