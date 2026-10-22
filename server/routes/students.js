import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth, requireRoles } from '../auth.js'
import { asyncRoute, HttpError, validate, writeAudit } from '../http.js'

const router = Router()
const pageSchema = z.object({ q: z.string().max(100).optional(), classId: z.string().uuid().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).strict()
const createSchema = z.object({ classId: z.string().uuid(), admissionNumber: z.string().trim().min(1).max(40), displayName: z.string().trim().min(1).max(160), gender: z.enum(['female', 'male', 'other', 'undisclosed']).optional(), enrolledOn: z.iso.date().optional() }).strict()
const patchSchema = z.object({ classId: z.string().uuid().optional(), admissionNumber: z.string().trim().min(1).max(40).optional(), displayName: z.string().trim().min(1).max(160).optional(), gender: z.enum(['female', 'male', 'other', 'undisclosed']).nullable().optional(), active: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.')
const idSchema = z.string().uuid()

function authorizeSchool(user) {
  if (!user.school_id) throw new HttpError(403, 'No school is assigned to this account.', 'school_scope_missing')
  return user.school_id
}

router.get('/', requireAuth, asyncRoute(async (request, response) => {
  const filters = validate(pageSchema, request.query)
  const params = []
  const joins = ['JOIN school_classes c ON c.id = s.class_id AND c.school_id = s.school_id']
  const where = ['s.active = true']
  if (request.user.role === 'parent') {
    params.push(request.user.parent_id)
    joins.push('JOIN parent_students ps ON ps.student_id = s.id AND ps.parent_id = $1')
  } else if (request.user.role === 'teacher') {
    params.push(request.user.id)
    joins.push(`JOIN teacher_class_assignments a ON a.class_id = s.class_id
      JOIN teachers t ON t.id = a.teacher_id AND t.user_id = $1
      AND a.starts_on <= CURRENT_DATE AND (a.ends_on IS NULL OR a.ends_on >= CURRENT_DATE)`)
    params.push(request.user.school_id)
    where.push(`s.school_id = $${params.length}`)
  } else if (request.user.role === 'department') {
    if (!request.user.district_scope) throw new HttpError(403, 'No district scope is configured.', 'scope_missing')
    params.push(request.user.district_scope)
    joins.push('JOIN schools scoped_school ON scoped_school.id = s.school_id')
    where.push(`scoped_school.district = $${params.length}`)
  } else if (['principal', 'school_admin'].includes(request.user.role)) {
    params.push(authorizeSchool(request.user))
    where.push(`s.school_id = $${params.length}`)
  } else throw new HttpError(403, 'You cannot view the student directory.', 'insufficient_role')

  if (filters.classId) { params.push(filters.classId); where.push(`s.class_id = $${params.length}`) }
  if (filters.q) { params.push(`%${filters.q}%`); where.push(`(s.display_name ILIKE $${params.length} OR s.admission_number ILIKE $${params.length})`) }
  const count = await pool.query(`SELECT count(DISTINCT s.id)::int AS total FROM students s ${joins.join(' ')} WHERE ${where.join(' AND ')}`, params)
  const limit = params.push(filters.pageSize)
  const offset = params.push((filters.page - 1) * filters.pageSize)
  const rows = await pool.query(
    `SELECT DISTINCT s.id, s.admission_number, s.display_name, s.gender, s.enrolled_on, s.active, s.class_id, c.name AS class_name, c.section
     FROM students s ${joins.join(' ')} WHERE ${where.join(' AND ')}
     ORDER BY s.display_name LIMIT $${limit} OFFSET $${offset}`,
    params,
  )
  response.json({ items: rows.rows, page: filters.page, pageSize: filters.pageSize, total: count.rows[0].total })
}))

router.get('/:studentId', requireAuth, asyncRoute(async (request, response) => {
  const studentId = validate(idSchema, request.params.studentId)
  const user = request.user
  const params = [studentId]
  const where = ['s.id = $1', 's.active = true']
  const joins = ['JOIN school_classes c ON c.id = s.class_id']
  if (user.role === 'parent') {
    params.push(user.parent_id)
    joins.push('JOIN parent_students ps ON ps.student_id = s.id AND ps.parent_id = $2')
  } else if (user.role === 'teacher') {
    params.push(user.id)
    joins.push(`JOIN teacher_class_assignments a ON a.class_id = s.class_id JOIN teachers t ON t.id = a.teacher_id AND t.user_id = $2
      AND a.starts_on <= CURRENT_DATE AND (a.ends_on IS NULL OR a.ends_on >= CURRENT_DATE)`)
  } else if (['principal', 'school_admin'].includes(user.role)) {
    params.push(authorizeSchool(user))
    where.push(`s.school_id = $${params.length}`)
  } else if (user.role === 'department' && user.district_scope) {
    joins.push('JOIN schools scoped_school ON scoped_school.id = s.school_id')
    params.push(user.district_scope)
    where.push(`scoped_school.district = $${params.length}`)
  } else throw new HttpError(403, 'You cannot view student details.', 'insufficient_role')
  const result = await pool.query(
    `SELECT s.id, s.admission_number, s.display_name, s.gender, s.enrolled_on, s.class_id, c.name AS class_name, c.section
     FROM students s ${joins.join(' ')} WHERE ${where.join(' AND ')}`,
    params,
  )
  if (!result.rows[0]) throw new HttpError(404, 'Student not found in your authorized scope.', 'student_not_found')
  response.json({ student: result.rows[0] })
}))

router.post('/', requireAuth, requireRoles('principal', 'school_admin'), asyncRoute(async (request, response) => {
  const input = validate(createSchema, request.body)
  const schoolId = authorizeSchool(request.user)
  const result = await pool.query(
    `INSERT INTO students(school_id, class_id, admission_number, display_name, gender, enrolled_on)
     SELECT $1, c.id, $3, $4, $5, COALESCE($6::date, CURRENT_DATE) FROM school_classes c WHERE c.id = $2 AND c.school_id = $1
     RETURNING id, school_id, class_id, admission_number, display_name, gender, enrolled_on`,
    [schoolId, input.classId, input.admissionNumber, input.displayName, input.gender ?? null, input.enrolledOn ?? null],
  )
  if (!result.rows[0]) throw new HttpError(404, 'Class not found in your school.', 'class_not_found')
  await writeAudit({ actorId: request.user.id, schoolId, action: 'student_created', resourceType: 'student', resourceId: result.rows[0].id })
  response.status(201).json({ student: result.rows[0] })
}))

router.patch('/:studentId', requireAuth, requireRoles('principal', 'school_admin'), asyncRoute(async (request, response) => {
  const studentId = validate(idSchema, request.params.studentId)
  const input = validate(patchSchema, request.body)
  const schoolId = authorizeSchool(request.user)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (input.classId) {
      const classResult = await client.query('SELECT id FROM school_classes WHERE id = $1 AND school_id = $2', [input.classId, schoolId])
      if (!classResult.rows[0]) throw new HttpError(404, 'Class not found in your school.', 'class_not_found')
    }
    const current = await client.query('SELECT id FROM students WHERE id = $1 AND school_id = $2 FOR UPDATE', [studentId, schoolId])
    if (!current.rows[0]) throw new HttpError(404, 'Student not found in your school.', 'student_not_found')
    const result = await client.query(
      `UPDATE students SET class_id = COALESCE($3, class_id), admission_number = COALESCE($4, admission_number),
       display_name = COALESCE($5, display_name), gender = CASE WHEN $6::boolean THEN $7::text ELSE gender END,
       active = COALESCE($8, active), updated_at = now()
       WHERE id = $1 AND school_id = $2
       RETURNING id, school_id, class_id, admission_number, display_name, gender, enrolled_on, active`,
      [studentId, schoolId, input.classId ?? null, input.admissionNumber ?? null, input.displayName ?? null, Object.hasOwn(input, 'gender'), input.gender ?? null, input.active ?? null],
    )
    await writeAudit({ client, actorId: request.user.id, schoolId, action: 'student_updated', resourceType: 'student', resourceId: studentId, metadata: input })
    await client.query('COMMIT')
    response.json({ student: result.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

router.delete('/:studentId', requireAuth, requireRoles('principal', 'school_admin'), asyncRoute(async (request, response) => {
  const studentId = validate(idSchema, request.params.studentId)
  const schoolId = authorizeSchool(request.user)
  const result = await pool.query('UPDATE students SET active = false, updated_at = now() WHERE id = $1 AND school_id = $2 AND active = true RETURNING id', [studentId, schoolId])
  if (!result.rows[0]) throw new HttpError(404, 'Active student not found in your school.', 'student_not_found')
  await writeAudit({ actorId: request.user.id, schoolId, action: 'student_archived', resourceType: 'student', resourceId: studentId })
  response.status(204).end()
}))

export default router
