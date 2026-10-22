import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeChildAttendance } from './parentAttendance.js'

test('production parent views do not invent attendance when a child has no records', () => {
  assert.deepEqual(summarizeChildAttendance([], '2026-10-19'), { todayStatus: null, attendanceRate: null })
})

test('parent summary uses linked child records for status and rate', () => {
  const records = [
    { date: '2026-10-19', status: 'late' },
    { date: '2026-10-18', status: 'absent' },
    { date: '2026-10-17', status: 'present' },
  ]
  assert.deepEqual(summarizeChildAttendance(records, '2026-10-19'), { todayStatus: 'late', attendanceRate: 67 })
})

test('demo parent summaries retain their clearly illustrative defaults', () => {
  assert.deepEqual(summarizeChildAttendance([], '2026-10-19', true), { todayStatus: 'present', attendanceRate: 94 })
})
