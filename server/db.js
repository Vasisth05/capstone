import pg from 'pg'
import { config } from './config.js'

const { Pool } = pg

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: Number.parseInt(process.env.PG_POOL_SIZE ?? '10', 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined,
})

pool.on('error', (error) => {
  console.error('Unexpected idle PostgreSQL connection error:', error.message)
})

export async function verifyDatabaseConnection() {
  const result = await pool.query('SELECT 1 AS connected')
  return result.rows[0].connected === 1
}

export async function closeDatabase() {
  await pool.end()
}
