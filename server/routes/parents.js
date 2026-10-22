import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth, requireRoles } from '../auth.js'
import { asyncRoute, HttpError, validate, writeAudit } from '../http.js'

const router = Router()
const idSchema = z.string().uuid()
const preferenceSchema = z.object({ language: z.enum(['en', 'hi']).optional(), absence: z.boolean().optional(), attendance: z.boolean().optional(), school_updates: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one preference.')

router.get('/me/children', requireAuth, requireRoles('parent'), asyncRoute(async (request, response) => {
  const result = await pool.query(
    `SELECT s.id, s.school_id, sc.name AS school_name, s.admission_number, s.display_name, s.gender, c.id AS class_id, c.name AS class_name, c.section,
       count(ar.id)::int AS recorded_count,
       count(ar.id) FILTER (WHERE ar.status IN ('present','late'))::int AS attended_count,
       (SELECT r.status FROM attendance_records r JOIN attendance_sessions a2 ON a2.id = r.session_id
        WHERE r.student_id = s.id AND a2.attendance_date = CURRENT_DATE AND a2.state IN ('submitted', 'approved')
        ORDER BY a2.submitted_at DESC LIMIT 1) AS today_status
     FROM parent_students ps JOIN students s ON s.id = ps.student_id
     JOIN school_classes c ON c.id = s.class_id JOIN schools sc ON sc.id = s.school_id
     LEFT JOIN attendance_sessions a ON a.school_id = s.school_id AND a.class_id = s.class_id
       AND a.state IN ('submitted', 'approved')
     LEFT JOIN attendance_records ar ON ar.session_id = a.id AND ar.student_id = s.id
     WHERE ps.parent_id = $1 AND s.active = true
     GROUP BY s.id, c.id, sc.id ORDER BY s.display_name`,
    [request.user.parent_id],
  )
  response.json({ items: result.rows.map((row) => ({
    ...row,
    attendance_percent: row.recorded_count ? Math.round(row.attended_count / row.recorded_count * 100) : 0,
  })) })
}))

router.get('/me/children/:studentId/attendance', requireAuth, requireRoles('parent'), asyncRoute(async (request, response) => {
  const studentId = validate(idSchema, request.params.studentId)
  const { rows } = await pool.query(
    `SELECT a.id AS session_id, a.attendance_date, a.revision, a.state, r.status, r.note, c.name AS class_name, c.section
     FROM parent_students ps JOIN students s ON s.id = ps.student_id
     JOIN attendance_records r ON r.student_id = s.id JOIN attendance_sessions a ON a.id = r.session_id
     JOIN school_classes c ON c.id = a.class_id
     WHERE ps.parent_id = $1 AND s.id = $2 AND s.active = true
       AND a.school_id = s.school_id AND a.state IN ('submitted', 'approved')
     ORDER BY a.attendance_date DESC LIMIT 366`,
    [request.user.parent_id, studentId],
  )
  if (!rows.length) {
    const linked = await pool.query('SELECT 1 FROM parent_students ps JOIN students s ON s.id = ps.student_id WHERE ps.parent_id = $1 AND s.id = $2 AND s.active = true', [request.user.parent_id, studentId])
    if (!linked.rows[0]) throw new HttpError(404, 'Child not found in your linked account.', 'child_not_found')
  }
  response.json({ items: rows })
}))

router.patch('/me/preferences', requireAuth, requireRoles('parent'), asyncRoute(async (request, response) => {
  const input = validate(preferenceSchema, request.body)
  const preferences = { absence: input.absence, attendance: input.attendance, school_updates: input.school_updates }
  for (const key of Object.keys(preferences)) if (preferences[key] === undefined) delete preferences[key]
  const result = await pool.query(
    `UPDATE users SET preferred_language = COALESCE($2, preferred_language),
     notification_preferences = notification_preferences || $3::jsonb, updated_at = now()
     WHERE id = $1 RETURNING preferred_language, notification_preferences`,
    [request.user.id, input.language ?? null, JSON.stringify(preferences)],
  )
  await writeAudit({ actorId: request.user.id, schoolId: request.user.school_id, action: 'parent_preferences_updated', resourceType: 'user', resourceId: request.user.id, metadata: { language: input.language, preferences } })
  response.json({ language: result.rows[0].preferred_language, preferences: result.rows[0].notification_preferences })
}))

export default router
