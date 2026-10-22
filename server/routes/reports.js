import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { asyncRoute, HttpError, validate } from '../http.js'

const router = Router()
const reportSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  classId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  view: z.enum(['class', 'daily', 'monthly', 'student', 'school']).default('class'),
  district: z.string().max(100).optional(),
  block: z.string().max(100).optional(),
}).strict()

router.get('/attendance', requireAuth, asyncRoute(async (request, response) => {
  const filters = validate(reportSchema, request.query)
  const view = filters.view
  const from = filters.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  const to = filters.to ?? new Date().toISOString().slice(0, 10)
  if (from > to) throw new HttpError(400, 'Report start date must be on or before the end date.', 'invalid_date_range')
  const params = [from, to]
  const joins = [
    'JOIN schools sc ON sc.id = c.school_id',
    `JOIN students eligible_student ON eligible_student.class_id = c.id AND eligible_student.school_id = c.school_id AND eligible_student.active = true`,
    `LEFT JOIN attendance_sessions a ON a.class_id = c.id AND a.school_id = c.school_id
      AND a.attendance_date BETWEEN $1::date AND $2::date AND a.state IN ('submitted', 'approved')`,
    `LEFT JOIN attendance_records ar ON ar.session_id = a.id AND ar.student_id = eligible_student.id`,
  ]
  const where = []
  const role = request.user.role
  if (role === 'parent') {
    params.push(request.user.parent_id)
    joins.push(`JOIN parent_students ps ON ps.student_id = eligible_student.id AND ps.parent_id = $${params.length}`)
  } else if (role === 'teacher') {
    params.push(request.user.id)
    where.push(`EXISTS (SELECT 1 FROM teacher_class_assignments ta JOIN teachers t ON t.id = ta.teacher_id
      WHERE t.user_id = $${params.length} AND ta.class_id = c.id AND ta.starts_on <= $2::date
      AND (ta.ends_on IS NULL OR ta.ends_on >= $1::date))`)
  } else if (role === 'department') {
    if (!request.user.district_scope) throw new HttpError(403, 'No district scope is configured.', 'scope_missing')
    params.push(request.user.district_scope)
    where.push(`sc.district = $${params.length}`)
  } else if (['principal', 'school_admin'].includes(role)) {
    params.push(request.user.school_id)
    where.push(`c.school_id = $${params.length}`)
  } else throw new HttpError(403, 'You cannot view attendance reports.', 'insufficient_role')

  if (filters.classId) { params.push(filters.classId); where.push(`c.id = $${params.length}`) }
  if (filters.studentId) {
    params.push(filters.studentId)
    where.push(`eligible_student.id = $${params.length}`)
    if (role === 'parent') {
      const linked = await pool.query('SELECT 1 FROM parent_students WHERE parent_id = $1 AND student_id = $2', [request.user.parent_id, filters.studentId])
      if (!linked.rows[0]) throw new HttpError(404, 'Student not found in your linked children.', 'student_not_found')
    }
  }
  if (filters.district && role === 'department') {
    params.push(filters.district)
    where.push(`sc.district = $${params.length}`)
  }
  if (filters.block && role === 'department') {
    params.push(filters.block)
    where.push(`sc.block = $${params.length}`)
  }
  const dimensions = {
    class: { select: 'c.id AS class_id, c.name AS class_name, c.section', group: 'c.id, sc.id', order: 'sc.district, sc.block, c.grade_level, c.section' },
    daily: { select: 'a.attendance_date AS report_date, c.id AS class_id, c.name AS class_name, c.section', group: 'a.attendance_date, c.id, sc.id', order: 'a.attendance_date, sc.district, c.grade_level, c.section' },
    monthly: { select: "date_trunc('month', a.attendance_date)::date AS report_month, c.id AS class_id, c.name AS class_name, c.section", group: "date_trunc('month', a.attendance_date), c.id, sc.id", order: "date_trunc('month', a.attendance_date), sc.district, c.grade_level, c.section" },
    student: { select: 'eligible_student.id AS student_id, eligible_student.display_name AS student_name, eligible_student.admission_number, c.id AS class_id, c.name AS class_name, c.section', group: 'eligible_student.id, c.id, sc.id', order: 'sc.district, c.grade_level, c.section, eligible_student.display_name' },
    school: { select: 'sc.id AS school_id', group: 'sc.id', order: 'sc.district, sc.block, sc.name' },
  }[view]
  const result = await pool.query(
     `SELECT ${dimensions.select}, sc.name AS school_name,
       count(DISTINCT eligible_student.id)::int AS student_count,
       sc.district, sc.block, count(ar.id)::int AS recorded_count,
       count(ar.id) FILTER (WHERE ar.status = 'present')::int AS present_count,
       count(ar.id) FILTER (WHERE ar.status = 'late')::int AS late_count,
       count(ar.id) FILTER (WHERE ar.status = 'absent')::int AS absent_count,
       count(ar.id) FILTER (WHERE ar.status = 'excused')::int AS excused_count,
       CASE WHEN count(ar.id) = 0 THEN 0 ELSE round(100.0 * count(ar.id) FILTER (WHERE ar.status IN ('present', 'late')) / count(ar.id))::int END AS attendance_percent
     FROM school_classes c ${joins.join(' ')}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY ${dimensions.group} ORDER BY ${dimensions.order}`,
    params,
  )
  const totals = result.rows.reduce((summary, row) => ({
    recordedCount: summary.recordedCount + row.recorded_count,
    presentCount: summary.presentCount + row.present_count,
    lateCount: summary.lateCount + row.late_count,
    absentCount: summary.absentCount + row.absent_count,
    excusedCount: summary.excusedCount + row.excused_count,
  }), { recordedCount: 0, presentCount: 0, lateCount: 0, absentCount: 0, excusedCount: 0 })
  const attended = totals.presentCount + totals.lateCount
  response.json({
    range: { from, to },
    items: result.rows,
    totals: { ...totals, attendancePercent: totals.recordedCount ? Math.round(attended / totals.recordedCount * 100) : 0 },
    generatedAt: new Date().toISOString(),
  })
}))

export default router
