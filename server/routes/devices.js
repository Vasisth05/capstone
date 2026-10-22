import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth, requireRoles } from '../auth.js'
import { asyncRoute, HttpError, validate, writeAudit } from '../http.js'

const router = Router()
const registerSchema = z.object({ deviceLabel: z.string().trim().min(1).max(100) }).strict()
const deviceIdSchema = z.string().uuid()
const schoolIdFor = (user) => {
  if (!user.school_id) throw new HttpError(403, 'No school is assigned to this account.', 'school_scope_missing')
  return user.school_id
}

router.post('/register', requireAuth, requireRoles('teacher', 'principal', 'school_admin'), asyncRoute(async (request, response) => {
  const { deviceLabel } = validate(registerSchema, request.body)
  const schoolId = schoolIdFor(request.user)
  const prior = await pool.query('SELECT id FROM devices WHERE user_id = $1 AND device_label = $2', [request.user.id, deviceLabel])
  const result = await pool.query(
    `INSERT INTO devices(user_id, school_id, device_label, last_seen_at) VALUES($1, $2, $3, now())
     ON CONFLICT(user_id, device_label) DO UPDATE SET school_id = EXCLUDED.school_id, last_seen_at = now()
     RETURNING id, device_label, last_seen_at, created_at`,
    [request.user.id, schoolId, deviceLabel],
  )
  if (!prior.rows[0]) {
    await writeAudit({ actorId: request.user.id, schoolId, action: 'device_registered', resourceType: 'device', resourceId: result.rows[0].id })
  }
  response.status(200).json({ device: result.rows[0] })
}))

router.get('/', requireAuth, requireRoles('teacher', 'principal', 'school_admin'), asyncRoute(async (request, response) => {
  const user = request.user
  const schoolId = schoolIdFor(user)
  const params = [schoolId]
  const userFilter = user.role === 'teacher' ? 'AND d.user_id = $2' : ''
  if (user.role === 'teacher') params.push(user.id)
  const result = await pool.query(
    `SELECT d.id, d.user_id, d.device_label, d.last_seen_at, d.created_at, u.display_name, u.role
     FROM devices d JOIN users u ON u.id = d.user_id
     WHERE d.school_id = $1 ${userFilter}
     ORDER BY d.last_seen_at DESC NULLS LAST, d.created_at DESC`,
    params,
  )
  response.json({ items: result.rows })
}))

router.delete('/:deviceId', requireAuth, requireRoles('teacher', 'principal', 'school_admin'), asyncRoute(async (request, response) => {
  const deviceId = validate(deviceIdSchema, request.params.deviceId)
  const schoolId = schoolIdFor(request.user)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const deviceResult = await client.query(
      `SELECT d.id, d.user_id, d.device_label, u.display_name
       FROM devices d JOIN users u ON u.id = d.user_id
       WHERE d.id = $1 AND d.school_id = $2 AND ($3::text <> 'teacher' OR d.user_id = $4)
       FOR UPDATE OF d, u`,
      [deviceId, schoolId, request.user.role, request.user.id],
    )
    const device = deviceResult.rows[0]
    if (!device) throw new HttpError(404, 'Device not found in your authorized scope.', 'device_not_found')
    await client.query('DELETE FROM devices WHERE id = $1 AND school_id = $2', [deviceId, schoolId])
    await client.query('UPDATE users SET session_version = session_version + 1, updated_at = now() WHERE id = $1', [device.user_id])
    await writeAudit({
      client, actorId: request.user.id, schoolId, action: 'device_revoked', resourceType: 'device', resourceId: device.id,
      metadata: { deviceLabel: device.device_label, ownerName: device.display_name, sessionsRevoked: true },
    })
    await client.query('COMMIT')
    response.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}))

export default router
