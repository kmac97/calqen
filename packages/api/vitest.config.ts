import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'api',
    include: ['src/**/*.test.ts'],
    env: {
      DATABASE_URL: process.env['DATABASE_URL'] ?? 'postgres://fake:fake@localhost:5432/fake',
      CALQEN_BOT_SERVICE_TOKEN: process.env['CALQEN_BOT_SERVICE_TOKEN'] ?? 'test-bot-token',
      RUNNER_REGISTRATION_SECRET:
        process.env['RUNNER_REGISTRATION_SECRET'] ?? 'test-reg-secret',
    },
  },
})
