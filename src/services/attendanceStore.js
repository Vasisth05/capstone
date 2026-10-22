const DATABASE_NAME = 'ruralattend-local'
const DATABASE_VERSION = 1
const SESSION_STORE = 'sessions'
const RECORD_STORE = 'attendance_records'
const OUTBOX_STORE = 'sync_outbox'
const ERROR_STORE = 'sync_errors'
const META_STORE = 'metadata'

let databasePromise

const createId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
const transactionDone = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
  transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'))
})
const requestResult = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
})
const storageError = (error) => {
  if (error?.name === 'QuotaExceededError') return new Error('This device is out of storage. Free space, then retry; no saved attendance was removed.')
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return new Error('This browser blocked local storage. Allow site storage and retry.')
  return error instanceof Error ? error : new Error('Could not access attendance storage.')
}

function openDatabase() {
  if (databasePromise) return databasePromise
  if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB is unavailable in this browser. Attendance cannot be persisted here.'))

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      const sessions = database.objectStoreNames.contains(SESSION_STORE)
        ? request.transaction.objectStore(SESSION_STORE)
        : database.createObjectStore(SESSION_STORE, { keyPath: 'id' })
      if (!sessions.indexNames.contains('scopeKey')) sessions.createIndex('scopeKey', 'scopeKey', { unique: true })
      for (const [name, path] of [['date', 'date'], ['classId', 'classId'], ['schoolId', 'schoolId'], ['syncState', 'syncState'], ['status', 'status']]) {
        if (!sessions.indexNames.contains(name)) sessions.createIndex(name, path)
      }

      const records = database.objectStoreNames.contains(RECORD_STORE)
        ? request.transaction.objectStore(RECORD_STORE)
        : database.createObjectStore(RECORD_STORE, { keyPath: 'id' })
      for (const [name, path] of [['sessionId', 'sessionId'], ['studentId', 'studentId'], ['status', 'status'], ['classId', 'classId'], ['date', 'date'], ['syncState', 'syncState']]) {
        if (!records.indexNames.contains(name)) records.createIndex(name, path)
      }

      const outbox = database.objectStoreNames.contains(OUTBOX_STORE)
        ? request.transaction.objectStore(OUTBOX_STORE)
        : database.createObjectStore(OUTBOX_STORE, { keyPath: 'idempotencyKey' })
      for (const [name, path] of [['syncState', 'syncState'], ['createdAt', 'createdAt'], ['sessionId', 'sessionId']]) {
        if (!outbox.indexNames.contains(name)) outbox.createIndex(name, path)
      }

      const errors = database.objectStoreNames.contains(ERROR_STORE)
        ? request.transaction.objectStore(ERROR_STORE)
        : database.createObjectStore(ERROR_STORE, { keyPath: 'id' })
      if (!errors.indexNames.contains('sessionId')) errors.createIndex('sessionId', 'sessionId')
      if (!errors.indexNames.contains('createdAt')) errors.createIndex('createdAt', 'createdAt')
      if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(storageError(request.error))
    request.onblocked = () => reject(new Error('Attendance storage upgrade is blocked by another open RuralAttend tab. Close older tabs and retry.'))
  }).catch((error) => {
    databasePromise = undefined
    throw storageError(error)
  })

  return databasePromise
}

export const attendanceScopeKey = ({ date, className, schoolId, classId }) => schoolId && classId
  ? `${schoolId}/${classId}/${date}`
  : `${date}-${className}`

function normalizeSession(session, scopeKey, details = {}) {
  const legacyMatch = scopeKey.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/)
  const productionMatch = scopeKey.match(/^([^/]+)\/([^/]+)\/(\d{4}-\d{2}-\d{2})$/)
  if (!legacyMatch && !productionMatch) throw new Error('Attendance scope must include an ISO date and class reference.')
  return {
    id: session?.id ?? createId(),
    scopeKey,
    date: details.date ?? legacyMatch?.[1] ?? productionMatch?.[3],
    className: details.className ?? legacyMatch?.[2] ?? details.classId ?? productionMatch?.[2],
    schoolId: details.schoolId ?? session?.schoolId ?? productionMatch?.[1] ?? 'demo-school',
    classId: details.classId ?? session?.classId ?? productionMatch?.[2] ?? legacyMatch?.[2],
    teacherId: details.teacherId ?? session?.teacherId ?? 'demo-teacher',
    teacherName: details.teacherName ?? session?.teacherName ?? 'Demo teacher',
    captureMethod: details.captureMethod ?? session?.captureMethod ?? 'manual',
    status: session?.status ?? 'draft',
    syncState: session?.syncState ?? 'local',
    statuses: session?.statuses ?? {},
    submittedSnapshot: session?.submittedSnapshot ?? null,
    submittedAt: session?.submittedAt ?? null,
    idempotencyKey: session?.idempotencyKey ?? null,
    serverId: session?.serverId ?? null,
    revision: session?.revision ?? null,
    createdAt: session?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function putSessionAndRecords(database, session, statuses, recordDetails = {}, outboxItem = null) {
  const stores = outboxItem ? [SESSION_STORE, RECORD_STORE, OUTBOX_STORE] : [SESSION_STORE, RECORD_STORE]
  const transaction = database.transaction(stores, 'readwrite')
  const done = transactionDone(transaction)
  const sessions = transaction.objectStore(SESSION_STORE)
  const records = transaction.objectStore(RECORD_STORE)
  const getSession = sessions.index('scopeKey').get(session.scopeKey)

  getSession.onsuccess = () => {
    const existing = getSession.result
    const next = normalizeSession({ ...existing, ...session, id: existing?.id ?? session.id }, session.scopeKey, { ...session, ...recordDetails })
    next.statuses = { ...statuses }
    next.syncState = recordDetails.syncState ?? (existing?.status === 'submitted' && existing.syncState === 'synced' ? 'local' : existing?.syncState === 'conflict' ? 'conflict' : existing?.syncState === 'failed' ? 'failed' : 'local')
    next.updatedAt = new Date().toISOString()
    sessions.put(next)
    if (outboxItem) transaction.objectStore(OUTBOX_STORE).put({ ...outboxItem, sessionId: next.id })

    const oldRecords = records.index('sessionId').getAll(next.id)
    oldRecords.onsuccess = () => {
      for (const record of oldRecords.result) records.delete(record.id)
      const recordedAt = next.updatedAt
      for (const [studentId, status] of Object.entries(statuses)) {
        records.put({
          id: `${next.id}:${studentId}`,
          sessionId: next.id,
          scopeKey: next.scopeKey,
          schoolId: next.schoolId,
          classId: next.classId,
          studentId,
          date: next.date,
          status,
          recordedBy: { id: next.teacherId, name: next.teacherName },
          captureMethod: recordDetails.captureMethod ?? next.captureMethod,
          recordedAt,
          updatedAt: recordedAt,
          syncState: next.syncState,
          serverId: next.serverId,
          revision: next.revision,
        })
      }
    }
    oldRecords.onerror = () => transaction.abort()
  }
  getSession.onerror = () => transaction.abort()
  return done
}

async function readAll(database, storeName) {
  const transaction = database.transaction(storeName, 'readonly')
  const done = transactionDone(transaction)
  const result = await requestResult(transaction.objectStore(storeName).getAll())
  await done
  return result
}

export async function loadAttendanceData() {
  try {
    const database = await openDatabase()
    const [sessions, records] = await Promise.all([readAll(database, SESSION_STORE), readAll(database, RECORD_STORE)])
    const recordsBySession = new Map()
    for (const record of records) {
      if (!recordsBySession.has(record.sessionId)) recordsBySession.set(record.sessionId, {})
      recordsBySession.get(record.sessionId)[record.studentId] = record.status
    }
    const attendanceRecords = {}
    const submitted = {}
    for (const session of sessions) {
      const statuses = recordsBySession.get(session.id) ?? session.statuses ?? {}
      attendanceRecords[session.scopeKey] = statuses
      if (session.status === 'submitted') submitted[session.scopeKey] = {
        at: session.submittedAt,
        snapshot: session.submittedSnapshot ?? statuses,
        syncState: session.syncState,
        idempotencyKey: session.idempotencyKey,
        serverId: session.serverId,
        revision: session.revision,
      }
    }
    const pending = await listOutbox(database)
    const conflicts = (await readAll(database, OUTBOX_STORE)).filter((item) => item.syncState === 'conflict')
    return { attendanceRecords, submitted, pendingCount: pending.length, conflicts, storageAvailable: true }
  } catch (error) {
    throw storageError(error)
  }
}

export async function saveAttendanceDraft({ date, className, statuses, schoolId, classId, teacherId, teacherName, captureMethod = 'manual' }) {
  try {
    const database = await openDatabase()
    const scopeKey = attendanceScopeKey({ date, className, schoolId, classId })
    const session = normalizeSession(null, scopeKey, { date, className, schoolId, classId, teacherId, teacherName, captureMethod })
    await putSessionAndRecords(database, session, statuses, { captureMethod })
    return { scopeKey, syncState: 'local' }
  } catch (error) {
    throw storageError(error)
  }
}

export async function migrateLegacyAttendance(legacyAttendance, legacySubmitted) {
  const database = await openDatabase()
  const migrationKey = 'localStorage-migration-v1'
  const metaTransaction = database.transaction(META_STORE, 'readonly')
  const migration = await requestResult(metaTransaction.objectStore(META_STORE).get(migrationKey))
  await transactionDone(metaTransaction)
  if (migration) return loadAttendanceData()

  const existingSessions = await readAll(database, SESSION_STORE)
  const existingScopes = new Set(existingSessions.map((session) => session.scopeKey))
  for (const [scopeKey, statuses] of Object.entries(legacyAttendance ?? {})) {
    if (existingScopes.has(scopeKey)) continue
    const parsed = scopeKey.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/)
    if (!parsed || !statuses || typeof statuses !== 'object') continue
    const [date, className] = parsed.slice(1)
    await saveAttendanceDraft({ date, className, statuses, classId: className, teacherId: 'demo-teacher', teacherName: 'Demo teacher' })
    if (legacySubmitted?.[scopeKey]) await submitAttendance({ date, className, statuses, classId: className, teacherId: 'demo-teacher', teacherName: 'Demo teacher', allowLegacySnapshot: true })
  }

  const markTransaction = database.transaction(META_STORE, 'readwrite')
  const markDone = transactionDone(markTransaction)
  markTransaction.objectStore(META_STORE).put({ key: migrationKey, migratedAt: new Date().toISOString() })
  await markDone
  return loadAttendanceData()
}

export async function submitAttendance({ date, className, statuses, schoolId, classId, teacherId, teacherName, revision = null, captureMethod = 'manual', allowLegacySnapshot = false }) {
  try {
    const database = await openDatabase()
    const scopeKey = attendanceScopeKey({ date, className, schoolId, classId })
    const lookup = database.transaction(SESSION_STORE, 'readonly')
    const existing = await requestResult(lookup.objectStore(SESSION_STORE).index('scopeKey').get(scopeKey))
    await transactionDone(lookup)
    const snapshot = { ...statuses }
    if (existing?.status === 'submitted' && !allowLegacySnapshot && JSON.stringify(existing.submittedSnapshot) === JSON.stringify(snapshot)) {
      throw new Error('This attendance register is already submitted. Make a correction before submitting again.')
    }
    const editingConfirmedSession = existing?.syncState === 'local' && Number.isInteger(existing.revision)
    if (existing?.status === 'submitted' && existing.syncState !== 'synced' && !editingConfirmedSession && !allowLegacySnapshot) {
      throw new Error('This register has not synchronized yet. Sync or resolve its conflict before submitting a correction.')
    }
    const now = new Date().toISOString()
    const idempotencyKey = createId()
    const session = normalizeSession(existing, scopeKey, { date, className, schoolId, classId, teacherId, teacherName, captureMethod })
    session.status = 'submitted'
    session.syncState = 'pending'
    session.statuses = snapshot
    session.submittedSnapshot = snapshot
    session.submittedAt = now
    session.idempotencyKey = idempotencyKey
    session.updatedAt = now
    await putSessionAndRecords(database, session, snapshot, { captureMethod, syncState: 'pending' }, {
      idempotencyKey,
      scopeKey,
      payload: { schoolId: session.schoolId, classId: session.classId, date, teacherId: session.teacherId, captureMethod, revision, records: snapshot },
      syncState: 'pending',
      attemptCount: 0,
      createdAt: now,
      nextAttemptAt: now,
      lastError: null,
    })
    return { session, idempotencyKey }
  } catch (error) {
    throw storageError(error)
  }
}

async function listOutbox(database) {
  const db = database ?? await openDatabase()
  const transaction = db.transaction(OUTBOX_STORE, 'readonly')
  const done = transactionDone(transaction)
  const records = await requestResult(transaction.objectStore(OUTBOX_STORE).getAll())
  await done
  return records.filter((record) => ['pending', 'failed', 'syncing'].includes(record.syncState))
}

export async function getPendingAttendance() {
  return listOutbox()
}

export async function markAttendanceSyncing(idempotencyKey) {
  const database = await openDatabase()
  const transaction = database.transaction([OUTBOX_STORE, SESSION_STORE], 'readwrite')
  const done = transactionDone(transaction)
  const outbox = transaction.objectStore(OUTBOX_STORE)
  const request = outbox.get(idempotencyKey)
  request.onsuccess = () => {
    if (!request.result) return
    outbox.put({ ...request.result, syncState: 'syncing' })
    const sessionRequest = transaction.objectStore(SESSION_STORE).get(request.result.sessionId)
    sessionRequest.onsuccess = () => {
      if (sessionRequest.result) transaction.objectStore(SESSION_STORE).put({ ...sessionRequest.result, syncState: 'syncing', updatedAt: new Date().toISOString() })
    }
  }
  await done
}

export async function markAttendanceSynced(idempotencyKey, { serverId, revision } = {}) {
  const database = await openDatabase()
  const transaction = database.transaction([OUTBOX_STORE, SESSION_STORE, RECORD_STORE], 'readwrite')
  const done = transactionDone(transaction)
  const outbox = transaction.objectStore(OUTBOX_STORE)
  const request = outbox.get(idempotencyKey)
  request.onsuccess = () => {
    if (!request.result) return
    const item = request.result
    outbox.put({ ...item, syncState: 'synced', lastError: null, syncedAt: new Date().toISOString() })
    const sessionStore = transaction.objectStore(SESSION_STORE)
    const sessionRequest = sessionStore.get(item.sessionId)
    sessionRequest.onsuccess = () => {
      const session = sessionRequest.result
      if (!session) return
      session.syncState = 'synced'
      session.serverId = serverId ?? session.serverId
      session.revision = revision ?? session.revision
      session.updatedAt = new Date().toISOString()
      sessionStore.put(session)
      const recordsStore = transaction.objectStore(RECORD_STORE)
      const rowsRequest = recordsStore.index('sessionId').getAll(session.id)
      rowsRequest.onsuccess = () => rowsRequest.result.forEach((record) => recordsStore.put({ ...record, syncState: 'synced', serverId, revision }))
    }
  }
  await done
}

export async function markAttendanceSyncFailed(idempotencyKey, error, { conflict = false } = {}) {
  const database = await openDatabase()
  const transaction = database.transaction([OUTBOX_STORE, SESSION_STORE, ERROR_STORE], 'readwrite')
  const done = transactionDone(transaction)
  const outbox = transaction.objectStore(OUTBOX_STORE)
  const request = outbox.get(idempotencyKey)
  request.onsuccess = () => {
    if (!request.result) return
    const item = request.result
    const message = error instanceof Error ? error.message : String(error)
    const syncState = conflict ? 'conflict' : 'failed'
    outbox.put({ ...item, syncState, attemptCount: item.attemptCount + 1, lastError: message, nextAttemptAt: new Date(Date.now() + Math.min(60_000 * (2 ** item.attemptCount), 3_600_000)).toISOString() })
    const sessionStore = transaction.objectStore(SESSION_STORE)
    const sessionRequest = sessionStore.get(item.sessionId)
    sessionRequest.onsuccess = () => {
      if (sessionRequest.result) sessionStore.put({ ...sessionRequest.result, syncState, updatedAt: new Date().toISOString() })
    }
    transaction.objectStore(ERROR_STORE).add({ id: createId(), sessionId: item.sessionId, idempotencyKey, message, conflict, createdAt: new Date().toISOString() })
  }
  await done
}

export async function resolveAttendanceConflictWithServer(idempotencyKey, serverSession, serverRecords) {
  const database = await openDatabase()
  const transaction = database.transaction([OUTBOX_STORE, SESSION_STORE, RECORD_STORE, ERROR_STORE], 'readwrite')
  const done = transactionDone(transaction)
  const outbox = transaction.objectStore(OUTBOX_STORE)
  const itemRequest = outbox.get(idempotencyKey)
  itemRequest.onsuccess = () => {
    const item = itemRequest.result
    if (!item || item.syncState !== 'conflict') return transaction.abort()
    outbox.put({ ...item, syncState: 'superseded', resolvedAt: new Date().toISOString(), resolution: 'server' })
    const sessions = transaction.objectStore(SESSION_STORE)
    const sessionRequest = sessions.get(item.sessionId)
    sessionRequest.onsuccess = () => {
      const session = sessionRequest.result
      if (!session) return transaction.abort()
      const statuses = Object.fromEntries(serverRecords.map((record) => [record.student_id, record.status]))
      session.status = 'submitted'
      session.syncState = 'synced'
      session.statuses = statuses
      session.submittedSnapshot = statuses
      session.submittedAt = serverSession.submitted_at ?? serverSession.date
      session.serverId = serverSession.id
      session.revision = serverSession.revision
      session.updatedAt = new Date().toISOString()
      sessions.put(session)
      const records = transaction.objectStore(RECORD_STORE)
      const oldRequest = records.index('sessionId').getAll(session.id)
      oldRequest.onsuccess = () => {
        oldRequest.result.forEach((record) => records.delete(record.id))
        for (const remote of serverRecords) records.put({
          id: `${session.id}:${remote.student_id}`, sessionId: session.id, scopeKey: session.scopeKey,
          schoolId: session.schoolId, classId: session.classId, studentId: remote.student_id, date: session.date,
          status: remote.status, recordedBy: { id: session.teacherId, name: session.teacherName },
          captureMethod: remote.capture_method ?? 'manual', recordedAt: remote.recorded_at ?? session.updatedAt,
          updatedAt: remote.updated_at ?? session.updatedAt, syncState: 'synced', serverId: serverSession.id,
          revision: serverSession.revision,
        })
      }
      oldRequest.onerror = () => transaction.abort()
      transaction.objectStore(ERROR_STORE).add({ id: createId(), sessionId: item.sessionId, idempotencyKey, message: 'Conflict reviewed; the server version was kept.', conflict: true, resolution: 'server', createdAt: new Date().toISOString() })
    }
    sessionRequest.onerror = () => transaction.abort()
  }
  itemRequest.onerror = () => transaction.abort()
  await done
}

export async function markAttendanceConflictSuperseded(idempotencyKey, resolution) {
  const database = await openDatabase()
  const transaction = database.transaction([OUTBOX_STORE, ERROR_STORE], 'readwrite')
  const done = transactionDone(transaction)
  const outbox = transaction.objectStore(OUTBOX_STORE)
  const request = outbox.get(idempotencyKey)
  request.onsuccess = () => {
    if (!request.result || request.result.syncState !== 'conflict') return transaction.abort()
    outbox.put({ ...request.result, syncState: 'superseded', resolvedAt: new Date().toISOString(), resolution })
    transaction.objectStore(ERROR_STORE).add({ id: createId(), sessionId: request.result.sessionId, idempotencyKey, message: 'Conflict reviewed; a new correction was queued against the current server revision.', conflict: true, resolution, createdAt: new Date().toISOString() })
  }
  request.onerror = () => transaction.abort()
  await done
}

export async function getAttendanceSyncErrors() {
  const database = await openDatabase()
  return readAll(database, ERROR_STORE)
}

export async function getAttendanceStorageStatus() {
  try {
    const database = await openDatabase()
    const [sessions, outbox, errors] = await Promise.all([readAll(database, SESSION_STORE), readAll(database, OUTBOX_STORE), readAll(database, ERROR_STORE)])
    const queue = outbox.filter((item) => ['pending', 'failed', 'syncing'].includes(item.syncState))
    return {
      available: true,
      sessionCount: sessions.length,
      pendingCount: queue.length,
      syncingCount: queue.filter((item) => item.syncState === 'syncing').length,
      failedCount: queue.filter((item) => item.syncState === 'failed').length,
      conflictCount: outbox.filter((item) => item.syncState === 'conflict').length,
      latestErrorAt: errors.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt ?? null,
    }
  } catch (error) {
    return { available: false, sessionCount: 0, pendingCount: 0, syncingCount: 0, failedCount: 0, conflictCount: 0, latestErrorAt: null, error: storageError(error).message }
  }
}

export async function resetAttendanceDatabaseForTests() {
  if (databasePromise) {
    const database = await databasePromise.catch(() => undefined)
    database?.close()
    databasePromise = undefined
  }
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Could not reset test database because it is open.'))
  })
}
