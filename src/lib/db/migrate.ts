import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

config({ path: '.env.local' })
config({ path: '.env' })
config({ path: 'backend/.env' })

const runMigrate = async () => {
  const url =
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/ragdb'

  const connection = postgres(url, { max: 1 })
  const db = drizzle(connection)

  console.log('⏳ Running Drizzle migrations (chat/auth tables)...')
  const start = Date.now()
  await migrate(db, { migrationsFolder: './src/lib/db/migrations' })
  console.log('✅ Migrations completed in', Date.now() - start, 'ms')
  await connection.end()
  process.exit(0)
}

runMigrate().catch(err => {
  console.error('❌ Migration failed')
  console.error(err)
  process.exit(1)
})
