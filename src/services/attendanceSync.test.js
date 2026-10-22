import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test, { beforeEach, afterEach } from 'node:test'
import {
  getPendingAttendance,
  loadAttendanceData,
  resetAttendanceDatabaseForTests,
  submitAttendance,
} from './attendanceStore.js'
import { syncPendingAttendance } from './attendanceSync.js'

const request = {
  date: '2026-10-18',
  className: 'Class V - A',
  schoolId: 'c37688f2-99eb-4ea8-8bd4-9d12d90ab714',
  classId: '66d15e40-6051-4e37-9cd8-4a873c5b8fa5',
  teacherId: 'server-ignored-user',
  teacherName: 'Teacher',
  statuses: { 'a857c715-cdda-4444-a9ca-f9e1005d98a6': 'present' },
}

beforeEach(async () => resetAttendanceDatabaseForTests())
afterEach(() => { delete globalThis.fetch })

test('sync sends one idempotency key and stores server-confirmed revision', async () => {
  const submission = await submitAttendance(request)
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify({ sessionId: 'server-session-1', revision: 1, state: 'submitted', records: 1 }), { status: 201, headers: { 'Content-Type': 'application/json' } })
  }

  const result = await syncPendingAttendance()
  assert.equal(result.synced, 1)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].options.headers['Idempotency-Key'], submission.idempotencyKey)
  const body = JSON.parse(requests[0].options.body)
  assert.equal(body.classId, request.classId)
  assert.equal('schoolId' in body, false)
  const restored = await loadAttendanceData()
  const scopeKey = `${request.schoolId}/${request.classId}/${request.date}`
  assert.equal(restored.submitted[scopeKey].syncState, 'synced')
  assert.equal(restored.submitted[scopeKey].revision, 1)
  assert.equal((await getPendingAttendance()).length, 0)
})

test('failed HTTP requests remain in the queue and concurrent sync calls are single-flight', async () => {
  await submitAttendance(request)
  assert.equal((await getPendingAttendance()).length, 1)
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 5))
    return new Response(JSON.stringify({ error: 'Database unavailable', code: 'database_unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  }

  const [first, second] = await Promise.all([syncPendingAttendance(), syncPendingAttendance()])
  assert.equal(calls, 1, JSON.stringify({ first, second }))
  assert.equal(first, second)
  assert.equal(first.failed, 1)
  const pending = await getPendingAttendance()
  assert.equal(pending.length, 1)
  assert.equal(pending[0].syncState, 'failed')
  assert.match(pending[0].lastError, /Database unavailable/)
})
