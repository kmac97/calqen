import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema.js'

const client = postgres(process.env['DATABASE_URL']!, {
  prepare: false, // Required: Supabase transaction pooling
  max: 10,
})

export const db = drizzle(client, { schema })
export type DB = typeof db
export type DBTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

// For graceful shutdown — the raw postgres client itself stays unexported to keep this module's
// surface narrow; callers only get a clean close, never direct access to the connection pool.
export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 })
}
