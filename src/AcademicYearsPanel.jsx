import { useEffect, useState } from 'react'
import { Archive, CalendarDays, Check, Pencil, Plus, RefreshCw, X } from 'lucide-react'
import { api } from './services/apiClient.js'
import { translateText as t } from './services/translations.js'

const blankYear = { name: '', startsOn: '', endsOn: '', isCurrent: false }

export default function AcademicYearsPanel({ canManage }) {
  const [years, setYears] = useState([])
  const [form, setForm] = useState(blankYear)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let active = true
    api.getAcademicYears().then(({ items }) => { if (active) setYears(items) })
      .catch((requestError) => { if (active) setError(requestError.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refresh])

  const reload = () => { setLoading(true); setError(''); setRefresh((value) => value + 1) }
  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (form.id) await api.updateAcademicYear(form.id, { name: form.name, startsOn: form.startsOn, endsOn: form.endsOn })
      else await api.createAcademicYear({ name: form.name, startsOn: form.startsOn, endsOn: form.endsOn, isCurrent: form.isCurrent })
      setForm(blankYear)
      reload()
    } catch (requestError) { setError(requestError.message) }
    finally { setSaving(false) }
  }
  const edit = (year) => setForm({ id: year.id, name: year.name, startsOn: String(year.starts_on).slice(0, 10), endsOn: String(year.ends_on).slice(0, 10), isCurrent: year.is_current })
  const makeCurrent = async (year) => {
    setError('')
    try { await api.updateAcademicYear(year.id, { isCurrent: true }); reload() }
    catch (requestError) { setError(requestError.message) }
  }
  const archive = async (year) => {
    if (!window.confirm(`${t('Archive')} ${year.name}? ${t('Years with classes or attendance history are retained.')}`)) return
    setError('')
    try { await api.archiveAcademicYear(year.id); reload() }
    catch (requestError) { setError(requestError.message) }
  }

  return <section className="surface academic-years-panel">
    <div className="section-heading"><div><p className="section-kicker">{t('SCHOOL CALENDAR')}</p><h2>{t('Academic years')}</h2></div><button className="icon-button" aria-label={t('Refresh academic years')} onClick={reload}><RefreshCw size={15} /></button></div>
    {error && <div className="report-error" role="alert">{error}</div>}
    {loading ? <div className="empty-state">{t('Loading academic years…')}</div> : years.length ? <div className="academic-years-list">{years.map((year) => <article className="academic-year-row" key={year.id}>
      <span className="settings-icon"><CalendarDays size={17} /></span><span className="academic-year-copy"><strong>{year.name}{year.is_current && <span className="status-badge badge-approved">{t('Current')}</span>}</strong><small>{String(year.starts_on).slice(0, 10)} {t('to')} {String(year.ends_on).slice(0, 10)}</small></span>
      {canManage && <div className="row-actions">{!year.is_current && <button onClick={() => void makeCurrent(year)}>{t('Set current')}</button>}<button aria-label={`${t('Edit')} ${year.name}`} onClick={() => edit(year)}><Pencil size={14} /></button><button aria-label={`${t('Archive')} ${year.name}`} onClick={() => void archive(year)}><Archive size={14} /></button></div>}
    </article>)}</div> : !error && <div className="empty-state">{t('No academic years have been created.')}</div>}
    {canManage && <form className="academic-year-form" onSubmit={submit}>
      <div className="section-heading"><div><p className="section-kicker">{t(form.id ? 'UPDATE YEAR' : 'ADD YEAR')}</p><h3>{t(form.id ? 'Edit academic year' : 'Create academic year')}</h3></div>{form.id && <button type="button" className="icon-button" aria-label={t('Cancel edit')} onClick={() => setForm(blankYear)}><X size={15} /></button>}</div>
      <div className="academic-year-fields"><label className="form-label">{t('Name')}<input required minLength="4" maxLength="20" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="2026–2027" /></label><label className="form-label">{t('Starts')}<input required type="date" value={form.startsOn} onChange={(event) => setForm((current) => ({ ...current, startsOn: event.target.value }))} /></label><label className="form-label">{t('Ends')}<input required type="date" min={form.startsOn} value={form.endsOn} onChange={(event) => setForm((current) => ({ ...current, endsOn: event.target.value }))} /></label></div>
      {!form.id && <label className="academic-year-current"><input type="checkbox" checked={form.isCurrent} onChange={(event) => setForm((current) => ({ ...current, isCurrent: event.target.checked }))} />{t('Make this the current year')}</label>}
      <button className="primary-button" disabled={saving}>{form.id ? <Check size={15} /> : <Plus size={15} />}{saving ? t('Saving…') : form.id ? t('Save changes') : t('Create year')}</button>
    </form>}
  </section>
}
