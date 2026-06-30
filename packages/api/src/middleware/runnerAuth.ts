import type { MiddlewareHandler } from 'hono'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db, runners } from '@calqen/shared'

export const runnerAuth: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header('Authorization')
  const runnerId = c.req.header('X-Runner-ID')

  if (!auth || !auth.startsWith('Bearer ') || !runnerId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = auth.slice(7)
  const [runner] = await db.select().from(runners).where(eq(runners.id, runnerId))
  if (!runner) return c.json({ error: 'Unauthorized' }, 401)

  const valid = await bcrypt.compare(token, runner.tokenHash)
  if (!valid) return c.json({ error: 'Unauthorized' }, 401)

  c.set('runnerId' as never, runnerId)
  return await next()
}
