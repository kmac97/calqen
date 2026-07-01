import { Hono } from 'hono'

export const healthRouter = new Hono()

// Public, unauthenticated (see docs/security.md's API Authentication table). GIT_SHA is only set
// in Docker builds (ARG GIT_SHA -> ENV GIT_SHA); local dev has no build step, so it falls back to
// 'dev'. This is the endpoint a reverse proxy or Docker HEALTHCHECK should hit — see
// docs/deployment.md.
healthRouter.get('/health', (c) => c.json({
  service: 'api',
  status: 'ok',
  version: process.env['GIT_SHA'] ?? 'dev',
  timestamp: new Date().toISOString(),
}))
