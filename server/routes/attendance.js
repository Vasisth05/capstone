import { createHash } from 'node:crypto'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { pool } from '../db.js'
import { config } from '../config.js'
import { requireAuth, requireRoles } from '../auth.js'
import { asyncRoute, HttpError, validate, writeAudit } from '../http.js'

const router = Router()
const statusSchema = z.enum(['present', 'absent', 'late', 'excused'])
const syncSchema = z.object({
  classId: z.string().uuid(),
  date: z.iso.date(),
  records: z.array(z.object({ studentId: z.string().uuid(), status: statusSchema, note: z.string().max(500).optional() }).strict()).min(1).max(500),
  revision: z.number().int().positive().nullable().optional(),
  captureMethod: z.enum(['manual', 'qr', 'import']).default('manual'),
  note: z.string().max(1000).optional(),
}).strict()
const listSchema = z.object({
  date: z.iso.date().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  classId: z.string().uuid().optional(),
  status: statusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict()
const qrIssueSchema = z.object({ studentId: z.uuid() }).strict()
const qrVerifySchema = z.object({ token: z.string().min(20).max(2048) }).strict()
const normalizedPayload = (payload) => JSON.stringify({ ...payload, records: [...payload.records].sort((a, b) => a.studentId.localeCompare(b.studentId)) })
const digest = (payload) => createHash('sha256').update(normalizedPayload(payload)).digest('hex')

async function canAccessClass(client, user, classId, schoolId, write = false) {
  const result = await client.query(
    `SELECT c.id, c.name, c.school_id
     FROM school_classes c
     WHERE c.id = $1 AND c.school_id = $2
       AND ($4::boolean = false OR EXISTS (
         SELECT 1 FROM teacher_class_assignments a JOIN teachers t ON t.id = a.teacher_id
         WHERE t.user_id = $3 AND a.class_id = c.id
           AND a.starts_on <= CURRENT_DATE AND (a.ends_on IS NULL OR a.ends_on >= CURRENT_DATE)
       ))`,
    [classId, schoolId, user.id, write && user.role === 'teacher'],
  )
  if (!result.rows[0]) throw new HttpError(404, 'Class not found in your authorized school scope.', 'class_not_found')
  return result.rows[0]
}

router.post('/qr-token', requireAuth, requireRoles('teacher', 'principal', 'school_admin'), asyncRoute(async (request, response) => {
  const { studentId } = validate(qrIssueSchema, request.body)
  const schoolId = request.user.school_id
  if (!schoolId) throw new HttpError(403, 'No school is assigned to this account.', 'school_scope_missing')
  const result = await pool.query('SELECT id, class_id FROM students WHERE id = $1 AND school_id = $2 AND active = true', [studentId, schoolId])
  const student = result.rows[0]
  if (!student) throw new HttpError(404, 'Student not found in your school.', 'student_not_found')
  await canAccessClass(pool, request.user, student.class_id, schoolId, true)
  const token = jwt.sign({ studentId: student.id, classId: student.class_id, schoolId, purpose: 'attendance_qr' }, config.jwtSecret, { algorithm: 'HS256', issuer: 'ruralattend', expiresIn: '180d', subject: student.id })
  await writeAudit({ actorId: request.user.id, schoolId, action: 'attendance_qr_issued', resourceType: 'student', resourceId: student.id })
  response.json({ token, expiresInDays: 180 })
}))

router.post('/qr/verify', requireAuth, requireRoles('teacher', 'principal', 'school_admin'), asyncRoute(async (request, response) => {
  const { token } = validate(qrVerifySchema, request.body)
  let claims
  try { claims = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], issuer: 'ruralattend' }) }
  catch { throw new HttpError(400, 'This QR code is invalid or expired. Ask the school to issue a new code.', 'invalid_qr_token') }
  if (claims.purpose !== 'attendance_qr' || claims.studentId !== claims.sub || claims.schoolId !== request.user.school_id) {
    throw new HttpError(403, 'This QR code is outside your authorized school scope.', 'qr_scope_mismatch')
  }
  await canAccessClass(pool, request.user, claims.classId, request.user.school_id, true)
  const result = await pool.query('SELECT id, admission_number, display_name, class_id FROM students WHERE id = $1 AND school_id = $2 AND class_id = $3 AND active = true', [claims.studentId, request.user.school_id, claims.classId])
  if (!result.rows[0]) throw new HttpError(404, 'Student is no longer active in this class.', 'student_not_found')
  response.json({ student: result.rows[0], classId: claims.classId })
}))

router.post('/sync', requireAuth, requireRoles('teacher', 'principal', 'school_admin'), asyncRoute(async (request, response) => {
  const payload = validate(syncSchema, request.body)
  const idempotencyKey = request.get('Idempotency-Key')
  if (!idempotencyKey || !z.string().uuid().safeParse(idempotencyKey).success) throw new HttpError(400, 'A UUID Idempotency-Key header is required.', 'idempotency_key_required')
  const schoolId = request.user.school_id
  if (!schoolId) throw new HttpError(403, 'No school is assigned to this account.', 'school_scope_missing')
  const payloadHash = digest(payload)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [idempotencyKey])
    const previous = await client.query('SELECT actor_id, payload_hash, response_json FROM sync_idempotency WHERE idempotency_key = $1 FOR UPDATE', [idempotencyKey])
    if (previous.rows[0]) {
      if (previous.rows[0].actor_id !== request.user.id || previous.rows[0].payload_hash !== payloadHash) throw new HttpError(409, 'This idempotency key was already used for a different request.', 'idempotency_conflict')
      await client.query('COMMIT')
      return response.json({ ...previous.rows[0].response_json, replayed: true })
    }

    const schoolClass = await canAccessClass(client, request.user, payload.classId, schoolId, true)
    const roster = await client.query('SELECT id FROM students WHERE school_id = $1 AND class_id = $2 AND active = true', [schoolId, payload.classId])
    const rosterIds = new Set(roster.rows.map((row) => row.id))
    const submittedIds = new Set(payload.records.map((record) => record.studentId))
    if (submittedIds.size !== payload.records.length) throw new HttpError(400, 'A student may appear only once in a submission.', 'duplicate_student')
    if (submittedIds.size !== rosterIds.size || [...rosterIds].some((studentId) => !submittedIds.has(studentId))) {
      throw new HttpError(422, 'Attendance must include every active student in the selected class exactly once.', 'roster_mismatch')
    }

    let sessionResult = await client.query(
      'SELECT id, revision, state FROM attendance_sessions WHERE school_id = $1 AND class_id = $2 AND attendance_date = $3 FOR UPDATE',
      [schoolId, payload.classId, payload.date],
    )
    let session = sessionResult.rows[0]
    const isCorrection = Boolean(session)
    if (session?.state === 'approved') throw new HttpError(409, 'Approved attendance cannot be changed. Request a principal to reopen it first.', 'attendance_approved')
    if (session && (payload.revision ?? null) !== session.revision) {
      throw new HttpError(409, 'This register changed on the server. Reload the current record and review the conflict before correcting it.', 'revision_conflict', { serverRevision: session.revision })
    }
    if (!session) {
      const inserted = await client.query(
        `INSERT INTO attendance_sessions(school_id, class_id, attendance_date, created_by, state, note)
         VALUES($1, $2, $3, $4, 'submitted', $5)
         ON CONFLICT(school_id, class_id, attendance_date) DO NOTHING
         RETURNING id, revision, state`,
        [schoolId, payload.classId, payload.date, request.user.id, payload.note ?? null],
      )
      session = inserted.rows[0]
      if (!session) {
        sessionResult = await client.query(
          'SELECT id, revision, state FROM attendance_sessions WHERE school_id = $1 AND class_id = $2 AND attendance_date = $3 FOR UPDATE',
          [schoolId, payload.classId, payload.date],
        )
        session = sessionResult.rows[0]
        throw new HttpError(409, 'Another device submitted this register first. Reload and review the server record.', 'revision_conflict', { serverRevision: session?.revision })
      }
    } else {
      await client.query('UPDATE attendance_sessions SET revision = revision + 1, state = $2, note = COALESCE($3, note), updated_at = now() WHERE id = $1', [session.id, 'submitted', payload.note ?? null])
    }

    const changed = []
    for (const record of payload.records) {
      const prior = await client.query('SELECT status FROM attendance_records WHERE session_id = $1 AND student_id = $2', [session.id, record.studentId])
      if (prior.rows[0] && prior.rows[0].status !== record.status) changed.push({ studentId: record.studentId, from: prior.rows[0].status, to: record.status })
      await client.query(
        `INSERT INTO attendance_records(session_id, school_id, student_id, status, capture_method, note)
         VALUES($1, $2, $3, $4, $5, $6)
         ON CONFLICT(session_id, student_id) DO UPDATE
         SET status = EXCLUDED.status, capture_method = EXCLUDED.capture_method, note = EXCLUDED.note, updated_at = now()`,
        [session.id, schoolId, record.studentId, record.status, payload.captureMethod, record.note ?? null],
      )
      if (prior.rows[0] && prior.rows[0].status !== record.status) {
        await client.query(
          `UPDATE notifications n SET
             title = CASE WHEN u.preferred_language = 'hi' THEN 'उपस्थिति अपडेट' ELSE 'Attendance update' END,
             message = CASE WHEN u.preferred_language = 'hi'
               THEN CASE WHEN $4::text = 'absent' THEN 'उपस्थिति संशोधित हुई: आपका बच्चा अनुपस्थित दर्ज है।' ELSE 'उपस्थिति संशोधित हुई: आपका बच्चा अब अनुपस्थित नहीं है।' END
               ELSE CASE WHEN $4::text = 'absent' THEN 'Attendance was corrected: your child is marked absent.' ELSE 'Attendance was corrected: your child is no longer marked absent.' END END,
             payload = n.payload || jsonb_build_object('attendanceStatus', $4::text, 'correctedAt', now()::text),
             read_at = NULL, created_at = now()
           FROM users u
           WHERE n.recipient_user_id = u.id AND n.kind = 'absence' AND n.school_id = $1
             AND n.payload->>'studentId' = $2::text AND n.payload->>'attendanceDate' = $3::text
             AND COALESCE((u.notification_preferences->>'absence')::boolean, true)` ,
          [schoolId, record.studentId, payload.date, record.status],
        )
      }
      if (record.status === 'absent') {
        await client.query(
          `INSERT INTO notifications(recipient_user_id, school_id, kind, title, message, payload)
           SELECT u.id, $1, 'absence',
             CASE WHEN u.preferred_language = 'hi' THEN 'उपस्थिति अपडेट' ELSE 'Attendance update' END,
             CASE WHEN u.preferred_language = 'hi' THEN 'आपका बच्चा अनुपस्थित दर्ज किया गया है।' ELSE 'Your linked child was marked absent.' END,
             jsonb_build_object('studentId', $2::text, 'attendanceDate', $3::text, 'className', $4::text)
           FROM parent_students ps JOIN parents p ON p.id = ps.parent_id
           JOIN users u ON u.id = p.user_id
           WHERE ps.student_id = $2 AND COALESCE((u.notification_preferences->>'absence')::boolean, true)
           AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.recipient_user_id = p.user_id AND n.kind = 'absence' AND n.payload->>'studentId' = $2::text AND n.payload->>'attendanceDate' = $3::text)`,
          [schoolId, record.studentId, payload.date, schoolClass.name],
        )
      }
    }

    if (isCorrection) {
      await client.query(
        `UPDATE notifications n SET
           title = CASE WHEN u.preferred_language = 'hi' THEN 'उपस्थिति अपडेट' ELSE 'Attendance update' END,
           message = CASE WHEN u.preferred_language = 'hi' THEN 'आपके बच्चे की उपस्थिति में संशोधन किया गया है।' ELSE 'Attendance for your child was corrected.' END,
           payload = n.payload || jsonb_build_object('correctedAt', $3::text), read_at = NULL, created_at = now()
         FROM users u
         WHERE n.recipient_user_id = u.id AND n.kind = 'attendance' AND n.payload->>'sessionId' = $1::text
           AND n.school_id = $2 AND COALESCE((u.notification_preferences->>'attendance')::boolean, true)`,
        [session.id, schoolId, payload.date],
      )
    }

    await client.query(
      `INSERT INTO notifications(recipient_user_id, school_id, kind, title, message, payload)
       SELECT DISTINCT u.id, $1, 'attendance',
         CASE WHEN u.preferred_language = 'hi' THEN 'उपस्थिति अपडेट' ELSE 'Attendance update' END,
         CASE WHEN u.preferred_language = 'hi'
           THEN CASE WHEN $5::boolean THEN 'आपके बच्चे की उपस्थिति में संशोधन किया गया है।' ELSE 'आपके बच्चे की उपस्थिति दर्ज की गई है।' END
           ELSE CASE WHEN $5::boolean THEN 'Attendance for your child was corrected.' ELSE 'Attendance for your child was recorded.' END END,
         jsonb_build_object('sessionId', $2::text, 'attendanceDate', $4::text, 'className', $3::text)
       FROM attendance_records ar
       JOIN parent_students ps ON ps.student_id = ar.student_id
       JOIN parents p ON p.id = ps.parent_id
       JOIN users u ON u.id = p.user_id
       WHERE ar.session_id = $2 AND COALESCE((u.notification_preferences->>'attendance')::boolean, true)
         AND NOT EXISTS (
           SELECT 1 FROM notifications n WHERE n.recipient_user_id = u.id AND n.kind = 'attendance'
             AND n.payload->>'sessionId' = $2::text
         )`,
      [schoolId, session.id, schoolClass.name, payload.date, isCorrection],
    )

    const revision = isCorrection ? session.revision + 1 : session.revision
    const result = { sessionId: session.id, revision, state: 'submitted', records: payload.records.length }
    await client.query(
      'INSERT INTO sync_idempotency(idempotency_key, actor_id, payload_hash, response_json) VALUES($1, $2, $3, $4)',
      [idempotencyKey, request.user.id, payloadHash, JSON.stringify(result)],
    )
    await writeAudit({ client, actorId: request.user.id, schoolId, action: isCorrection ? 'attendance_corrected' : 'attendance_submitted', resourceType: 'attendance_session', resourceId: session.id, metadata: { classId: schoolClass.id, date: payload.date, revision, changed } })
    await client.query('COMMIT')
    response.status(isCorrection ? 200 : 201).json(result)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

router.get('/', requireAuth, asyncRoute(async (request, response) => {
  const filters = validate(listSchema, request.query)
  const user = request.user
  let schoolId = user.school_id
  const params = []
  let joins = ''
  const predicates = []
  if (user.role === 'parent') {
    params.push(user.parent_id)
    joins = `JOIN attendance_records parent_record ON parent_record.session_id = a.id
             JOIN parent_students ps ON ps.student_id = parent_record.student_id AND ps.parent_id = $1`
  } else if (user.role === 'department') {
    params.push(user.district_scope)
    joins = 'JOIN schools scoped_school ON scoped_school.id = a.school_id'
    predicates.push('scoped_school.district = $1')
    schoolId = null
  } else if (user.role === 'teacher') {
    params.push(user.id)
    joins = `JOIN teacher_class_assignments tca ON tca.class_id = a.class_id
             JOIN teachers t ON t.id = tca.teacher_id AND t.user_id = $1
             AND tca.starts_on <= a.attendance_date AND (tca.ends_on IS NULL OR tca.ends_on >= a.attendance_date)`
  } else if (user.role !== 'principal' && user.role !== 'school_admin') {
    throw new HttpError(403, 'This account cannot view school attendance.', 'insufficient_role')
  }
  if (schoolId) { params.push(schoolId); predicates.push(`a.school_id = $${params.length}`) }
  if (filters.date) { params.push(filters.date); predicates.push(`a.attendance_date = $${params.length}`) }
  if (filters.from) { params.push(filters.from); predicates.push(`a.attendance_date >= $${params.length}`) }
  if (filters.to) { params.push(filters.to); predicates.push(`a.attendance_date <= $${params.length}`) }
  if (filters.classId) { params.push(filters.classId); predicates.push(`a.class_id = $${params.length}`) }
  if (filters.status) { params.push(filters.status); predicates.push(`EXISTS (SELECT 1 FROM attendance_records filter_record WHERE filter_record.session_id = a.id AND filter_record.status = $${params.length})`) }
  const limitIndex = params.push(filters.pageSize)
  const offsetIndex = params.push((filters.page - 1) * filters.pageSize)
  const rows = await pool.query(
    `SELECT DISTINCT a.id, a.school_id, a.class_id, c.name AS class_name, c.section, a.attendance_date, a.revision, a.state, a.submitted_at,
       count(ar.id)::int AS record_count, count(*) FILTER (WHERE ar.status IN ('present', 'late'))::int AS attended_count
    FROM attendance_sessions a ${joins}
     JOIN school_classes c ON c.id = a.class_id
     LEFT JOIN attendance_records ar ON ar.session_id = a.id
    WHERE ${predicates.length ? predicates.join(' AND ') : 'true'}
     GROUP BY a.id, c.name, c.section ORDER BY a.attendance_date DESC
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    params,
  )
  response.json({ items: rows.rows, page: filters.page, pageSize: filters.pageSize })
}))

router.get('/:sessionId', requireAuth, asyncRoute(async (request, response) => {
  const sessionId = validate(z.string().uuid(), request.params.sessionId)
  const { rows } = await pool.query(
    `SELECT a.id, a.school_id, a.class_id, c.name AS class_name, c.section, a.attendance_date, a.revision, a.state, a.created_by, a.submitted_at,
            s.id AS student_id, s.admission_number, s.display_name, r.status, r.capture_method, r.note
     FROM attendance_sessions a JOIN school_classes c ON c.id = a.class_id
     JOIN attendance_records r ON r.session_id = a.id JOIN students s ON s.id = r.student_id
     WHERE a.id = $1 AND a.school_id = $2 ORDER BY s.display_name`,
    [sessionId, request.user.school_id],
  )
  if (!rows.length) throw new HttpError(404, 'Attendance record not found.', 'attendance_not_found')
  if (request.user.role === 'teacher') await canAccessClass(pool, request.user, rows[0].class_id, request.user.school_id, true)
  if (request.user.role === 'parent') {
    const linked = await pool.query('SELECT 1 FROM parent_students WHERE parent_id = $1 AND student_id = ANY($2::uuid[])', [request.user.parent_id, rows.map((row) => row.student_id)])
    const visible = new Set(linked.rows.map((row) => row.student_id))
    const ownRows = rows.filter((row) => visible.has(row.student_id))
    if (!ownRows.length) throw new HttpError(404, 'Attendance record not found.', 'attendance_not_found')
    return response.json({ session: { id: rows[0].id, className: rows[0].class_name, section: rows[0].section, date: rows[0].attendance_date }, records: ownRows })
  }
  if (!['teacher', 'principal', 'school_admin'].includes(request.user.role)) throw new HttpError(403, 'You cannot view this attendance record.', 'insufficient_role')
  response.json({ session: { id: rows[0].id, className: rows[0].class_name, section: rows[0].section, date: rows[0].attendance_date, revision: rows[0].revision, state: rows[0].state }, records: rows })
}))

router.post('/:sessionId/approve', requireAuth, requireRoles('principal', 'school_admin'), asyncRoute(async (request, response) => {
  const sessionId = validate(z.string().uuid(), request.params.sessionId)
  const result = await pool.query(
    `UPDATE attendance_sessions SET state = 'approved', updated_at = now()
     WHERE id = $1 AND school_id = $2 AND state = 'submitted' RETURNING id, revision`,
    [sessionId, request.user.school_id],
  )
  if (!result.rows[0]) throw new HttpError(404, 'Submitted attendance record not found.', 'attendance_not_found')
  await writeAudit({ actorId: request.user.id, schoolId: request.user.school_id, action: 'attendance_approved', resourceType: 'attendance_session', resourceId: sessionId })
  response.json({ ...result.rows[0], state: 'approved' })
}))

export default router
