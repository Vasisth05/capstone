import { useEffect, useState } from 'react'
import { Download, Eye, RefreshCw, X } from 'lucide-react'
import { api } from './services/apiClient.js'
import { createCsvContent } from './services/csvExport.js'
import { translateText as t } from './services/translations.js'

const today = new Date().toISOString().slice(0, 10)
const pageSize = 25

function exportCsv(schools) {
  const fields = [['name', 'School'], ['code', 'Code'], ['district', 'District'], ['block', 'Block'], ['class_count', 'Classes'], ['student_count', 'Students'], ['recorded_count', 'Recorded'], ['attendance_percent', 'Attendance %'], ['verification_status', 'Verification']]
  const url = URL.createObjectURL(new Blob([createCsvContent(schools, fields)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `ruralattend-schools-${today}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

export default function LiveDepartmentPage({ view, role }) {
  const [date, setDate] = useState(today)
  const [district, setDistrict] = useState('')
  const [block, setBlock] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState(null)
  const [schools, setSchools] = useState([])
  const [selectedSchool, setSelectedSchool] = useState(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [updatingSchool, setUpdatingSchool] = useState('')
  const [error, setError] = useState('')
  const [requestKey, setRequestKey] = useState(0)

  useEffect(() => {
    let active = true
    api.getSchools({ date, ...(district ? { district } : {}), ...(block ? { block } : {}), page, pageSize })
      .then(({ items, total: count, summary: overall }) => { if (active) { setSchools(items); setTotal(count); setSummary(overall) } })
      .catch((requestError) => { if (active) setError(requestError.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [date, district, block, page, requestKey])

  const districts = [...new Set(schools.map((school) => school.district))].sort()
  const blocks = [...new Set(schools.filter((school) => !district || school.district === district).map((school) => school.block))].sort()
  const openSchool = async (id) => {
    try { setSelectedSchool((await api.getSchool(id)).school) }
    catch (requestError) { setError(requestError.message) }
  }
  const setVerification = async (school, status) => {
    setUpdatingSchool(school.id)
    setError('')
    try {
      const response = await api.updateSchoolVerification(school.id, status)
      setSchools((current) => current.map((item) => item.id === school.id ? { ...item, verification_status: response.school.verification_status } : item))
      setSelectedSchool((current) => current?.id === school.id ? { ...current, verification_status: response.school.verification_status } : current)
    } catch (requestError) { setError(requestError.message) }
    finally { setUpdatingSchool('') }
  }
  const downloadAll = async () => {
    setExporting(true)
    setError('')
    try {
      const filters = { date, ...(district ? { district } : {}), ...(block ? { block } : {}), pageSize: 100 }
      const first = await api.getSchools({ ...filters, page: 1 })
      const all = [...first.items]
      for (let next = 2; all.length < first.total; next += 1) {
        const result = await api.getSchools({ ...filters, page: next })
        all.push(...result.items)
        if (!result.items.length) break
      }
      exportCsv(all)
    } catch (requestError) { setError(requestError.message) }
    finally { setExporting(false) }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  return <>
    <section className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" />{t('EDUCATION DEPARTMENT · AUTHORIZED SCOPE')}</p><h1>{t(view)}</h1><p className="heading-subtitle">{t('School analytics available to your department account.')}</p></div><button className="secondary-button" onClick={() => void downloadAll()} disabled={!total || exporting}><Download size={16} />{t(exporting ? 'Preparing CSV…' : 'Consolidated CSV')}</button></section>
    <div className="report-filters surface"><label>{t('Attendance date')}<input type="date" value={date} onChange={(event) => { setLoading(true); setError(''); setDate(event.target.value); setPage(1) }} /></label><label>{t('District')}<select value={district} onChange={(event) => { setLoading(true); setError(''); setDistrict(event.target.value); setBlock(''); setPage(1) }}><option value="">{t('All authorized districts')}</option>{districts.map((item) => <option key={item}>{item}</option>)}</select></label><label>{t('Block')}<select value={block} onChange={(event) => { setLoading(true); setError(''); setBlock(event.target.value); setPage(1) }}><option value="">{t('All blocks')}</option>{blocks.map((item) => <option key={item}>{item}</option>)}</select></label><span className="directory-total" aria-live="polite">{loading ? t('Loading…') : t('{count} schools').replace('{count}', String(total))}</span></div>
    {error && <div className="report-error" role="alert"><span>{error}</span><button className="secondary-button" onClick={() => { setError(''); setLoading(true); setRequestKey((value) => value + 1) }}><RefreshCw size={15} />{t('Retry')}</button></div>}
    <div className="department-summary"><div><span>{t('SCHOOLS IN SCOPE')}</span><strong>{summary?.total ?? total}</strong></div><div><span>{t('AVERAGE ATTENDANCE')}</span><strong>{summary?.average_attendance ?? 0}%</strong></div><div><span>{t('NEEDS VERIFICATION')}</span><strong>{summary?.needs_verification ?? 0}</strong></div></div>
    <section className="surface directory-panel"><div className="section-heading"><div><p className="section-kicker">{t(view === 'Compare schools' ? 'COMPARISON' : 'DIRECTORY')}</p><h2>{t(district || 'Authorized districts')} · {date}</h2></div><span className="tag">{t('SERVER DATA')}</span></div><div className="table-scroll"><table aria-label={t('Schools in authorized scope')}><thead><tr>{['SCHOOL', 'DISTRICT', 'BLOCK', 'CLASSES', 'STUDENTS', 'ATTENDANCE', 'VERIFICATION'].map((label) => <th key={label} scope="col">{t(label)}</th>)}<th scope="col"><span className="sr-only">{t('Actions')}</span></th></tr></thead><tbody>{schools.map((school) => <tr key={school.id}><td><strong>{school.name}</strong><small>{school.code}</small></td><td>{school.district}</td><td>{school.block}</td><td>{school.class_count}</td><td>{school.student_count}</td><td><div className="table-rate"><span><i style={{ width: `${school.attendance_percent}%` }} /></span><strong>{school.attendance_percent}%</strong></div></td><td><select className="status-select" aria-label={`${t('Verification status for')} ${school.name}`} value={school.verification_status} disabled={role !== 'Education Department' || updatingSchool === school.id} onChange={(event) => void setVerification(school, event.target.value)}><option value="pending">{t('pending')}</option><option value="verified">{t('verified')}</option><option value="rejected">{t('rejected')}</option></select></td><td><div className="row-actions"><button aria-label={`${t('View school')} ${school.name}`} onClick={() => void openSchool(school.id)}><Eye size={14} /></button></div></td></tr>)}</tbody></table>{!loading && !schools.length && !error && <div className="empty-state">{t('No schools are available in this authorized scope.')}</div>}</div>
      <div className="panel-footer"><span>{t('Showing {start}–{end} of {total}').replace('{start}', String(total ? (page - 1) * pageSize + 1 : 0)).replace('{end}', String(Math.min(page * pageSize, total))).replace('{total}', String(total))}</span><div className="footer-actions"><button className="secondary-button" disabled={page <= 1 || loading} onClick={() => { setLoading(true); setPage((current) => Math.max(1, current - 1)) }}>{t('Previous')}</button><span>{t('Page {page} of {pages}').replace('{page}', String(page)).replace('{pages}', String(pageCount))}</span><button className="secondary-button" disabled={page >= pageCount || loading} onClick={() => { setLoading(true); setPage((current) => Math.min(pageCount, current + 1)) }}>{t('Next')}</button></div></div>
    </section>
    {selectedSchool && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedSchool(null) }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="school-detail-title"><div className="modal-heading"><div><p className="section-kicker">{t('AUTHORIZED SCHOOL DETAIL')}</p><h2 id="school-detail-title">{selectedSchool.name}</h2></div><button className="icon-button" aria-label={t('Close school detail')} onClick={() => setSelectedSchool(null)}><X size={18} /></button></div><p>{selectedSchool.district} · {selectedSchool.block}</p><p>{selectedSchool.address || t('No address recorded.')}</p><p>{selectedSchool.student_count ?? 0} {t('students')} · {selectedSchool.class_count ?? 0} {t('classes')} · {selectedSchool.attendance_percent ?? 0}% {t('attendance')}</p><label>{t('Verification status')}<select value={selectedSchool.verification_status} disabled={role !== 'Education Department' || updatingSchool === selectedSchool.id} onChange={(event) => void setVerification(selectedSchool, event.target.value)}><option value="pending">{t('pending')}</option><option value="verified">{t('verified')}</option><option value="rejected">{t('rejected')}</option></select></label></section></div>}
  </>
}
