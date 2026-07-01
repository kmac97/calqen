import { z } from 'zod'

// Each schema lists only the variables that service actually needs to start — including ones it
// needs transitively (e.g. every service that imports db.ts needs DATABASE_URL even if it never
// writes `process.env['DATABASE_URL']` itself, and every orchestrator agent file constructs
// `new Anthropic()` with no explicit key, which reads ANTHROPIC_API_KEY internally). Variables
// with a working `?? fallback` in the code (CALQEN_API_URL, PORT, model names, etc.) are
// deliberately not required here — they're genuinely optional.
const nonEmptyString = z.string().min(1)

export const apiEnvSchema = z.object({
  DATABASE_URL: nonEmptyString,
  CALQEN_BOT_SERVICE_TOKEN: nonEmptyString,
  RUNNER_REGISTRATION_SECRET: nonEmptyString,
})

export const botEnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: nonEmptyString,
  AUTHORIZED_TELEGRAM_USER_IDS: nonEmptyString,
  AUTHORIZED_TELEGRAM_CHAT_IDS: nonEmptyString,
  CALQEN_BOT_SERVICE_TOKEN: nonEmptyString,
})

export const orchestratorEnvSchema = z.object({
  DATABASE_URL: nonEmptyString,
  ANTHROPIC_API_KEY: nonEmptyString,
  FIRECRAWL_API_KEY: nonEmptyString,
})

export const runnerEnvSchema = z.object({
  RUNNER_REGISTRATION_SECRET: nonEmptyString,
})

// Fails fast with the missing variable *names* only — never a value, never the ZodError's
// received-value detail, so a misconfigured deploy can't leak a partial secret into logs.
export function validateEnv<T extends z.ZodRawShape>(schema: z.ZodObject<T>, serviceName: string): void {
  const result = schema.safeParse(process.env)
  if (result.success) return

  const missing = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))]
  console.error(`[env] ${serviceName} is missing required environment variables: ${missing.join(', ')}`)
  process.exit(1)
}
