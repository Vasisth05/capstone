import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth, requireRoles } from '../auth.js'
import { asyncRoute, HttpError, validate, writeAudit } from '../http.js'

const router = Router()
const idSchema = z.string().uuid()
const createSchema = z.object({ name: z.string().trim().min(1).max(80), section: z.string().trim().min(1).max(40), gradeLevel: z.string().trim().min(1).max(40), academicYearId: z.string().uuid().optional() }).strict()
const patchSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), section: z.string().trim().min(1).max(40).optional(), gradeLevel: z.string().trim().min(1).max(40).optional() }).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.')
const assignmentSchema = z.object({ teacherId: z.string().uuid(), startsOn: z.iso.date().optional(), endsOn: z.iso.date().nullable().optional() }).strict()
  .refine((input) => !input.endsOn || input.endsOn >= (input.startsOn ?? new Date().toISOString().slice(0, 10)), { path: ['endsOn'], message: 'Assignment end date must be on or after its start date.' })
const assignmentEndSchema = z.object({ endsOn: z.iso.date().nullable() }).strict()
const yearSchema = z.object({ name: z.string().trim().min(4).max(20), startsOn: z.iso.date(), endsOn: z.iso.date(), isCurrent: z.boolean().optional() }).strict().refine((value) => value.endsOn > value.startsOn, 'End date must be after start date.')
const yearPatchSchema = z.object({ name: z.string().trim().min(4).max(20).optional(), startsOn: z.iso.date().optional(), endsOn: z.iso.date().optional(), isCurrent: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.')
const schoolIdFor = (user) => {
  if (!user.school_id) throw new HttpError(403, 'No school is assigned to this account.', 'school_scope_missing')
  return user.school_id
}

router.get('/academic-years', requireAuth, requireRoles('principal', 'school_admin'), asyncRoute(async (request, response) => {
  const result = await pool.query('SELECT id, name, starts_on, ends_on, is_current FROM academic_years WHERE school_id = $1 ORDER BY starts_on DESC', [schoolIdFor(request.user)])
  response.json({ items: result.rows })
}))

router.post('/academic-years', requireAuth, requireRoles('school_admin'), asyncRoute(async (request, response) => {
  const input = validate(yearSchema, request.body)
  const schoolId = schoolIdFor(request.user)
  const client = await pool.connect()
  let academicYear
  try {
    await client.query('BEGIN')
    const current = await client.query('SELECT id FROM academic_years WHERE school_id = $1 AND is_current = true FOR UPDATE', [schoolId])
    const isCurrent = input.isCurrent ?? current.rows.length === 0
    if (!current.rows.length && !isCurrent) throw new HttpError(400, 'The first academic year must be current so new classes can be created.', 'current_academic_year_required')
    if (isCurrent) await client.query('UPDATE academic_years SET is_current = false WHERE school_id = $1', [schoolId])
    const result = await client.query(
      `INSERT INTO academic_years(school_id, name, starts_on, ends_on, is_current) VALUES($1, $2, $3, $4, $5)
       RETURNING id, name, starts_on, ends_on, is_current`,
      [schoolId, input.name, input.startsOn, input.endsOn, isCurrent],
    )
    academicYear = result.rows[0]
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
  await writeAudit({ actorId: request.user.id, schoolId, action: 'academic_year_created', resourceType: 'academic_year', resourceId: academicYear.id })
  response.status(201).json({ academicYear })
}))

router.patch('/academic-years/:yearId', requireAuth, requireRoles('school_admin'), asyncRoute(async (request, response) => {
  const yearId = validate(idSchema, request.params.yearId)
  const input = validate(yearPatchSchema, request.body)
  const schoolId = schoolIdFor(request.user)
  const client = await pool.connect()
  let academicYear
  try {
    await client.query('BEGIN')
    const current = await client.query('SELECT id, name, starts_on, ends_on, is_current FROM academic_years WHERE id = $1 AND school_id = $2 FOR UPDATE', [yearId, schoolId])
    if (!current.rows[0]) throw new HttpError(404, 'Academic year not found in your school.', 'academic_year_not_found')
    const existing = current.rows[0]
    const startsOn = input.startsOn ?? String(existing.starts_on).slice(0, 10)
    const endsOn = input.endsOn ?? String(existing.ends_on).slice(0, 10)
    if (endsOn <= startsOn) throw new HttpError(400, 'End date must be after start date.', 'invalid_academic_year_range')
    if (existing.is_current && input.isCurrent === false) throw new HttpError(409, 'Choose another current year before unsetting this one.', 'current_academic_year_required')
    if (input.isCurrent) await client.query('UPDATE academic_years SET is_current = false WHERE school_id = $1 AND id <> $2', [schoolId, yearId])
    const result = await client.query(
      `UPDATE academic_years SET name = COALESCE($3, name), starts_on = $4, ends_on = $5,
       is_current = COALESCE($6, is_current) WHERE id = $1 AND school_id = $2
       RETURNING id, name, starts_on, ends_on, is_current`,
      [yearId, schoolId, input.name ?? null, startsOn, endsOn, input.isCurrent ?? null],
    )
    academicYear = result.rows[0]
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
  await writeAudit({ actorId: request.user.id, schoolId, action: 'academic_year_updated', resourceType: 'academic_year', resourceId: yearId, metadata: input })
  response.json({ academicYear })
}))

router.delete('/academic-years/:yearId', requireAuth, requireRoles('school_admin'), asyncRoute(async (request, response) => {
  const yearId = validate(idSchema, request.params.yearId)
  const schoolId = schoolIdFor(request.user)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query('SELECT is_current FROM academic_years WHERE id = $1 AND school_id = $2 FOR UPDATE', [yearId, schoolId])
    if (!current.rows[0]) throw new HttpError(404, 'Academic year not found in your school.', 'academic_year_not_found')
    if (current.rows[0].is_current) throw new HttpError(409, 'Make another academic year current before archiving this one.', 'current_academic_year_required')
    const linked = await client.query('SELECT 1 FROM school_classes WHERE academic_year_id = $1 LIMIT 1', [yearId])
    if (linked.rows[0]) throw new HttpError(409, 'This academic year contains classes. Keep it to preserve class and attendance history.', 'academic_year_in_use')
    await client.query('DELETE FROM academic_years WHERE id = $1 AND school_id = $2', [yearId, schoolId])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
  await writeAudit({ actorId: request.user.id, schoolId, action: 'academic_year_archived', resourceType: 'academic_year', resourceId: yearId })
  response.status(204).end()
}))

router.get('/', requireAuth, asyncRoute(async (request, response) => {
  const params = []
  let assignmentJoin = ''
  const where = []
  if (request.user.role === 'teacher') {
    params.push(request.user.id)
    assignmentJoin = `JOIN teacher_class_assignments a ON a.class_id = c.id
      JOIN teachers t ON t.id = a.teacher_id AND t.user_id = $1
      AND a.starts_on <= CURRENT_DATE AND (a.ends_on IS NULL OR a.ends_on >= CURRENT_DATE)`
  } else if (['principal', 'school_admin'].includes(request.user.role)) {
    params.push(schoolIdFor(request.user))
    where.push(`c.school_id = $1`)
  } else throw new HttpError(403, 'You cannot view school classes.', 'insufficient_role')
  const result = await pool.query(
    `SELECT DISTINCT c.id, c.name, c.section, c.grade_level, c.academic_year_id, y.name AS academic_year,
       count(DISTINCT s.id) FILTER (WHERE s.active)::int AS student_count,
       string_agg(DISTINCT u.display_name, ', ') AS teacher_names
     FROM school_classes c ${assignmentJoin}
     JOIN academic_years y ON y.id = c.academic_year_id
     LEFT JOIN students s ON s.class_id = c.id
     LEFT JOIN teacher_class_assignments a2 ON a2.class_id = c.id AND a2.starts_on <= CURRENT_DATE AND (a2.ends_on IS NULL OR a2.ends_on >= CURRENT_DATE)
     LEFT JOIN teachers t2 ON t2.id = a2.teacher_id LEFT JOIN users u ON u.id = t2.user_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY c.id, y.name ORDER BY c.grade_level, c.section`,
    params,
  )
  response.json({ items: result.rows })
}))

router.get('/:classId', requireAuth, asyncRoute(async (request, response) => {
  const classId = validate(idSchema, request.params.classId)
  const schoolId = schoolIdFor(request.user)
  const result = await pool.query(
    `SELECT c.id, c.school_id, c.name, c.section, c.grade_level, c.academic_year_id, y.name AS academic_year
     FROM school_classes c JOIN academic_years y ON y.id = c.academic_year_id
     WHERE c.id = $1 AND c.school_id = $2`,
    [classId, schoolId],
  )
  if (!result.rows[0]) throw new HttpError(404, 'Class not found in your school.', 'class_not_found')
  if (request.user.role === 'teacher') {
    const assigned = await pool.query(
      `SELECT 1 FROM teacher_class_assignments a JOIN teachers t ON t.id = a.teacher_id
       WHERE t.user_id = $1 AND a.class_id = $2 AND a.starts_on <= CURRENT_DATE AND (a.ends_on IS NULL OR a.ends_on >= CURRENT_DATE)`,
      [request.user.id, classId],
    )
    if (!assigned.rows[0]) throw new HttpError(404, 'Class not found in your authorized scope.', 'class_not_found')
  } else if (!['principal', 'school_admin'].includes(request.user.role)) throw new HttpError(403, 'You cannot view class details.', 'insufficient_role')
  const students = await pool.query('SELECT id, admission_number, display_name, gender FROM students WHERE class_id = $1 AND active = true ORDER BY display_name', [classId])
  const teachers = await pool.query(
    `SELECT t.id, u.display_name, to_char(a.starts_on, 'YYYY-MM-DD') AS starts_on,
       to_char(a.ends_on, 'YYYY-MM-DD') AS ends_on FROM teacher_class_assignments a
     JOIN teachers t ON t.id = a.teacher_id JOIN users u ON u.id = t.user_id
     WHERE a.class_id = $1 ORDER BY a.starts_on DESC`,
    [classId],
  )
  response.json({ class: result.rows[0], students: students.rows, teachers: teachers.rows })
}))

router.post('/', requireAuth, requireRoles('principal', 'school_admin'), asyncRoute(async (request, response) => {
  const input = validate(createSchema, request.body)
  const schoolId = schoolIdFor(request.user)
  const year = input.academicYearId
    ? await pool.query('SELECT id FROM academic_years WHERE id = $1 AND school_id = $2', [input.academicYearId, schoolId])
    : await pool.query('SELECT id FROM academic_years WHERE school_id = $1 AND is_current = true', [schoolId])
  const academicYearId = year.rows[0]?.id
  if (!academicYearId) throw new HttpError(400, 'Select a valid academic year for this school.', 'academic_year_invalid')
  const result = await pool.query(
    `INSERT INTO school_classes(school_id, academic_year_id, name, section, grade_level)
     VALUES($1, $2, $3, $4, $5) RETURNING id, name, section, grade_level, academic_year_id`,
    [schoolId, academicYearId, input.name, input.section, input.gradeLevel],
  )
  await writeAudit({ actorId: request.user.id, schoolId, action: 'class_created', resourceType: 'class', resourceId: result.rows[0].id })
  response.status(201).json({ class: result.rows[0] })
}))

router.patch('/:classId', requireAuth, requireRoles('principal', 'school_admin'), asyncRoute(async (request, response) => {
  const classId = validate(idSchema, request.params.classId)
  const input = validate(patchSchema, request.body)
  const result = await pool.query(
    `UPDATE school_classes SET name = COALESCE($3, name), section = COALESCE($4, section), grade_level = COALESCE($5, grade_level), updated_at = now()
     WHERE id = $1 AND school_id = $2 RETURNING id, name, section, grade_level, academic_year_id`,
    [classId, schoolIdFor(request.user), input.name ?? null, input.section ?? null, input.gradeLevel ?? null],
  )
  if (!result.rows[0]) throw new HttpError(404, 'Class not found in your school.', 'class_not_found')
  await writeAudit({ actorId: request.user.id, schoolId: request.user.school_id, action: 'class_updated', resourceType: 'class', resourceId: classId, metadata: input })
  response.json({ class: result.rows[0] })
}))

router.post('/:classId/assignments', requireAuth, requireRoles('school_admin', 'principal'), asyncRoute(async (request, response) => {
  const classId = validate(idSchema, request.params.classId)
  const input = validate(assignmentSchema, request.body)
  const schoolId = schoolIdFor(request.user)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const classResult = await client.query('SELECT id FROM school_classes WHERE id = $1 AND school_id = $2 FOR SHARE', [classId, schoolId])
    const teacherResult = await client.query(
      `SELECT t.id FROM teachers t JOIN users u ON u.id = t.user_id
       WHERE t.id = $1 AND t.school_id = $2 AND u.active = true FOR UPDATE OF t, u`,
      [input.teacherId, schoolId],
    )
    if (!classResult.rows[0] || !teacherResult.rows[0]) throw new HttpError(404, 'Active class or teacher not found in your school.', 'assignment_target_not_found')
    const overlapping = await client.query(
      `SELECT 1 FROM teacher_class_assignments
       WHERE teacher_id = $1 AND class_id = $2 AND school_id = $3
         AND starts_on <= COALESCE($5::date, 'infinity'::date)
         AND COALESCE(ends_on, 'infinity'::date) >= COALESCE($4::date, CURRENT_DATE)
       FOR UPDATE`,
      [input.teacherId, classId, schoolId, input.startsOn ?? null, input.endsOn ?? null],
    )
    if (overlapping.rows[0]) throw new HttpError(409, 'This teacher already has an assignment that overlaps the selected dates.', 'assignment_overlap')
    const result = await client.query(
      `INSERT INTO teacher_class_assignments(teacher_id, school_id, class_id, starts_on, ends_on)
       VALUES($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5)
       ON CONFLICT(teacher_id, class_id, starts_on) DO NOTHING
       RETURNING teacher_id, class_id, starts_on, ends_on`,
      [input.teacherId, schoolId, classId, input.startsOn ?? null, input.endsOn ?? null],
    )
    if (!result.rows[0]) throw new HttpError(409, 'This teacher is already assigned to this class for that start date.', 'assignment_already_exists')
    await writeAudit({ client, actorId: request.user.id, schoolId, action: 'teacher_assigned', resourceType: 'class', resourceId: classId, metadata: { teacherId: input.teacherId, startsOn: input.startsOn ?? null, endsOn: input.endsOn ?? null } })
    await client.query('COMMIT')
    response.status(201).json({ assignment: result.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

router.patch('/:classId/assignments/:teacherId/:startsOn', requireAuth, requireRoles('school_admin', 'principal'), asyncRoute(async (request, response) => {
  const classId = validate(idSchema, request.params.classId)
  const teacherId = validate(idSchema, request.params.teacherId)
  const startsOnParam = validate(z.iso.date(), request.params.startsOn)
  const { endsOn } = validate(assignmentEndSchema, request.body)
  const schoolId = schoolIdFor(request.user)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query(
      `SELECT to_char(starts_on, 'YYYY-MM-DD') AS starts_on FROM teacher_class_assignments
       WHERE class_id = $1 AND teacher_id = $2 AND school_id = $3 AND starts_on = $4::date FOR UPDATE`,
      [classId, teacherId, schoolId, startsOnParam],
    )
    if (!current.rows[0]) throw new HttpError(404, 'Teacher assignment not found in your school.', 'assignment_not_found')
    const assignmentStartsOn = current.rows[0].starts_on
    if (endsOn && endsOn < assignmentStartsOn) throw new HttpError(400, 'Assignment end date must be on or after its start date.', 'assignment_date_invalid')
    const result = await client.query(
      `UPDATE teacher_class_assignments SET ends_on = $5
       WHERE class_id = $1 AND teacher_id = $2 AND school_id = $3 AND starts_on = $4::date
       RETURNING teacher_id, class_id, starts_on, ends_on`,
      [classId, teacherId, schoolId, startsOnParam, endsOn],
    )
    await writeAudit({ client, actorId: request.user.id, schoolId, action: 'teacher_assignment_updated', resourceType: 'class', resourceId: classId, metadata: { teacherId, startsOn: startsOnParam, endsOn } })
    await client.query('COMMIT')
    response.json({ assignment: result.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

router.delete('/:classId', requireAuth, requireRoles('school_admin'), asyncRoute(async (request, response) => {
  const classId = validate(idSchema, request.params.classId)
  const schoolId = schoolIdFor(request.user)
  const result = await pool.query('DELETE FROM school_classes WHERE id = $1 AND school_id = $2 RETURNING id', [classId, schoolId])
  if (!result.rows[0]) throw new HttpError(404, 'Class not found in your school.', 'class_not_found')
  await writeAudit({ actorId: request.user.id, schoolId, action: 'class_deleted', resourceType: 'class', resourceId: classId })
  response.status(204).end()
}))

export default router
