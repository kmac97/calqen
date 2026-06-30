import type { MiddlewareHandler } from 'hono'

export const botAuth: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header('Authorization')
  const expected = `Bearer ${process.env['CALQEN_BOT_SERVICE_TOKEN']}`
  if (!auth || auth !== expected) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return await next()
}
