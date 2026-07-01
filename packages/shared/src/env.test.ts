import { describe, it, expect, vi, afterEach } from 'vitest'
import { validateEnv, apiEnvSchema, botEnvSchema, orchestratorEnvSchema, runnerEnvSchema } from './env.js'

describe('validateEnv', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('passes for a valid apiEnvSchema config without exiting', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@host:5432/db')
    vi.stubEnv('CALQEN_BOT_SERVICE_TOKEN', 'token123')
    vi.stubEnv('RUNNER_REGISTRATION_SECRET', 'secret123')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    validateEnv(apiEnvSchema, 'api')

    expect(exitSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('exits with code 1 and lists exact missing variable names when config is incomplete', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@host:5432/db')
    // CALQEN_BOT_SERVICE_TOKEN and RUNNER_REGISTRATION_SECRET deliberately left unset
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    validateEnv(apiEnvSchema, 'api')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const message = errorSpy.mock.calls[0]?.[0] as string
    expect(message).toContain('api is missing required environment variables')
    expect(message).toContain('CALQEN_BOT_SERVICE_TOKEN')
    expect(message).toContain('RUNNER_REGISTRATION_SECRET')
  })

  it('never includes a variable value in the error message, even when one is set', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://user:supersecretpassword@host:5432/db')
    // CALQEN_BOT_SERVICE_TOKEN and RUNNER_REGISTRATION_SECRET left unset
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    validateEnv(apiEnvSchema, 'api')

    const message = errorSpy.mock.calls[0]?.[0] as string
    expect(message).not.toContain('supersecretpassword')
    expect(message).not.toContain('postgresql://')
  })

  it('rejects an empty-string value the same as a missing one', () => {
    vi.stubEnv('DATABASE_URL', '')
    vi.stubEnv('CALQEN_BOT_SERVICE_TOKEN', 'token123')
    vi.stubEnv('RUNNER_REGISTRATION_SECRET', 'secret123')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    validateEnv(apiEnvSchema, 'api')

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('validates botEnvSchema requires TELEGRAM_BOT_TOKEN and the Telegram allow-lists', () => {
    vi.stubEnv('CALQEN_BOT_SERVICE_TOKEN', 'token123')
    // TELEGRAM_BOT_TOKEN, AUTHORIZED_TELEGRAM_USER_IDS, AUTHORIZED_TELEGRAM_CHAT_IDS left unset
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    validateEnv(botEnvSchema, 'bot')

    const message = errorSpy.mock.calls[0]?.[0] as string
    expect(message).toContain('TELEGRAM_BOT_TOKEN')
    expect(message).toContain('AUTHORIZED_TELEGRAM_USER_IDS')
    expect(message).toContain('AUTHORIZED_TELEGRAM_CHAT_IDS')
  })

  it('validates orchestratorEnvSchema requires ANTHROPIC_API_KEY, DATABASE_URL, and FIRECRAWL_API_KEY', () => {
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    validateEnv(orchestratorEnvSchema, 'orchestrator')

    const message = errorSpy.mock.calls[0]?.[0] as string
    expect(message).toContain('ANTHROPIC_API_KEY')
    expect(message).toContain('DATABASE_URL')
    expect(message).toContain('FIRECRAWL_API_KEY')
  })

  it('validates runnerEnvSchema requires RUNNER_REGISTRATION_SECRET', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    validateEnv(runnerEnvSchema, 'runner')

    expect(exitSpy).toHaveBeenCalledWith(1)
    const message = errorSpy.mock.calls[0]?.[0] as string
    expect(message).toContain('RUNNER_REGISTRATION_SECRET')
  })
})
