import { useEffect, useRef, useState } from 'react'
import { Search, Plus, UsersRound, GraduationCap, X, QrCode, LoaderCircle, UserPlus, Check } from 'lucide-react'
import { api } from './services/apiClient.js'
import { translateText as t } from './services/translations.js'

const initials = (name = '') => name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()
const currentDate = new Date().toISOString().slice(0, 10)

export default function LiveDirectoryPage({ kind, items, query, setQuery, onAdd, onEdit, onDelete, onNavigate, onAssignmentSaved, readOnly }) {
  const [qrStudent, setQrStudent] = useState(null)
  const [assignmentClass, setAssignmentClass] = useState(null)
  const title = t(kind === 'student' ? 'Students' : kind === 'teacher' ? 'Teachers & staff' : 'Classes & sections')
  const filtered = items.filter((item) => `${item.name} ${item.id} ${item.className ?? ''} ${item.subject ?? ''} ${item.admissionNumber ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  const canEdit = !readOnly
  return <>
    <section className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" />{t('AUTHORIZED DIRECTORY · SERVER DATA')}</p><h1>{title}</h1><p className="heading-subtitle">{t('Records are loaded from your server-authorized school scope.')}</p></div>{canEdit && <button className="primary-button" onClick={onAdd}><Plus size={16} />{t(`Add ${kind}`)}</button>}</section>
    <section className="surface directory-panel"><div className="directory-toolbar"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`${t('Search')} ${title.toLowerCase()}`} /></label><span className="directory-total"><UsersRound size={16} />{filtered.length} {t('records')}</span></div>
      <div className="table-scroll"><table><thead><tr><th>{t(kind === 'class' ? 'CLASS' : 'NAME')}</th><th>{t(kind === 'student' ? 'ADMISSION NO.' : kind === 'teacher' ? 'STAFF CODE' : 'GRADE / SECTION')}</th><th>{t(kind === 'student' ? 'SECTION' : kind === 'teacher' ? 'ASSIGNMENT' : 'ACADEMIC YEAR')}</th><th>{t(kind === 'student' ? 'GENDER' : kind === 'teacher' ? 'EMAIL' : 'LEARNERS')}</th><th>{t('STATUS')}</th><th /></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><div className="table-person"><span className="table-avatar">{kind === 'class' ? <GraduationCap size={16} /> : initials(item.name)}</span><strong>{item.name}</strong></div></td><td className="mono-text">{kind === 'student' ? item.admissionNumber : kind === 'teacher' ? item.staff_code ?? item.staffCode : item.gradeLevel ? `${item.gradeLevel} / ${item.section}` : item.section}</td><td>{kind === 'student' ? item.className : kind === 'teacher' ? item.subject || (item.classes ?? []).join(', ') : item.academic_year ?? item.teacher}</td><td>{kind === 'student' ? t(item.gender ?? 'undisclosed') : kind === 'teacher' ? item.email : item.students}</td><td><span className="status-badge badge-approved">{item.active === false ? t('Inactive') : t(item.verification_status ?? 'Active')}</span></td><td><div className="row-actions"><button aria-label={`${t('View')} ${item.name}`} onClick={() => onNavigate(kind === 'student' ? 'Reports' : kind === 'class' ? 'Take attendance' : 'Reports')}>{t('View')}</button>{kind === 'student' && item.active !== false && <button aria-label={`${t('Show QR code for')} ${item.name}`} onClick={() => setQrStudent(item)}><QrCode size={14} /></button>}{kind === 'class' && canEdit && <button aria-label={`${t('Assign teacher to')} ${item.name}`} onClick={() => setAssignmentClass(item)}><UserPlus size={14} /></button>}{canEdit && <><button aria-label={`${t('Edit')} ${item.name}`} onClick={() => onEdit(item)}>{t('Edit')}</button><button aria-label={`${t('Archive')} ${item.name}`} onClick={() => onDelete(item)}><X size={15} /></button></>}</div></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="empty-state">{t('No server records match this search.')}</div>}</div>
    </section>
    {qrStudent && <StudentQrDialog student={qrStudent} onClose={() => setQrStudent(null)} />}
    {assignmentClass && <ClassAssignmentDialog schoolClass={assignmentClass} onClose={() => setAssignmentClass(null)} onSaved={onAssignmentSaved} />}
  </>
}

function ClassAssignmentDialog({ schoolClass, onClose, onSaved }) {
  const [teachers, setTeachers] = useState([])
  const [assignedTeachers, setAssignedTeachers] = useState([])
  const [teacherId, setTeacherId] = useState('')
  const [startsOn, setStartsOn] = useState(currentDate)
  const [endsOn, setEndsOn] = useState('')
  const [endDates, setEndDates] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([api.getTeachers({ pageSize: '100' }), api.getClass(schoolClass.id)]).then(([teacherResult, classResult]) => {
      if (!active) return
      const today = new Date().toISOString().slice(0, 10)
      const scheduledAssignments = classResult.teachers.filter((assignment) => !assignment.ends_on || assignment.ends_on >= today)
      const assignedIds = new Set(scheduledAssignments.map((assignment) => assignment.id))
      const available = teacherResult.items.filter((teacher) => !assignedIds.has(teacher.id))
      setAssignedTeachers(scheduledAssignments)
      setEndDates(Object.fromEntries(scheduledAssignments.map((assignment) => [assignment.id, assignment.ends_on ?? ''])))
      setTeachers(available)
      setTeacherId(available[0]?.id ?? '')
    }).catch((requestError) => { if (active) setError(requestError.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [schoolClass.id])

  const save = async (event) => {
    event.preventDefault()
    if (!teacherId) return setError(t('Choose an active teacher to assign.'))
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await api.assignTeacherToClass(schoolClass.id, teacherId, { startsOn, ...(endsOn ? { endsOn } : {}) })
      const teacher = teachers.find((item) => item.id === teacherId)
      setNotice(t('Teacher assigned to class.').replace('{name}', teacher?.display_name ?? ''))
      const newAssignment = { ...result.assignment, id: teacherId, starts_on: startsOn, ends_on: endsOn || null, display_name: teacher?.display_name ?? '' }
      setAssignedTeachers((current) => [newAssignment, ...current])
      setEndDates((current) => ({ ...current, [teacherId]: endsOn }))
      setTeachers((current) => current.filter((item) => item.id !== teacherId))
      setTeacherId((current) => current === teacherId ? teachers.find((item) => item.id !== teacherId)?.id ?? '' : current)
      setEndsOn('')
      await Promise.resolve(onSaved?.()).catch(() => {})
    } catch (requestError) { setError(requestError.message) }
    finally { setSaving(false) }
  }

  const saveAssignmentEnd = async (teacher) => {
    const value = endDates[teacher.id] ?? ''
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await api.updateTeacherAssignment(schoolClass.id, teacher.id, teacher.starts_on, value || null)
      setAssignedTeachers((current) => current.map((item) => item.id === teacher.id ? { ...item, ends_on: value || null } : item))
      setNotice(t('Assignment end date saved.'))
      await Promise.resolve(onSaved?.()).catch(() => {})
    } catch (requestError) { setError(requestError.message) }
    finally { setSaving(false) }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="class-assignment-title">
    <div className="modal-heading"><div><p className="section-kicker">{t('SCHOOL-MANAGED ASSIGNMENT')}</p><h2 id="class-assignment-title">{t('Assign a teacher')} · {schoolClass.name}</h2></div><button className="icon-button" aria-label={t('Close dialog')} onClick={onClose}><X size={18} /></button></div>
    {assignedTeachers.length > 0 && <div className="class-assigned-teachers"><p className="modal-copy">{t('Current or scheduled assignments')}</p>{assignedTeachers.map((teacher) => <div className="class-assignment-row" key={`${teacher.id}-${teacher.starts_on}`}><strong>{teacher.display_name}</strong><label className="form-label">{t('End date')}<input type="date" min={teacher.starts_on} value={endDates[teacher.id] ?? ''} onChange={(event) => setEndDates((current) => ({ ...current, [teacher.id]: event.target.value }))} /></label><button className="secondary-button" disabled={saving || (endDates[teacher.id] ?? '') === (teacher.ends_on ?? '')} onClick={() => void saveAssignmentEnd(teacher)}>{t('Save end date')}</button></div>)}</div>}
    {error && <div className="report-error" role="alert">{error}</div>}
    {notice && <div className="toast" role="status">{notice}</div>}
    <form onSubmit={save}><label className="form-label">{t('Teacher')}<select required value={teacherId} onChange={(event) => setTeacherId(event.target.value)} disabled={loading || !teachers.length}><option value="">{loading ? t('Loading teachers…') : t('Choose a teacher')}</option>{teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.display_name} · {teacher.staff_code}</option>)}</select></label><div className="invite-fields"><label className="form-label">{t('Starts on')}<input required type="date" value={startsOn} onChange={(event) => { setStartsOn(event.target.value); if (endsOn && endsOn < event.target.value) setEndsOn('') }} /></label><label className="form-label">{t('Ends on')}<input type="date" min={startsOn} value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label></div>{!loading && !teachers.length && <p className="muted-copy">{assignedTeachers.length ? t('All active teachers are already assigned to this class.') : t('No active teachers are available in this school.')}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>{t('Cancel')}</button><button className="primary-button" disabled={loading || saving || !teacherId}><Check size={15} />{saving ? t('Saving…') : t('Assign teacher')}</button></div></form>
  </section></div>
}

function StudentQrDialog({ student, onClose }) {
  const svgRef = useRef(null)
  const [state, setState] = useState({ loading: true, error: '', token: '', expiresInDays: 0 })
  useEffect(() => {
    let active = true
    const svgElement = svgRef.current
    api.createAttendanceQrToken(student.id).then((result) => {
      if (!active) return
      return import('@zxing/browser').then(({ BrowserQRCodeSvgWriter }) => {
        if (!active) return
        const writer = new BrowserQRCodeSvgWriter()
        const svg = writer.write(result.token, 220, 220)
        svg.setAttribute('role', 'img')
        svg.setAttribute('aria-label', `Attendance QR code for ${student.name}`)
        svgElement?.replaceChildren(svg)
        setState({ loading: false, error: '', token: result.token, expiresInDays: result.expiresInDays })
      })
    }).catch((error) => {
      if (active) setState({ loading: false, error: error.message, token: '', expiresInDays: 0 })
    })
    return () => { active = false; svgElement?.replaceChildren() }
  }, [student.id, student.name])

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal student-qr-modal" role="dialog" aria-modal="true" aria-labelledby="student-qr-title">
    <div className="modal-heading"><div><p className="section-kicker">{t('SIGNED · SCHOOL VERIFIED')}</p><h2 id="student-qr-title">{student.name} {t('QR code')}</h2></div><button className="icon-button" aria-label={t('Close QR code')} onClick={onClose}><X size={18} /></button></div>
    {state.loading && <div className="empty-state"><LoaderCircle size={18} />{t('Creating a secure QR code…')}</div>}
    {state.error && <div className="report-error" role="alert">{state.error}</div>}
    {!state.loading && !state.error && <><div className="student-qr-code" ref={svgRef} /><p className="muted-copy">{t('For')} {student.admissionNumber ?? t('this learner')} · {t('expires in')} {state.expiresInDays} {t('days')}. {t('The code contains a signed, expiring identifier and no personal details.')}</p></>}
    <div className="modal-actions"><button className="secondary-button" onClick={onClose}>{t('Close')}</button></div>
  </section></div>
}
