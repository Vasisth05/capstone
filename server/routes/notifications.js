import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { asyncRoute, HttpError, validate, writeAudit } from '../http.js'

const router = Router()
const listSchema = z.object({ unread: z.enum(['true', 'false']).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).strict()
const preferencesSchema = z.object({ absence: z.boolean().optional(), attendance: z.boolean().optional(), school_updates: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one preference.')
const idSchema = z.string().uuid()

router.get('/', requireAuth, asyncRoute(async (request, response) => {
  const filters = validate(listSchema, request.query)
  const params = [request.user.id]
  const where = ['recipient_user_id = $1']
  if (filters.unread === 'true') where.push('read_at IS NULL')
  if (filters.unread === 'false') where.push('read_at IS NOT NULL')
  const count = await pool.query(`SELECT count(*)::int AS total FROM notifications WHERE ${where.join(' AND ')}`, params)
  const limit = params.push(filters.pageSize)
  const offset = params.push((filters.page - 1) * filters.pageSize)
  const result = await pool.query(
    `SELECT id, kind, title, message, payload, read_at, created_at FROM notifications
     WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${limit} OFFSET $${offset}`,
    params,
  )
  response.json({ items: result.rows, total: count.rows[0].total, page: filters.page, pageSize: filters.pageSize })
}))

router.patch('/:notificationId/read', requireAuth, asyncRoute(async (request, response) => {
  const notificationId = validate(idSchema, request.params.notificationId)
  const result = await pool.query(
    'UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND recipient_user_id = $2 RETURNING id, read_at',
    [notificationId, request.user.id],
  )
  if (!result.rows[0]) throw new HttpError(404, 'Notification not found.', 'notification_not_found')
  response.json({ notification: result.rows[0] })
}))

router.patch('/read-all', requireAuth, asyncRoute(async (request, response) => {
  const result = await pool.query('UPDATE notifications SET read_at = now() WHERE recipient_user_id = $1 AND read_at IS NULL', [request.user.id])
  response.json({ updated: result.rowCount })
}))

router.get('/preferences', requireAuth, asyncRoute(async (request, response) => {
  const result = await pool.query('SELECT notification_preferences FROM users WHERE id = $1', [request.user.id])
  response.json({ preferences: result.rows[0].notification_preferences })
}))

router.patch('/preferences', requireAuth, asyncRoute(async (request, response) => {
  const input = validate(preferencesSchema, request.body)
  const result = await pool.query(
    `UPDATE users SET notification_preferences = notification_preferences || $2::jsonb, updated_at = now()
     WHERE id = $1 RETURNING notification_preferences`,
    [request.user.id, JSON.stringify(input)],
  )
  await writeAudit({ actorId: request.user.id, schoolId: request.user.school_id, action: 'notification_preferences_updated', resourceType: 'user', resourceId: request.user.id, metadata: input })
  response.json({ preferences: result.rows[0].notification_preferences })
}))

export default router
