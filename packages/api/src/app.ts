import { Hono } from 'hono'
import { healthRouter } from './routes/health.js'
import { runnerRouter } from './routes/runner.js'
import { botRouter } from './routes/bot.js'

export function createApp() {
  const app = new Hono()

  app.route('/api', healthRouter)
  app.route('/api/runner', runnerRouter)
  app.route('/api', botRouter)

  app.onError((err, c) => {
    console.error('[api] unhandled error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  })

  app.notFound((c) => c.json({ error: 'Not found' }, 404))

  return app
}

export const app = createApp()
