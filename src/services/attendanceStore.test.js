import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'
import {
  getAttendanceSyncErrors,
  getAttendanceStorageStatus,
  getPendingAttendance,
  loadAttendanceData,
  markAttendanceSyncFailed,
  markAttendanceConflictSuperseded,
  resolveAttendanceConflictWithServer,
  markAttendanceSynced,
  migrateLegacyAttendance,
  resetAttendanceDatabaseForTests,
  saveAttendanceDraft,
  submitAttendance,
} from './attendanceStore.js'

const session = {
  date: '2026-10-18',
  className: 'Class V - A',
  teacherId: 'teacher-1',
  teacherName: 'Sita Kumari',
}
const statuses = { 'ST-104': 'present', 'ST-108': 'absent' }
const scopeKey = `${session.date}-${session.className}`

beforeEach(async () => {
  await resetAttendanceDatabaseForTests()
})

test('draft survives a reload through the storage abstraction', async () => {
  await saveAttendanceDraft({ ...session, statuses })

  const restored = await loadAttendanceData()
  assert.deepEqual(restored.attendanceRecords[scopeKey], statuses)
  assert.equal(restored.pendingCount, 0)
  assert.equal(restored.storageAvailable, true)
})

test('production scopes isolate same-named classes across schools', async () => {
  const first = { ...session, schoolId: 'school-one', classId: 'class-one', statuses: { 'ST-104': 'present' } }
  const second = { ...session, schoolId: 'school-two', classId: 'class-two', statuses: { 'ST-104': 'absent' } }
  await saveAttendanceDraft(first)
  await saveAttendanceDraft(second)

  const restored = await loadAttendanceData()
  assert.deepEqual(restored.attendanceRecords['school-one/class-one/2026-10-18'], first.statuses)
  assert.deepEqual(restored.attendanceRecords['school-two/class-two/2026-10-18'], second.statuses)
})

test('submission gets a unique idempotency key and rejects duplicates', async () => {
  const first = await submitAttendance({ ...session, statuses })
  assert.ok(first.idempotencyKey)
  assert.equal((await getPendingAttendance()).length, 1)

  await assert.rejects(
    submitAttendance({ ...session, statuses }),
    /already submitted/i,
  )
  assert.equal((await getPendingAttendance()).length, 1)
})

test('submitted offline payload cannot be replaced until server acknowledgement', async () => {
  await submitAttendance({ ...session, statuses })

  await assert.rejects(
    submitAttendance({ ...session, statuses: { ...statuses, 'ST-108': 'present' } }),
    /has not synchronized yet/i,
  )
  const queued = await getPendingAttendance()
  assert.equal(queued.length, 1)
  assert.deepEqual(queued[0].payload.records, statuses)
})

test('a server-confirmed session can queue an audited correction using its revision', async () => {
  const initial = await submitAttendance({ ...session, statuses })
  await markAttendanceSynced(initial.idempotencyKey, { serverId: 'server-session', revision: 4 })
  const corrected = { ...statuses, 'ST-108': 'present' }
  await saveAttendanceDraft({ ...session, statuses: corrected })

  const correction = await submitAttendance({ ...session, statuses: corrected, revision: 4 })
  assert.notEqual(correction.idempotencyKey, initial.idempotencyKey)
  const queue = await getPendingAttendance()
  assert.equal(queue.length, 1)
  assert.equal(queue[0].payload.revision, 4)
  assert.deepEqual(queue[0].payload.records, corrected)
})

test('sync failure retains the queued payload and can later be marked synced', async () => {
  const submission = await submitAttendance({ ...session, statuses })
  await markAttendanceSyncFailed(submission.idempotencyKey, new Error('Temporary network failure'))

  const failed = await getPendingAttendance()
  assert.equal(failed.length, 1)
  assert.equal(failed[0].syncState, 'failed')
  assert.equal(failed[0].attemptCount, 1)
  assert.match(failed[0].lastError, /Temporary network failure/)
  assert.equal((await getAttendanceSyncErrors()).length, 1)

  await markAttendanceSynced(submission.idempotencyKey, { serverId: 'server-1', revision: 2 })
  const restored = await loadAttendanceData()
  assert.equal(restored.pendingCount, 0)
  assert.equal(restored.submitted[scopeKey].syncState, 'synced')
  assert.deepEqual(restored.attendanceRecords[scopeKey], statuses)
})

test('conflicts remain visible for review and adopting the server version resolves them', async () => {
  const submission = await submitAttendance({ ...session, schoolId: 'school-1', classId: 'class-1', statuses })
  await markAttendanceSyncFailed(submission.idempotencyKey, new Error('Revision conflict'), { conflict: true })
  const before = await loadAttendanceData()
  assert.equal(before.conflicts.length, 1)
  assert.equal((await getAttendanceStorageStatus()).conflictCount, 1)

  const serverRecords = [
    { student_id: 'ST-104', status: 'late' },
    { student_id: 'ST-108', status: 'present' },
  ]
  await resolveAttendanceConflictWithServer(submission.idempotencyKey, { id: 'server-session', revision: 8, date: session.date }, serverRecords)
  const after = await loadAttendanceData()
  assert.equal(after.conflicts.length, 0)
  assert.equal(after.submitted['school-1/class-1/2026-10-18'].revision, 8)
  assert.deepEqual(after.attendanceRecords['school-1/class-1/2026-10-18'], { 'ST-104': 'late', 'ST-108': 'present' })
})

test('keeping a conflicted local register queues a fresh revision and supersedes the old conflict', async () => {
  const scopedSession = { ...session, schoolId: 'school-1', classId: 'class-1' }
  const original = await submitAttendance({ ...scopedSession, statuses })
  await markAttendanceSyncFailed(original.idempotencyKey, new Error('Revision conflict'), { conflict: true })
  const corrected = { ...statuses, 'ST-108': 'late' }
  const replacement = await submitAttendance({ ...scopedSession, statuses: corrected, revision: 9, allowLegacySnapshot: true })
  await markAttendanceConflictSuperseded(original.idempotencyKey, 'local_correction')

  const restored = await loadAttendanceData()
  const pending = await getPendingAttendance()
  assert.equal(restored.conflicts.length, 0)
  assert.equal(pending.length, 1)
  assert.equal(pending[0].idempotencyKey, replacement.idempotencyKey)
  assert.equal(pending[0].payload.revision, 9)
  assert.deepEqual(restored.attendanceRecords['school-1/class-1/2026-10-18'], corrected)
})

test('legacy local records migrate once without losing submitted status', async () => {
  await migrateLegacyAttendance({ [scopeKey]: statuses }, { [scopeKey]: 'submitted' })
  const restored = await loadAttendanceData()

  assert.deepEqual(restored.attendanceRecords[scopeKey], statuses)
  assert.equal(restored.submitted[scopeKey].snapshot['ST-104'], 'present')
  assert.equal(restored.pendingCount, 1)

  await migrateLegacyAttendance({}, {})
  assert.equal((await getPendingAttendance()).length, 1)
})
