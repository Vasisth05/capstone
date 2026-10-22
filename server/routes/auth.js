import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { z } from 'zod'
import { config } from '../config.js'
import { pool } from '../db.js'
import { clearSessionCookie, requireAuth, setSessionCookie } from '../auth.js'
import { asyncRoute, HttpError, validate, writeAudit } from '../http.js'
import { deliverEmail } from '../services/mailer.js'

const router = Router()
const loginLimiter = process.env.RURALATTEND_TEST_DISABLE_LIMITERS === 'true'
  ? (_request, _response, next) => next()
  : (await import('express-rate-limit')).rateLimit({
    windowMs: config.loginWindowMs,
    limit: config.loginMaxAttempts,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Try again later.', code: 'rate_limited' },
  })
const passwordSchema = z.string().min(12).max(128).regex(/[A-Z]/, 'Include at least one uppercase letter.').regex(/[a-z]/, 'Include at least one lowercase letter.').regex(/[0-9]/, 'Include at least one number.')
const dummyPasswordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12)
const hashToken = (token) => createHash('sha256').update(token).digest('hex')

router.post('/login', loginLimiter, asyncRoute(async (request, response) => {
  const input = validate(z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) }).strict(), request.body)
  const result = await pool.query(
    `SELECT u.id, u.email, u.display_name, u.password_hash, u.role, u.school_id, u.district_scope,
            u.preferred_language, u.session_version, s.name AS school_name
     FROM users u LEFT JOIN schools s ON s.id = u.school_id
     WHERE u.email = lower($1) AND u.active = true`,
    [input.email.trim()],
  )
  const user = result.rows[0]
  const matches = await bcrypt.compare(input.password, user?.password_hash ?? dummyPasswordHash)
  if (!user || !matches) throw new HttpError(401, 'Email or password is incorrect.', 'invalid_credentials')
  setSessionCookie(response, user.id, user.session_version)
  await writeAudit({ actorId: user.id, schoolId: user.school_id, action: 'login', resourceType: 'session' })
  response.json({ user: { id: user.id, email: user.email, name: user.display_name, role: user.role, schoolId: user.school_id, schoolName: user.school_name, districtScope: user.district_scope, language: user.preferred_language } })
}))

router.post('/logout', requireAuth, asyncRoute(async (request, response) => {
  await pool.query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [request.user.id])
  await writeAudit({ actorId: request.user.id, schoolId: request.user.school_id, action: 'logout', resourceType: 'session' })
  clearSessionCookie(response)
  response.status(204).end()
}))

router.get('/me', requireAuth, (request, response) => {
  response.json({ user: { id: request.user.id, email: request.user.email, name: request.user.display_name, role: request.user.role, schoolId: request.user.school_id, schoolName: request.user.school_name, districtScope: request.user.district_scope, language: request.user.preferred_language } })
})

router.post('/forgot-password', asyncRoute(async (request, response) => {
  const input = validate(z.object({ email: z.string().email().max(254) }).strict(), request.body)
  const genericMessage = 'If an active account exists, password recovery instructions will be sent.'
  const userResult = await pool.query('SELECT id, email, display_name FROM users WHERE email = lower($1) AND active = true', [input.email.trim()])
  const user = userResult.rows[0]
  const deliveryConfigured = Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM) || !config.production
  if (user && deliveryConfigured) {
    const rawToken = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + config.resetTokenMinutes * 60_000)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('UPDATE password_reset_tokens SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL', [user.id])
      await client.query('INSERT INTO password_reset_tokens(user_id, token_hash, expires_at) VALUES($1, $2, $3)', [user.id, hashToken(rawToken), expiresAt])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    const resetUrl = `${config.resetBaseUrl}?token=${encodeURIComponent(rawToken)}`
    await deliverEmail({ to: user.email, subject: 'RuralAttend password reset', text: `Hello ${user.display_name},\n\nUse this one-time link within ${config.resetTokenMinutes} minutes:\n${resetUrl}\n\nIf you did not request this, ignore this message.` })
  }
  response.json({ message: genericMessage })
}))

router.post('/reset-password', asyncRoute(async (request, response) => {
  const input = validate(z.object({ token: z.string().min(32).max(128), password: passwordSchema }).strict(), request.body)
  const tokenHash = hashToken(input.token)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const tokenResult = await client.query(
      `SELECT id, user_id, purpose FROM password_reset_tokens
       WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() FOR UPDATE`,
      [tokenHash],
    )
    const token = tokenResult.rows[0]
    if (!token) throw new HttpError(400, 'This password reset link is invalid or expired.', 'reset_token_invalid')
    const passwordHash = await bcrypt.hash(input.password, 12)
    await client.query(
      `UPDATE users SET password_hash = $1, session_version = session_version + 1,
       active = CASE WHEN $3 = 'invite' THEN true ELSE active END,
       activated_at = CASE WHEN $3 = 'invite' THEN COALESCE(activated_at, now()) ELSE activated_at END,
       updated_at = now() WHERE id = $2`,
      [passwordHash, token.user_id, token.purpose],
    )
    await client.query('UPDATE password_reset_tokens SET consumed_at = now() WHERE id = $1', [token.id])
    await writeAudit({ client, action: token.purpose === 'invite' ? 'account_activated' : 'password_reset', resourceType: 'user', resourceId: token.user_id })
    await client.query('COMMIT')
    clearSessionCookie(response)
    response.json({ message: 'Password updated. Sign in with your new password.' })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

export default router
