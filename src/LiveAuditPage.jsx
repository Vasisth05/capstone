import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { api } from './services/apiClient.js'
import { translateText as t } from './services/translations.js'

const pageSize = 25
const emptyResult = { items: [], total: 0, page: 1, pageSize }

export default function LiveAuditPage() {
  const [query, setQuery] = useState('')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState(emptyResult)
  const [request, setRequest] = useState({ key: '', status: 'loading', error: '' })
  const [retry, setRetry] = useState(0)

  const validRange = !from || !to || from <= to
  const requestKey = `${query}|${action}|${from}|${to}|${page}|${retry}`
  const loading = validRange && (request.key !== requestKey || request.status === 'loading')
  const error = request.key === requestKey ? request.error : ''

  useEffect(() => {
    if (!validRange) return undefined
    let active = true
    const controller = new AbortController()
    api.getAuditLog({
      ...(query ? { q: query } : {}),
      ...(action ? { action } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      page,
      pageSize,
    }, controller.signal)
      .then((data) => {
        if (!active) return
        setResult(data)
        setRequest({ key: requestKey, status: 'loaded', error: '' })
      })
      .catch((requestError) => {
        if (active && !controller.signal.aborted) setRequest({ key: requestKey, status: 'error', error: requestError.message })
      })
    return () => { active = false; controller.abort() }
  }, [query, action, from, to, page, retry, requestKey, validRange])

  const actions = [...new Set(result.items.map((item) => item.action))]
  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize))
  const refresh = () => setRetry((value) => value + 1)

  return <>
    <section className="page-heading">
      <div><p className="eyebrow"><span className="eyebrow-line" />{t('ADMINISTRATION · AUTHORIZED AUDIT')}</p><h1>{t('Audit log')}</h1><p className="heading-subtitle">{t('Search events available to your account scope.')}</p></div>
      <button className="icon-button" aria-label={t('Refresh audit log')} onClick={refresh}><RefreshCw size={16} /></button>
    </section>
    <div className="directory-toolbar surface audit-toolbar">
      <label className="search-field"><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder={t('Search action, resource, or actor')} /></label>
      <label className="filter-select"><select aria-label={t('Filter audit action')} value={action} onChange={(event) => { setAction(event.target.value); setPage(1) }}><option value="">{t('All actions')}</option>{actions.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label>
      <label className="form-label audit-date">{t('From')}<input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1) }} /></label>
      <label className="form-label audit-date">{t('To')}<input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1) }} /></label>
    </div>
    {!validRange && <div className="report-error" role="alert">{t('Start date must be on or before end date.')}</div>}
    {error && <div className="report-error" role="alert"><span>{error}</span><button className="secondary-button" onClick={refresh}><RefreshCw size={15} />{t('Retry')}</button></div>}
    <section className="surface timeline-panel">
      <div className="section-heading"><div><p className="section-kicker">{t('Recent events')}</p><h2>{result.total} {t('matching events')}</h2></div><span className="tag">SERVER AUDIT</span></div>
      {loading ? <div className="empty-state" aria-live="polite">{t('Loading audit events…')}</div> : result.items.length ? result.items.map((item) => <article className="timeline-row" key={item.id}>
        <span className="timeline-icon"><ShieldCheck size={17} /></span>
        <span><strong>{item.action.replaceAll('_', ' ')}</strong><small>{item.actor_name ?? 'Account removed'} · {item.resource_type}{item.resource_id ? ` · ${item.resource_id}` : ''}</small></span>
        <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
      </article>) : !error && <div className="empty-state">{t('No audit events match these filters.')}</div>}
      <div className="pagination-bar"><span>{t('Page')} {page} {t('of')} {pageCount}</span><div>
        <button className="secondary-button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} />{t('Previous')}</button>
        <button className="secondary-button" disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>{t('Next')}<ChevronRight size={15} /></button>
      </div></div>
    </section>
  </>
}
