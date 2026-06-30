import type { MiddlewareHandler } from 'hono'

const HOUR_MS = 60 * 60 * 1000
const MAX_ATTEMPTS = 5

// ponytail: in-memory Map; fine for single-process, single-runner use case
const attempts = new Map<string, { count: number; resetAt: number }>()

export const registrationRateLimit: MiddlewareHandler = async (c, next) => {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown'

  const now = Date.now()
  const record = attempts.get(ip)

  if (record) {
    if (now > record.resetAt) {
      record.count = 1
      record.resetAt = now + HOUR_MS
    } else if (record.count >= MAX_ATTEMPTS) {
      return c.json({ error: 'Too many registration attempts' }, 429)
    } else {
      record.count++
    }
  } else {
    attempts.set(ip, { count: 1, resetAt: now + HOUR_MS })
  }

  return await next()
}
