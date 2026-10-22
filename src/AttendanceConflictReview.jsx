import { useMemo, useState } from 'react'
import { Check, RefreshCw, ShieldAlert } from 'lucide-react'
import { api } from './services/apiClient.js'
import { markAttendanceConflictSuperseded, resolveAttendanceConflictWithServer, submitAttendance } from './services/attendanceStore.js'
import { translateText as t } from './services/translations.js'
import './AttendanceConflictReview.css'

export default function AttendanceConflictReview({ conflict, className, teacherName, students, onResolved }) {
  const [server, setServer] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const names = useMemo(() => new Map(students.map((student) => [student.id, student.name])), [students])
  if (!conflict) return null

  const inspect = async () => {
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const { items } = await api.getAttendance({ date: conflict.payload.date, classId: conflict.payload.classId, pageSize: 100 })
      const current = items.find((item) => item.class_id === conflict.payload.classId && item.attendance_date.slice(0, 10) === conflict.payload.date)
      if (!current) throw new Error(t('The current server register was not found. Keep the local copy and ask an administrator to review it.'))
      const detail = await api.getAttendanceSession(current.id)
      setServer(detail)
    } catch (requestError) { setError(requestError.message) }
    finally { setLoading(false) }
  }

  const chooseServerVersion = async () => {
    if (!server) return
    setSaving(true)
    setError('')
    try {
      await resolveAttendanceConflictWithServer(conflict.idempotencyKey, server.session, server.records)
      setServer(null)
      setMessage(t('The current server register is now saved on this device.'))
      await onResolved()
    } catch (requestError) { setError(requestError.message) }
    finally { setSaving(false) }
  }

  const keepLocal = async () => {
    if (!server) return
    setSaving(true)
    setError('')
    try {
      const statuses = conflict.payload.records
      const result = await submitAttendance({
        date: conflict.payload.date, className, statuses, schoolId: conflict.payload.schoolId,
        classId: conflict.payload.classId, teacherId: conflict.payload.teacherId,
        teacherName,
        revision: server.session.revision, captureMethod: conflict.payload.captureMethod ?? 'manual',
        allowLegacySnapshot: true,
      })
      await markAttendanceConflictSuperseded(conflict.idempotencyKey, 'local_correction')
      setServer(null)
      setMessage(t('Local attendance was queued as a new correction ({key}).').replace('{key}', result.idempotencyKey.slice(0, 8)))
      await onResolved()
    } catch (requestError) { setError(requestError.message) }
    finally { setSaving(false) }
  }

  const serverStatuses = new Map((server?.records ?? []).map((record) => [record.student_id, record.status]))
  return <section className="surface conflict-review" aria-labelledby="conflict-title">
    <div className="section-heading"><div><p className="section-kicker"><ShieldAlert size={14} /> {t('SYNC CONFLICT')}</p><h2 id="conflict-title">{t('Review server changes before correcting attendance')}</h2></div><span className="status-badge badge-pending">{t('Revision conflict')}</span></div>
    <p>{t('This local register differs from a newer server revision. Compare the values and choose which complete register to keep. No data is replaced until you choose.')}</p>
    {!server ? <button className="secondary-button" onClick={() => void inspect()} disabled={loading || saving}><RefreshCw size={15} />{loading ? t('Loading server register…') : t('Load current server register')}</button> : <>
      <p className="conflict-revision">{t('Server revision')} {server.session.revision} · {server.records.length} {t('server records')}</p>
      <div className="table-scroll"><table><thead><tr><th>{t('Student')}</th><th>{t('Local')}</th><th>{t('Server')}</th></tr></thead><tbody>{Object.entries(conflict.payload.records).map(([studentId, status]) => <tr key={studentId}><td>{names.get(studentId) ?? studentId}</td><td>{t(status[0].toUpperCase() + status.slice(1))}</td><td>{t(serverStatuses.get(studentId) ? serverStatuses.get(studentId)[0].toUpperCase() + serverStatuses.get(studentId).slice(1) : 'No server mark')}</td></tr>)}</tbody></table></div>
      <div className="conflict-actions"><button className="secondary-button" onClick={() => void chooseServerVersion()} disabled={saving}><Check size={15} />{t('Use server register')}</button><button className="primary-button" onClick={() => void keepLocal()} disabled={saving}><RefreshCw size={15} />{t('Keep local and queue correction')}</button></div>
    </>}
    {error && <p className="report-error" role="alert">{error}</p>}{message && <p className="conflict-success" role="status">{message}</p>}
  </section>
}
