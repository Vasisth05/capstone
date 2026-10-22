import 'dotenv/config'
import { randomBytes } from 'node:crypto'

const nodeEnv = process.env.NODE_ENV ?? 'development'
const production = nodeEnv === 'production'
const configuredSecret = process.env.JWT_SECRET

if (production && (!configuredSecret || configuredSecret.length < 32)) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters in production.')
}

export const config = Object.freeze({
  nodeEnv,
  production,
  port: Number.parseInt(process.env.API_PORT ?? '3001', 10),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: configuredSecret ?? randomBytes(32).toString('hex'),
  cookieName: 'ruralattend_session',
  appOrigins: (process.env.APP_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((origin) => origin.trim()).filter(Boolean),
  resetBaseUrl: process.env.PASSWORD_RESET_BASE_URL ?? 'http://localhost:5173/reset-password',
  resetTokenMinutes: Number.parseInt(process.env.PASSWORD_RESET_MINUTES ?? '30', 10),
  loginWindowMs: 15 * 60 * 1000,
  loginMaxAttempts: 10,
})
