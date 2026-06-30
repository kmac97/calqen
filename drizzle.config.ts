import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/shared/src/schema.ts',
  out: './packages/shared/src/migrations',
  dbCredentials: {
    url: process.env['MIGRATIONS_DATABASE_URL']!,
  },
})
