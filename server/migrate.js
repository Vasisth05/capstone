import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { pool, closeDatabase } from './db.js'

const migrationDirectory = fileURLToPath(new URL('./migrations/', import.meta.url))

async function runMigrations() {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())')
  const connection = await pool.connect()
  try {
    await connection.query('SELECT pg_advisory_lock($1)', [4_287_221])
    const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort()
    const applied = new Set((await connection.query('SELECT name FROM schema_migrations')).rows.map((row) => row.name))

    for (const file of files) {
      if (applied.has(file)) continue
      const sql = await readFile(new URL(`./migrations/${file}`, import.meta.url), 'utf8')
      await connection.query('BEGIN')
      try {
        await connection.query(sql)
        await connection.query('INSERT INTO schema_migrations(name) VALUES($1)', [file])
        await connection.query('COMMIT')
        console.info(`Applied migration ${file}`)
      } catch (error) {
        await connection.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    await connection.query('SELECT pg_advisory_unlock($1)', [4_287_221])
    connection.release()
  }
}

runMigrations().catch((error) => {
  console.error('Database migration failed:', error.message)
  process.exitCode = 1
}).finally(closeDatabase)
