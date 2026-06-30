import type { MiddlewareHandler } from 'hono'

export const registrationAuth: MiddlewareHandler = async (c, next) => {
  // Hono caches parsed body so the route handler can call c.req.json() again
  const body = await c.req.json().catch(() => null)
  const secret = (body as { registrationSecret?: unknown } | null)?.registrationSecret
  if (secret !== process.env['RUNNER_REGISTRATION_SECRET']) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return await next()
}
