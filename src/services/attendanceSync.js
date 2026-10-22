import { api, ApiError } from './apiClient.js'
import {
  getPendingAttendance,
  markAttendanceSyncFailed,
  markAttendanceSynced,
  markAttendanceSyncing,
} from './attendanceStore.js'

let activeSync

export function syncPendingAttendance({ respectBackoff = false, onProgress } = {}) {
  if (activeSync) return activeSync
  activeSync = Promise.resolve()
    .then(() => runSync({ respectBackoff, onProgress }))
    .finally(() => { activeSync = undefined })
  return activeSync
}

async function runSync({ respectBackoff, onProgress }) {
  const pending = await getPendingAttendance()
  const eligible = pending.filter((item) => !respectBackoff || !item.nextAttemptAt || item.nextAttemptAt <= new Date().toISOString())
  const result = { synced: 0, failed: 0, conflicts: 0, skipped: pending.length - eligible.length }
  for (const item of eligible) {
    onProgress?.({ current: result.synced + result.failed + result.conflicts + 1, total: eligible.length, item })
    await markAttendanceSyncing(item.idempotencyKey)
    try {
      const { classId, date, captureMethod, revision, note, records: statusMap } = item.payload
      const payload = {
        classId,
        date,
        captureMethod,
        revision: revision ?? null,
        ...(note ? { note } : {}),
        records: Object.entries(statusMap).map(([studentId, status]) => ({ studentId, status })),
      }
      const serverResult = await api.syncAttendance(item.idempotencyKey, payload)
      await markAttendanceSynced(item.idempotencyKey, { serverId: serverResult.sessionId, revision: serverResult.revision })
      result.synced += 1
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409
      await markAttendanceSyncFailed(item.idempotencyKey, error, { conflict })
      if (conflict) result.conflicts += 1
      else result.failed += 1
    }
  }
  return result
}
