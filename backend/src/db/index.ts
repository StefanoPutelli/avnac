import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../config/env'
import { schema } from './schema'

export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  prepare: false,
  // Idempotent migrations emit "already exists, skipping" notices on every boot.
  onnotice: () => {},
})

export const db = drizzle(sql, { schema })

const migrationsDir = fileURLToPath(new URL('../../drizzle/', import.meta.url))

// ponytail: re-runs every file on boot, so each must be idempotent (IF NOT EXISTS);
// add a tracking table once a migration can't be written that way.
export async function migrate(): Promise<void> {
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql'))
  for (const file of files.sort()) {
    await sql.file(migrationsDir + file)
  }
}
