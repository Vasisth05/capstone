import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth, requireRoles } from '../auth.js'
import { asyncRoute, HttpError, validate } from '../http.js'

const router = Router()
const listSchema = z.object({ q: z.string().max(100).optional(), classId: z.string().uuid().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).strict()
const idSchema = z.string().uuid()
const patchSchema = z.object({ displayName: z.string().trim().min(1).max(160).optional(), subject: z.string().trim().max(120).nullable().optional(), active: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.')

router.get('/', requireAuth, asyncRoute(async (request, response) => {
  const filters = validate(listSchema, request.query)
  const user = request.user
  if (!['teacher', 'principal', 'school_admin'].includes(user.role) || !user.school_id) throw new HttpError(403, 'You cannot view this staff directory.', 'insufficient_role')
  const params = [user.school_id]
  const where = ['t.school_id = $1', 'u.active = true']
  if (user.role === 'teacher') {
    params.push(user.id)
    where.push(`u.id = $${params.length}`)
  }
  if (filters.classId) { params.push(filters.classId); where.push(`EXISTS (SELECT 1 FROM teacher_class_assignments filter_assignment WHERE filter_assignment.teacher_id = t.id AND filter_assignment.class_id = $${params.length})`) }
  if (filters.q) { params.push(`%${filters.q}%`); where.push(`(u.display_name ILIKE $${params.length} OR t.staff_code ILIKE $${params.length})`) }
  const count = await pool.query(`SELECT count(DISTINCT t.id)::int AS total FROM teachers t JOIN users u ON u.id = t.user_id WHERE ${where.join(' AND ')}`, params)
  const limit = params.push(filters.pageSize)
  const offset = params.push((filters.page - 1) * filters.pageSize)
  const result = await pool.query(
    `SELECT DISTINCT t.id, t.staff_code, t.subject, u.id AS user_id, u.email, u.display_name, u.active,
       array_remove(array_agg(DISTINCT c.name || ' - ' || c.section), NULL) AS classes
     FROM teachers t JOIN users u ON u.id = t.user_id
     LEFT JOIN teacher_class_assignments a ON a.teacher_id = t.id AND a.starts_on <= CURRENT_DATE AND (a.ends_on IS NULL OR a.ends_on >= CURRENT_DATE)
     LEFT JOIN school_classes c ON c.id = a.class_id
     WHERE ${where.join(' AND ')} GROUP BY t.id, u.id ORDER BY u.display_name LIMIT $${limit} OFFSET $${offset}`,
    params,
  )
  response.json({ items: result.rows, total: count.rows[0].total, page: filters.page, pageSize: filters.pageSize })
}))

router.get('/:teacherId', requireAuth, asyncRoute(async (request, response) => {
  const teacherId = validate(idSchema, request.params.teacherId)
  const user = request.user
  if (!['teacher', 'principal', 'school_admin'].includes(user.role) || !user.school_id) throw new HttpError(403, 'You cannot view staff details.', 'insufficient_role')
  const params = [teacherId, user.school_id]
  const where = ['t.id = $1', 't.school_id = $2', 'u.active = true']
  if (user.role === 'teacher') { params.push(user.id); where.push(`u.id = $${params.length}`) }
  const result = await pool.query(
    `SELECT t.id, t.staff_code, t.subject, u.id AS user_id, u.email, u.display_name,
       COALESCE(json_agg(json_build_object('id', c.id, 'name', c.name, 'section', c.section)) FILTER (WHERE c.id IS NOT NULL), '[]'::json) AS classes
     FROM teachers t JOIN users u ON u.id = t.user_id
     LEFT JOIN teacher_class_assignments a ON a.teacher_id = t.id
     LEFT JOIN school_classes c ON c.id = a.class_id
     WHERE ${where.join(' AND ')} GROUP BY t.id, u.id`,
    params,
  )
  if (!result.rows[0]) throw new HttpError(404, 'Teacher not found in your authorized scope.', 'teacher_not_found')
  response.json({ teacher: result.rows[0] })
}))

router.patch('/:teacherId', requireAuth, requireRoles('principal', 'school_admin'), asyncRoute(async (request, response) => {
  const teacherId = validate(idSchema, request.params.teacherId)
  const input = validate(patchSchema, request.body)
  const schoolId = request.user.school_id
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `UPDATE users u SET display_name = COALESCE($3, u.display_name), active = COALESCE($4, u.active), updated_at = now()
       FROM teachers t WHERE t.id = $1 AND t.user_id = u.id AND t.school_id = $2
       RETURNING t.id, t.staff_code, t.subject, u.id AS user_id, u.display_name, u.email, u.active`,
      [teacherId, schoolId, input.displayName ?? null, input.active ?? null],
    )
    if (!result.rows[0]) throw new HttpError(404, 'Teacher not found in your school.', 'teacher_not_found')
    if (Object.hasOwn(input, 'subject')) {
      await client.query('UPDATE teachers SET subject = $3 WHERE id = $1 AND school_id = $2', [teacherId, schoolId, input.subject])
      result.rows[0].subject = input.subject
    }
    if (input.active === false) {
      await client.query('DELETE FROM teacher_class_assignments WHERE teacher_id = $1 AND starts_on > CURRENT_DATE', [teacherId])
      await client.query('UPDATE teacher_class_assignments SET ends_on = CURRENT_DATE WHERE teacher_id = $1 AND starts_on <= CURRENT_DATE AND (ends_on IS NULL OR ends_on > CURRENT_DATE)', [teacherId])
    }
    await writeAudit({ client, actorId: request.user.id, schoolId, action: input.active === false ? 'teacher_deactivated' : 'teacher_updated', resourceType: 'teacher', resourceId: teacherId, metadata: input })
    await client.query('COMMIT')
    response.json({ teacher: result.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}))

router.delete('/:teacherId', requireAuth, requireRoles('school_admin'), asyncRoute(async (request, response) => {
  const teacherId = validate(idSchema, request.params.teacherId)
  const schoolId = request.user.school_id
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query('UPDATE users u SET active = false, updated_at = now() FROM teachers t WHERE t.id = $1 AND t.user_id = u.id AND t.school_id = $2 AND u.active = true RETURNING u.id', [teacherId, schoolId])
    if (!result.rows[0]) throw new HttpError(404, 'Active teacher not found in your school.', 'teacher_not_found')
    await client.query('DELETE FROM teacher_class_assignments WHERE teacher_id = $1 AND starts_on > CURRENT_DATE', [teacherId])
    await client.query('UPDATE teacher_class_assignments SET ends_on = CURRENT_DATE WHERE teacher_id = $1 AND starts_on <= CURRENT_DATE AND (ends_on IS NULL OR ends_on > CURRENT_DATE)', [teacherId])
    await client.query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [result.rows[0].id])
    await writeAudit({ client, actorId: request.user.id, schoolId, action: 'teacher_deactivated', resourceType: 'teacher', resourceId: teacherId })
    await client.query('COMMIT')
    response.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}))

export default router
