import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateShortId } from './shortid.js'
import { calculateCost } from './costs.js'
import { redactSecrets, redactSecretsDeep } from './redact.js'
import { computeScopeHash } from './hash.js'

describe('generateShortId', () => {
  it('returns an 8-char hex string', () => {
    const id = generateShortId()
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('returns unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateShortId()))
    expect(ids.size).toBe(100)
  })
})

describe('calculateCost', () => {
  it('calculates sonnet cost correctly', () => {
    const cost = calculateCost('claude-sonnet-4-6', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(18.0)
  })

  it('calculates haiku cost correctly', () => {
    const cost = calculateCost('claude-haiku-4-5-20251001', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(6.0)
  })

  it('returns 0 for unknown model', () => {
    expect(calculateCost('unknown-model', 1000, 1000)).toBe(0)
  })

  it('handles zero tokens', () => {
    expect(calculateCost('claude-sonnet-4-6', 0, 0)).toBe(0)
  })

  it('handles small token counts', () => {
    const cost = calculateCost('claude-sonnet-4-6', 1000, 500)
    expect(cost).toBeCloseTo((1000 / 1_000_000) * 3.0 + (500 / 1_000_000) * 15.0)
  })
})

describe('redactSecrets', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-real-key-value-here-xxxx')
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '1234567890:ABCDEFGHIJKLMNopqrstuvwxyz12345')
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@host:5432/db')
    vi.stubEnv('CALQEN_BOT_SERVICE_TOKEN', 'supersecretbottoken12345')
  })

  it('redacts known env key values', () => {
    const result = redactSecrets('key is sk-ant-real-key-value-here-xxxx ok')
    expect(result).toBe('key is [REDACTED_ANTHROPIC_API_KEY] ok')
  })

  it('redacts github tokens', () => {
    const token = 'ghp_' + 'A'.repeat(36)
    const result = redactSecrets(`token: ${token}`)
    expect(result).toBe('token: [REDACTED_GITHUB_TOKEN]')
  })

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature123'
    const result = redactSecrets(jwt)
    expect(result).toBe('[REDACTED_JWT]')
  })

  it('redacts postgres URIs', () => {
    const result = redactSecrets('connect to postgres://user:secret@host:5432/db now')
    expect(result).toBe('connect to [REDACTED_POSTGRES_URI] now')
  })

  it('redacts bearer tokens', () => {
    const result = redactSecrets('Authorization: Bearer abc123token')
    expect(result).toBe('Authorization: Bearer [REDACTED]')
  })

  it('does not redact short values like port numbers', () => {
    vi.stubEnv('PORT', '3001')
    const result = redactSecrets('port is 3001')
    // 3001 is 4 chars, below the 8-char threshold, so not redacted
    expect(result).toBe('port is 3001')
  })

  it('does not redact boolean-like values', () => {
    vi.stubEnv('RUNNER_DRY_RUN', 'true')
    const result = redactSecrets('dry run is true')
    expect(result).toBe('dry run is true')
  })
})

describe('redactSecretsDeep', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-real-key-value-here-xxxx')
  })

  it('redacts strings in objects', () => {
    const result = redactSecretsDeep({ key: 'sk-ant-real-key-value-here-xxxx' })
    expect((result as Record<string, string>)['key']).toBe('[REDACTED_ANTHROPIC_API_KEY]')
  })

  it('redacts strings in nested objects', () => {
    const result = redactSecretsDeep({ nested: { prompt: 'use sk-ant-real-key-value-here-xxxx' } })
    const nested = (result as Record<string, Record<string, string>>)['nested']
    expect(nested?.['prompt']).toBe('use [REDACTED_ANTHROPIC_API_KEY]')
  })

  it('redacts strings in arrays', () => {
    const result = redactSecretsDeep(['sk-ant-real-key-value-here-xxxx', 'safe'])
    expect(result).toEqual(['[REDACTED_ANTHROPIC_API_KEY]', 'safe'])
  })

  it('passes through numbers and booleans unchanged', () => {
    const result = redactSecretsDeep({ count: 42, flag: true })
    expect(result).toEqual({ count: 42, flag: true })
  })
})

describe('computeScopeHash', () => {
  it('returns a 64-char hex string', () => {
    const hash = computeScopeHash({ a: 1 })
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces identical hash for same content regardless of key order', () => {
    const h1 = computeScopeHash({ a: 1, b: 2 })
    const h2 = computeScopeHash({ b: 2, a: 1 })
    expect(h1).toBe(h2)
  })

  it('produces different hash for different content', () => {
    const h1 = computeScopeHash({ a: 1 })
    const h2 = computeScopeHash({ a: 2 })
    expect(h1).not.toBe(h2)
  })

  it('handles nested objects with sorted keys', () => {
    const h1 = computeScopeHash({ files: ['a', 'b'], meta: { z: 1, a: 2 } })
    const h2 = computeScopeHash({ meta: { a: 2, z: 1 }, files: ['a', 'b'] })
    expect(h1).toBe(h2)
  })

  it('treats array order as significant', () => {
    const h1 = computeScopeHash({ files: ['a', 'b'] })
    const h2 = computeScopeHash({ files: ['b', 'a'] })
    expect(h1).not.toBe(h2)
  })
})
