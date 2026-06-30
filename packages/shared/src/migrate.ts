import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const url = process.env['MIGRATIONS_DATABASE_URL']
  if (!url) throw new Error('MIGRATIONS_DATABASE_URL is required')

  const client = postgres(url, { max: 1 })
  const db = drizzle(client)

  console.log('Running migrations...')
  await migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') })
  console.log('Migrations complete.')

  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
