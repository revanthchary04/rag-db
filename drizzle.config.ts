import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// Load env from the usual local files; the FastAPI backend's DATABASE_URL in
// backend/.env is also honored as a fallback below.
config({ path: '.env.local' })
config({ path: '.env' })
config({ path: 'backend/.env' })

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './src/lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.POSTGRES_URL ??
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/ragdb',
  },
})
