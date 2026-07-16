import 'server-only'

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

/**
 * Single shared Postgres client for Drizzle. Points at the same `ragdb` the
 * FastAPI backend uses — `POSTGRES_URL` is preferred (template convention),
 * falling back to the existing `DATABASE_URL`.
 */
const connectionString =
  process.env.POSTGRES_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/ragdb'

const client = postgres(connectionString)
export const db = drizzle(client)
