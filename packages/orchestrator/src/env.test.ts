import { describe, it, expect, afterEach } from 'vitest'
import { envInt } from './env.js'

describe('envInt', () => {
  const KEY = 'CALQEN_TEST_ENV_INT'

  afterEach(() => { delete process.env[KEY] })

  it('returns the fallback when unset', () => {
    expect(envInt(KEY, 2)).toBe(2)
  })

  it('parses a valid numeric value', () => {
    process.env[KEY] = '5'
    expect(envInt(KEY, 2)).toBe(5)
  })

  it('returns the fallback for a non-numeric value instead of NaN', () => {
    process.env[KEY] = 'not-a-number'
    expect(envInt(KEY, 2)).toBe(2)
  })

  it('returns the fallback for an empty string', () => {
    process.env[KEY] = ''
    expect(envInt(KEY, 2)).toBe(2)
  })
})
