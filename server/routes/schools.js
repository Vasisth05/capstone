import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth, requireRoles } from '../auth.js'
import { asyncRoute, HttpError, validate, writeAudit } from '../http.js'

const router = Router()
const listSchema = z.object({ district: z.string().max(100).optional(), block: z.string().max(100).optional(), date: z.iso.date().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).strict()
const detailIdSchema = z.string().uuid()
const patchSchema = z.object({ name: z.string().trim().min(1).max(160).optional(), block: z.string().trim().min(1).max(120).optional(), address: z.string().trim().max(500).nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.')
const verificationSchema = z.object({ status: z.enum(['verified', 'rejected', 'pending']) }).strict()

function scopeFor(user) {
  if (user.role === 'department') {
    if (!user.district_scope) throw new HttpError(403, 'No district scope is configured.', 'scope_missing')
    return { district: user.district_scope }
  }
  if (['principal', 'school_admin'].includes(user.role) && user.school_id) return { schoolId: user.school_id }
  throw new HttpError(403, 'You cannot access the school directory.', 'insufficient_role')
}

router.get('/', requireAuth, asyncRoute(async (request, response) => {
  const filters = validate(listSchema, request.query)
  const scope = scopeFor(request.user)
  const params = [filters.date ?? new Date().toISOString().slice(0, 10)]
  const where = []
  if (scope.district) { params.push(scope.district); where.push(`s.district = $${params.length}`) }
  if (scope.schoolId) { params.push(scope.schoolId); where.push(`s.id = $${params.length}`) }
  if (filters.district) {
    if (scope.district && filters.district !== scope.district) throw new HttpError(403, 'You cannot access another district.', 'district_scope_denied')
    params.push(filters.district); where.push(`s.district = $${params.length}`)
  }
  if (filters.block) { params.push(filters.block); where.push(`s.block = $${params.length}`) }
  const summary = await pool.query(
    `SELECT count(*)::int AS total,
       COALESCE(round(avg(attendance_percent))::int, 0) AS average_attendance,
       count(*) FILTER (WHERE verification_status <> 'verified')::int AS needs_verification
     FROM (
       SELECT s.id, s.verification_status,
         CASE WHEN count(ar.id) = 0 THEN 0
           ELSE round(100.0 * count(ar.id) FILTER (WHERE ar.status IN ('present', 'late')) / count(ar.id))::int
         END AS attendance_percent
       FROM schools s LEFT JOIN school_classes c ON c.school_id = s.id
       LEFT JOIN students st ON st.class_id = c.id
       LEFT JOIN attendance_sessions a ON a.school_id = s.id AND a.class_id = c.id
         AND a.attendance_date = $1::date AND a.state IN ('submitted', 'approved')
       LEFT JOIN attendance_records ar ON ar.session_id = a.id AND ar.student_id = st.id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       GROUP BY s.id
     ) scoped_schools`,
    params,
  )
  const limit = params.push(filters.pageSize)
  const offset = params.push((filters.page - 1) * filters.pageSize)
  const result = await pool.query(
    `SELECT s.id, s.name, s.code, s.district, s.block, s.verification_status,
       count(DISTINCT c.id)::int AS class_count, count(DISTINCT st.id)::int AS student_count,
       count(ar.id)::int AS recorded_count,
       CASE WHEN count(ar.id) = 0 THEN 0 ELSE round(100.0 * count(ar.id) FILTER (WHERE ar.status IN ('present', 'late')) / count(ar.id))::int END AS attendance_percent
     FROM schools s LEFT JOIN school_classes c ON c.school_id = s.id
     LEFT JOIN students st ON st.class_id = c.id
     LEFT JOIN attendance_sessions a ON a.school_id = s.id AND a.class_id = c.id AND a.attendance_date = $1::date AND a.state IN ('submitted','approved')
     LEFT JOIN attendance_records ar ON ar.session_id = a.id AND ar.student_id = st.id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY s.id ORDER BY s.district, s.block, s.name LIMIT $${limit} OFFSET $${offset}`,
    params,
  )
  response.json({ items: result.rows, total: summary.rows[0].total, summary: summary.rows[0], date: params[0], page: filters.page, pageSize: filters.pageSize, demo: false })
}))

router.get('/:schoolId', requireAuth, asyncRoute(async (request, response) => {
  const schoolId = validate(detailIdSchema, request.params.schoolId)
  const scope = scopeFor(request.user)
  const params = [schoolId]
  const where = ['s.id = $1']
  if (scope.district) { params.push(scope.district); where.push(`s.district = $${params.length}`) }
  if (scope.schoolId) { params.push(scope.schoolId); where.push(`s.id = $${params.length}`) }
  const result = await pool.query(
    `SELECT s.id, s.name, s.code, s.district, s.block, s.address, s.verification_status,
       count(DISTINCT c.id)::int AS class_count, count(DISTINCT st.id)::int AS student_count,
       count(ar.id)::int AS recorded_count,
       CASE WHEN count(ar.id) = 0 THEN 0 ELSE round(100.0 * count(ar.id) FILTER (WHERE ar.status IN ('present','late')) / count(ar.id))::int END AS attendance_percent
     FROM schools s LEFT JOIN school_classes c ON c.school_id = s.id LEFT JOIN students st ON st.class_id = c.id
     LEFT JOIN attendance_sessions a ON a.class_id = c.id AND a.attendance_date = CURRENT_DATE AND a.state IN ('submitted','approved')
     LEFT JOIN attendance_records ar ON ar.session_id = a.id AND ar.student_id = st.id
     WHERE ${where.join(' AND ')} GROUP BY s.id`,
    params,
  )
  if (!result.rows[0]) throw new HttpError(404, 'School not found in your authorized scope.', 'school_not_found')
  response.json({ school: result.rows[0] })
}))

router.patch('/:schoolId', requireAuth, requireRoles('school_admin'), asyncRoute(async (request, response) => {
  const schoolId = validate(detailIdSchema, request.params.schoolId)
  if (schoolId !== request.user.school_id) throw new HttpError(403, 'You cannot update another school.', 'school_scope_denied')
  const input = validate(patchSchema, request.body)
  const result = await pool.query(
    `UPDATE schools SET name = COALESCE($3, name), block = COALESCE($4, block),
     address = CASE WHEN $5::boolean THEN $6::text ELSE address END, updated_at = now()
     WHERE id = $1 AND id = $2 RETURNING id, name, code, district, block, address, verification_status`,
    [schoolId, request.user.school_id, input.name ?? null, input.block ?? null, Object.hasOwn(input, 'address'), input.address ?? null],
  )
  await writeAudit({ actorId: request.user.id, schoolId, action: 'school_updated', resourceType: 'school', resourceId: schoolId, metadata: input })
  response.json({ school: result.rows[0] })
}))

router.patch('/:schoolId/verification', requireAuth, requireRoles('department'), asyncRoute(async (request, response) => {
  const schoolId = validate(detailIdSchema, request.params.schoolId)
  const input = validate(verificationSchema, request.body)
  const result = await pool.query('UPDATE schools SET verification_status = $3, updated_at = now() WHERE id = $1 AND district = $2 RETURNING id, name, verification_status', [schoolId, request.user.district_scope, input.status])
  if (!result.rows[0]) throw new HttpError(404, 'School not found in your district scope.', 'school_not_found')
  await writeAudit({ actorId: request.user.id, schoolId, action: 'school_verification_changed', resourceType: 'school', resourceId: schoolId, metadata: input })
  response.json({ school: result.rows[0] })
}))

export default router
