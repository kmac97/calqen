const SECRET_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'DATABASE_URL',
  'MIGRATIONS_DATABASE_URL',
  'SUPABASE_URL',
  'GITHUB_TOKEN',
  'FIRECRAWL_API_KEY',
  'RUNNER_REGISTRATION_SECRET',
  'CALQEN_BOT_SERVICE_TOKEN',
] as const

const PATTERN_REDACTIONS: Array<[RegExp, string]> = [
  [/gh[ps]_[A-Za-z0-9]{36,}/g, '[REDACTED_GITHUB_TOKEN]'],
  [/eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, '[REDACTED_JWT]'],
  [/postgres(?:ql)?:\/\/[^@\s]+@[^\s"']+/gi, '[REDACTED_POSTGRES_URI]'],
  [/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [REDACTED]'],
]

export function redactSecrets(text: string): string {
  let result = text

  for (const key of SECRET_ENV_KEYS) {
    const value = process.env[key]
    if (value && value.length > 8) {
      result = result.replaceAll(value, `[REDACTED_${key}]`)
    }
  }

  for (const [pattern, replacement] of PATTERN_REDACTIONS) {
    result = result.replace(pattern, replacement)
  }

  return result
}

export function redactSecretsDeep(obj: unknown): unknown {
  if (typeof obj === 'string') return redactSecrets(obj)
  if (Array.isArray(obj)) return obj.map(redactSecretsDeep)
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, redactSecretsDeep(v)]),
    )
  }
  return obj
}
