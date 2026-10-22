import { useEffect, useState } from 'react'
import { Bell, CheckCheck, RefreshCw } from 'lucide-react'
import { api } from './services/apiClient.js'
import { getPreferredLanguage, translateText as t } from './services/translations.js'

export default function LiveNotificationsPage({ role }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let active = true
    api.getNotifications({ pageSize: '50' }).then(({ items: loaded }) => {
      if (active) setItems(loaded)
    }).catch((requestError) => {
      if (active) setError(requestError.message)
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refresh])

  const markRead = async (id) => {
    try {
      await api.markNotificationRead(id)
      setItems((current) => current.map((item) => item.id === id ? { ...item, read_at: item.read_at ?? new Date().toISOString() } : item))
    } catch (requestError) { setError(requestError.message) }
  }
  const markAllRead = async () => {
    try {
      await api.markAllNotificationsRead()
      const readAt = new Date().toISOString()
      setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? readAt })))
    } catch (requestError) { setError(requestError.message) }
  }

  return <>
    <section className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" />{t('SERVER NOTIFICATIONS · PRIVATE INBOX')}</p><h1>{t(role === 'Parent' ? 'School messages' : 'Notifications & alerts')}</h1><p className="heading-subtitle">{t('In-app messages addressed to your authenticated account.')}</p></div><div className="report-heading-actions"><button className="secondary-button" onClick={markAllRead}><CheckCheck size={16} />{t('Mark all read')}</button><button className="icon-button" aria-label={t('Refresh notifications')} onClick={() => { setLoading(true); setRefresh((value) => value + 1) }}><RefreshCw size={16} /></button></div></section>
    {error && <div className="report-error" role="alert"><span>{error}</span><button className="secondary-button" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={15} />{t('Retry')}</button></div>}
    <section className="surface notification-list" aria-live="polite">{loading ? <div className="empty-state">{t('Loading your notifications…')}</div> : items.length ? items.map((item) => <article className={`notification-row ${item.read_at ? 'notification-read' : ''}`} key={item.id}><span className="notification-mark"><Bell size={16} /></span><div><strong>{item.title}</strong><p>{item.message}</p><time>{new Date(item.created_at).toLocaleString(getPreferredLanguage() === 'Hindi' ? 'hi-IN' : 'en-IN')}</time></div><span className={`status-badge ${item.read_at ? '' : 'badge-pending'}`}>{t(item.read_at ? 'Read' : 'Unread')}</span>{!item.read_at && <button className="secondary-button" onClick={() => markRead(item.id)}>{t('Mark read')}</button>}</article>) : !error && <div className="empty-state">{t('No notifications for this account.')}</div>}</section>
  </>
}
