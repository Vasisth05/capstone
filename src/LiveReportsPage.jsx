import { useEffect, useState } from 'react'
import { Download, FileText, RefreshCw } from 'lucide-react'
import { api } from './services/apiClient.js'
import { getPreferredLanguage, translateText as t } from './services/translations.js'
import { createCsvContent } from './services/csvExport.js'

const today = new Date().toISOString().slice(0, 10)
const defaultFrom = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
const dateLabel = (value) => new Date(`${value}T12:00:00`).toLocaleDateString(getPreferredLanguage() === 'Hindi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

const reportViews = {
  class: { label: 'Class-wise', columns: [['class_name', 'Class'], ['section', 'Section'], ['school_name', 'School'], ['district', 'District'], ['block', 'Block']] },
  daily: { label: 'Daily', columns: [['report_date', 'Date'], ['class_name', 'Class'], ['section', 'Section'], ['school_name', 'School']] },
  monthly: { label: 'Monthly', columns: [['report_month', 'Month'], ['class_name', 'Class'], ['section', 'Section'], ['school_name', 'School']] },
  student: { label: 'Student-wise', columns: [['student_name', 'Student'], ['admission_number', 'Admission no.'], ['class_name', 'Class'], ['section', 'Section'], ['school_name', 'School']] },
  school: { label: 'School-wise', columns: [['school_name', 'School'], ['district', 'District'], ['block', 'Block']] },
}
const countColumns = [['student_count', 'Students'], ['recorded_count', 'Recorded'], ['present_count', 'Present'], ['late_count', 'Late'], ['absent_count', 'Absent'], ['excused_count', 'Excused'], ['attendance_percent', 'Attendance %']]

function exportCsv(rows, from, to, view) {
  const fields = [...reportViews[view].columns, ...countColumns].map(([key, label]) => [key, t(label)])
  const content = createCsvContent(rows, fields)
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `ruralattend-${view}-report-${from}-${to}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

async function createAndDownloadReportPdf(options, filename) {
  const { downloadReportPdf } = await import('./services/reportPdf.js')
  await downloadReportPdf(options, filename)
}

export default function LiveReportsPage({ role }) {
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(today)
  const [classId, setClassId] = useState('')
  const [view, setView] = useState('class')
  const [report, setReport] = useState(null)
  const [requestState, setRequestState] = useState({ key: '', status: 'loading', error: '' })
  const [retry, setRetry] = useState(0)
  const [exportError, setExportError] = useState('')
  const validRange = from <= to
  const requestKey = `${from}|${to}|${classId}|${view}|${retry}`
  const loading = validRange && (requestState.key !== requestKey || requestState.status === 'loading')
  const error = requestState.key === requestKey ? requestState.error : ''

  useEffect(() => {
    if (!validRange) return undefined
    const controller = new AbortController()
    api.getReports({ from, to, view, ...(classId && view !== 'school' ? { classId } : {}) }, controller.signal)
      .then((data) => {
        setReport({ key: requestKey, data })
        setRequestState({ key: requestKey, status: 'loaded', error: '' })
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) setRequestState({ key: requestKey, status: 'error', error: requestError.message })
      })
    return () => controller.abort()
  }, [from, to, classId, view, retry, validRange, requestKey])

  const currentReport = report?.key === requestKey ? report.data : null
  const rows = currentReport?.items ?? []
  const totals = currentReport?.totals ?? { recordedCount: 0, presentCount: 0, lateCount: 0, absentCount: 0, excusedCount: 0, attendancePercent: 0 }
  const classOptions = [...new Map(rows.map((row) => [row.class_id, row])).values()]
  const exportColumns = [...reportViews[view].columns.map(([key, label]) => ({ key, label: t(label) })), ...countColumns.map(([key, label]) => ({ key, label: t(label) }))]
  const downloadPdf = async () => {
    setExportError('')
    try {
      await createAndDownloadReportPdf({
        title: `${t(reportViews[view].label)} ${t('attendance report')}`,
        subtitle: `${t('Authorized records')} · ${dateLabel(from)} ${t('to')} ${dateLabel(to)}`,
        summary: [`${t('Attendance')}: ${totals.attendancePercent}%`, `${t('Recorded')}: ${totals.recordedCount}`, `${t('Present')}: ${totals.presentCount}`, `${t('Late')}: ${totals.lateCount}`, `${t('Absent')}: ${totals.absentCount}`, `${t('Excused')}: ${totals.excusedCount}`],
        columns: exportColumns, rows,
      }, `ruralattend-${view}-report-${from}-${to}.pdf`)
    } catch (downloadError) { setExportError(downloadError.message) }
  }

  return <>
    <section className="page-heading">
      <div><p className="eyebrow"><span className="eyebrow-line" />{t('AUTHORIZED REPORT · SERVER DATA')}</p><h1>{t('Attendance reports')}</h1><p className="heading-subtitle">{t('Calculated from records available to your')} {t(role)} {t('account.')}</p></div>
      <div className="report-heading-actions"><button className="secondary-button" onClick={() => void downloadPdf()} disabled={loading || !rows.length}><FileText size={16} />{t('Generate PDF')}</button><button className="secondary-button" onClick={() => exportCsv(rows, from, to, view)} disabled={!rows.length}><Download size={16} />{t('Export CSV')}</button></div>
    </section>
    {exportError && <div className="report-error" role="alert">{exportError}</div>}
    <div className="report-filters surface">
      <label>{t('From')}<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>{t('To')}<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
      <label>{t('Report view')}<select value={view} onChange={(event) => setView(event.target.value)}>{Object.entries(reportViews).map(([key, definition]) => <option key={key} value={key}>{t(definition.label)}</option>)}</select></label>
      {view !== 'school' && <label>{t('Class')}<select value={classId} onChange={(event) => setClassId(event.target.value)}><option value="">{t('All authorized classes')}</option>{classOptions.filter((item) => item.class_id).map((item) => <option key={item.class_id} value={item.class_id}>{item.class_name} - {item.section}</option>)}</select></label>}
      <span className="directory-total">{loading && validRange ? t('Refreshing…') : `${rows.length} ${t(view === 'student' ? 'students' : view === 'school' ? 'schools' : 'classes')}`}</span>
    </div>
    {!validRange && <div className="report-error" role="alert">Choose a start date on or before the end date.</div>}
    {validRange && error && <div className="report-error" role="alert"><span>{error}</span><button className="secondary-button" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={15} />Retry</button></div>}
    <div className="report-summary">
      <div><span>{t('ATTENDANCE RATE')}</span><strong>{totals.attendancePercent}<small>%</small></strong><small>{t('Present and late / recorded marks')}</small></div>
      <div><span>{t('RECORDED MARKS')}</span><strong>{totals.recordedCount}</strong><small>{dateLabel(from)} – {dateLabel(to)}</small></div>
      <div><span>{t('ABSENT')}</span><strong>{totals.absentCount}</strong><small>{t('Excused absences reported separately')}</small></div>
    </div>
    <section className="surface report-table"><div className="section-heading"><div><p className="section-kicker">{t('CLASS-WISE SUMMARY')}</p><h2>{t('Authorized attendance')}</h2></div><span className="tag">{loading && validRange ? 'LOADING' : 'SERVER DATA'}</span></div>
      {loading && validRange && <div className="empty-state" aria-live="polite">{t('Loading attendance report…')}</div>}
      {!loading && validRange && !rows.length && !error && <div className="empty-state">{t('No attendance has been recorded in this date range.')}</div>}
      {!loading && validRange && rows.length > 0 && <div className="table-scroll"><table><thead><tr>{[...reportViews[view].columns, ...countColumns].map(([, label]) => <th key={label}>{t(label).toUpperCase()}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.student_id ?? row.class_id ?? row.school_id ?? `${row.report_date ?? row.report_month}-${index}`}><>{[...reportViews[view].columns, ...countColumns].map(([key]) => <td key={key}>{key === 'attendance_percent' ? <div className="table-rate"><span><i style={{ width: `${row[key]}%` }} /></span><strong>{row[key]}%</strong></div> : ['report_month', 'report_date'].includes(key) ? (row[key] ? dateLabel(String(row[key]).slice(0, 10)) : '—') : row[key] ?? (countColumns.some(([countKey]) => countKey === key) ? 0 : '—')}</td>)}</></tr>)}</tbody></table></div>}
    </section>
    <p className="demo-disclaimer">{t('Students without records are not included in the percentage denominator. Empty report scopes return 0%, not a divide-by-zero result.')}</p>
  </>
}
