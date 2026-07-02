import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Plain-text checks, not a YAML parse — avoids adding a YAML dependency for one config file.
// Assumes `pnpm test` runs from the repo root (true both locally and in CI).
const composePath = resolve(process.cwd(), 'docker-compose.yml')
const compose = readFileSync(composePath, 'utf-8')

function serviceBlock(name: string): string {
  const match = compose.match(new RegExp(`\\n {2}${name}:\\n([\\s\\S]*?)(?=\\n {2}\\S|$)`))
  if (!match) throw new Error(`docker-compose.yml has no top-level service "${name}"`)
  return match[1]!
}

describe('docker-compose.yml networking', () => {
  it('publishes the api service only on loopback, never on all interfaces', () => {
    const api = serviceBlock('api')
    const portLines = api.match(/- .*3001:3001.*/g) ?? []
    expect(portLines.length).toBeGreaterThan(0)
    for (const line of portLines) {
      expect(line).toMatch(/127\.0\.0\.1:3001:3001/)
    }
  })

  it('overrides CALQEN_API_URL for the bot service to the compose-internal API DNS name', () => {
    const bot = serviceBlock('bot')
    expect(bot).toMatch(/CALQEN_API_URL=http:\/\/api:3001/)
  })

  it('does not override CALQEN_API_URL for the orchestrator service, which never calls the API', () => {
    const orchestrator = serviceBlock('orchestrator')
    expect(orchestrator).not.toMatch(/CALQEN_API_URL/)
  })

  it('never defines a runner service — the Runner stays off Docker per the Phase 1 boundary', () => {
    expect(compose).not.toMatch(/\n {2}runner:/)
  })

  it('never hardcodes a secret value — every service loads secrets from env_file only', () => {
    expect(compose).not.toMatch(/ANTHROPIC_API_KEY=\S/)
    expect(compose).not.toMatch(/DATABASE_URL=\S/)
    expect(compose).toMatch(/env_file: \.env/)
  })
})
