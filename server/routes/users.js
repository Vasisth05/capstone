import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { z } from 'zod'
import { config } from '../config.js'
import { pool } from '../db.js'
import { requireAuth, requireRoles } from '../auth.js'
import { asyncRoute, HttpError, validate, writeAudit } from '../http.js'
import { deliverEmail } from '../services/mailer.js'

const router = Router()
const inviteSchema = z.object({ email: z.string().email().max(254), displayName: z.string().trim().min(1).max(160), role: z.enum(['teacher', 'parent']), staffCode: z.string().trim().min(1).max(40).optional(), subject: z.string().trim().max(120).optional() }).strict().superRefine((input, context) => {
  if (input.role === 'teacher' && !input.staffCode) context.addIssue({ code: 'custom', path: ['staffCode'], message: 'Teacher accounts require a staff code.' })
  if (input.role === 'parent' && input.staffCode) context.addIssue({ code: 'custom', path: ['staffCode'], message: 'Parent accounts cannot have a staff code.' })
})
const roleSchema = z.object({ role: z.enum(['teacher', 'parent']) }).strict()
const accountStatusSchema = z.object({ active: z.boolean() }).strict()
const linksSchema = z.object({ studentIds: z.array(z.string().uuid()).min(1).max(50) }).strict()
const preferencesSchema = z.object({
  language: z.enum(['en', 'hi']).optional(),
  absence: z.boolean().optional(),
  attendance: z.boolean().optional(),
  school_updates: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one preference.')
const idSchema = z.string().uuid()
const hashToken = (token) => createHash('sha256').update(token).digest('hex')

function requireSchool(user) {
  if (!user.school_id) throw new HttpError(403, 'No school is assigned to this account.', 'school_scope_missing')
  return user.school_id
}

router.get('/', requireAuth, requireRoles('principal', 'school_admin'), asyncRoute(async (request, response) => {
  const schoolId = requireSchool(request.user)
  const result = await pool.query(
    `SELECT u.id, u.email, u.display_name, u.role, u.active, u.activated_at, u.preferred_language, u.created_at,
       t.id AS teacher_id, t.staff_code, t.subject
     FROM users u LEFT JOIN teachers t ON t.user_id = u.id
     WHERE u.school_id = $1 AND u.role IN ('teacher', 'parent', 'principal', 'school_admin')
     ORDER BY u.role, u.display_name LIMIT 200`,
    [schoolId],
  )
  response.json({ items: result.rows })
}))

router.post('/', requireAuth, requireRoles('school_admin'), asyncRoute(async (request, response) => {
  const input = validate(inviteSchema, request.body)
  const schoolId = requireSchool(request.user)
  const rawToken = randomBytes(32).toString('base64url')
  const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12)
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const inserted = await client.query(
      `INSERT INTO users(school_id, email, display_name, password_hash, role, active)
       VALUES($1, lower($2), $3, $4, $5, false) RETURNING id, email, display_name, role`,
      [schoolId, input.email.trim(), input.displayName, passwordHash, input.role],
    )
    const user = inserted.rows[0]
    if (input.role === 'teacher') {
      await client.query('INSERT INTO teachers(user_id, school_id, staff_code, subject) VALUES($1, $2, $3, $4)', [user.id, schoolId, input.staffCode, input.subject ?? null])
    } else await client.query('INSERT INTO parents(user_id) VALUES($1)', [user.id])
    await client.query('INSERT INTO password_reset_tokens(user_id, token_hash, purpose, expires_at) VALUES($1, $2, \'invite\', $3)', [user.id, hashToken(rawToken), expiresAt])
    await writeAudit({ client, actorId: request.user.id, schoolId, action: 'user_invited', resourceType: 'user', resourceId: user.id, metadata: { role: user.role } })
    await client.query('COMMIT')
    const inviteUrl = `${config.resetBaseUrl}?token=${encodeURIComponent(rawToken)}`
    const delivery = await deliverEmail({ to: user.email, subject: 'Set up your RuralAttend account', text: `Hello ${user.display_name},\n\nSet a password for your RuralAttend account within 24 hours:\n${inviteUrl}` })
    response.status(201).json({ user, invitation: delivery.delivered ? 'sent' : delivery.developmentLogged ? 'logged_in_development' : 'delivery_not_configured' })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

router.patch('/me/preferences', requireAuth, asyncRoute(async (request, response) => {
  const input = validate(preferencesSchema, request.body)
  const preferencePatch = { absence: input.absence, attendance: input.attendance, school_updates: input.school_updates }
  for (const key of Object.keys(preferencePatch)) if (preferencePatch[key] === undefined) delete preferencePatch[key]
  const result = await pool.query(
    `UPDATE users SET preferred_language = COALESCE($2, preferred_language),
     notification_preferences = notification_preferences || $3::jsonb, updated_at = now()
     WHERE id = $1 RETURNING preferred_language, notification_preferences`,
    [request.user.id, input.language ?? null, JSON.stringify(preferencePatch)],
  )
  await writeAudit({ actorId: request.user.id, schoolId: request.user.school_id, action: 'user_preferences_updated', resourceType: 'user', resourceId: request.user.id, metadata: input })
  response.json({ language: result.rows[0].preferred_language, notifications: result.rows[0].notification_preferences })
}))

router.patch('/:userId/status', requireAuth, requireRoles('school_admin'), asyncRoute(async (request, response) => {
  const userId = validate(idSchema, request.params.userId)
  const { active } = validate(accountStatusSchema, request.body)
  const schoolId = requireSchool(request.user)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query(
      `SELECT id, display_name, role, active, activated_at FROM users
       WHERE id = $1 AND school_id = $2 AND role = 'parent' FOR UPDATE`,
      [userId, schoolId],
    )
    const target = current.rows[0]
    if (!target) throw new HttpError(404, 'Parent account not found in your school.', 'parent_not_found')
    if (!target.activated_at) throw new HttpError(409, 'This invitation has not been claimed yet.', 'account_not_activated')
    if (target.active === active) {
      await client.query('COMMIT')
      return response.json({ user: target })
    }
    const result = await client.query(
      `UPDATE users SET active = $3, session_version = session_version + 1, updated_at = now()
       WHERE id = $1 AND school_id = $2 AND role = 'parent'
       RETURNING id, display_name, role, active, activated_at`,
      [userId, schoolId, active],
    )
    await writeAudit({ client, actorId: request.user.id, schoolId, action: active ? 'parent_account_reactivated' : 'parent_account_deactivated', resourceType: 'user', resourceId: userId })
    await client.query('COMMIT')
    response.json({ user: result.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

router.patch('/:userId/role', requireAuth, requireRoles('school_admin'), asyncRoute(async (request, response) => {
  const userId = validate(idSchema, request.params.userId)
  const input = validate(roleSchema, request.body)
  const schoolId = requireSchool(request.user)
  const result = await pool.query('SELECT id, email, display_name, role, active FROM users WHERE id = $1 AND school_id = $2 AND role IN (\'teacher\', \'parent\')', [userId, schoolId])
  const target = result.rows[0]
  if (!target) throw new HttpError(404, 'Account not found in your school.', 'user_not_found')
  if (target.role !== input.role) throw new HttpError(409, 'Changing between teacher and parent accounts requires a new invitation so profile records and historical links stay intact.', 'role_change_requires_new_invitation')
  response.json({ user: target })
}))

router.post('/:parentUserId/children', requireAuth, requireRoles('school_admin'), asyncRoute(async (request, response) => {
  const parentUserId = validate(idSchema, request.params.parentUserId)
  const input = validate(linksSchema, request.body)
  const schoolId = requireSchool(request.user)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const parent = await client.query('SELECT p.id FROM parents p JOIN users u ON u.id = p.user_id WHERE u.id = $1 AND u.school_id = $2 AND u.role = \'parent\'', [parentUserId, schoolId])
    if (!parent.rows[0]) throw new HttpError(404, 'Parent account not found in your school.', 'parent_not_found')
    if (new Set(input.studentIds).size !== input.studentIds.length) throw new HttpError(400, 'Each student can only be selected once.', 'duplicate_student_link')
    const students = await client.query('SELECT id FROM students WHERE school_id = $1 AND id = ANY($2::uuid[])', [schoolId, input.studentIds])
    if (students.rows.length !== new Set(input.studentIds).size) throw new HttpError(400, 'Every selected child must be a unique student in your school.', 'student_scope_invalid')
    for (const studentId of input.studentIds) await client.query('INSERT INTO parent_students(parent_id, student_id) VALUES($1, $2) ON CONFLICT DO NOTHING', [parent.rows[0].id, studentId])
    await writeAudit({ client, actorId: request.user.id, schoolId, action: 'parent_children_linked', resourceType: 'parent', resourceId: parentUserId, metadata: { studentIds: input.studentIds } })
    await client.query('COMMIT')
    response.status(201).json({ linked: input.studentIds.length })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

router.get('/:parentUserId/children', requireAuth, requireRoles('school_admin', 'principal'), asyncRoute(async (request, response) => {
  const parentUserId = validate(idSchema, request.params.parentUserId)
  const schoolId = requireSchool(request.user)
  const result = await pool.query(
    `SELECT s.id, s.admission_number, s.display_name, c.name AS class_name, c.section
     FROM parents p JOIN users u ON u.id = p.user_id
     JOIN parent_students ps ON ps.parent_id = p.id
     JOIN students s ON s.id = ps.student_id AND s.school_id = u.school_id
     JOIN school_classes c ON c.id = s.class_id
     WHERE u.id = $1 AND u.school_id = $2 ORDER BY s.display_name`,
    [parentUserId, schoolId],
  )
  response.json({ items: result.rows })
}))

router.delete('/:parentUserId/children/:studentId', requireAuth, requireRoles('school_admin'), asyncRoute(async (request, response) => {
  const parentUserId = validate(idSchema, request.params.parentUserId)
  const studentId = validate(idSchema, request.params.studentId)
  const result = await pool.query(
    `DELETE FROM parent_students ps USING parents p, users u, students s
     WHERE ps.parent_id = p.id AND p.user_id = u.id AND s.id = ps.student_id
       AND u.id = $1 AND u.school_id = $2 AND s.id = $3 AND s.school_id = $2 RETURNING ps.student_id`,
    [parentUserId, requireSchool(request.user), studentId],
  )
  if (!result.rows[0]) throw new HttpError(404, 'Parent-child relationship not found.', 'relationship_not_found')
  await writeAudit({ actorId: request.user.id, schoolId: request.user.school_id, action: 'parent_child_unlinked', resourceType: 'student', resourceId: studentId, metadata: { parentUserId } })
  response.status(204).end()
}))

export default router
