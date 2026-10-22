import { useCallback, useEffect, useState } from 'react'
import { Activity, Cloud, LogOut, RefreshCw, ShieldCheck } from 'lucide-react'
import { api } from './services/apiClient.js'
import { getAttendanceStorageStatus } from './services/attendanceStore.js'
import { getPreferredLanguage, translateText as t } from './services/translations.js'

function deviceLabel() {
  const key = 'ruralattend-device-label'
  try {
    const saved = localStorage.getItem(key)
    if (saved) return saved
    const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10)
    const label = `RuralAttend browser ${suffix}`
    localStorage.setItem(key, label)
    return label
  } catch {
    return 'RuralAttend browser session'
  }
}

export default function LiveDevicesPage({ online, currentUserId }) {
  const [devices, setDevices] = useState([])
  const [storage, setStorage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [revokingId, setRevokingId] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    try {
      await api.registerDevice(deviceLabel())
      const [deviceResult, localStatus] = await Promise.all([api.getDevices(), getAttendanceStorageStatus()])
      setError('')
      setDevices(deviceResult.items)
      setStorage(localStatus)
    } catch (requestError) {
      setError(requestError.message)
      try { setStorage(await getAttendanceStorageStatus()) } catch {}
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => { void refresh() }, 0)
    const heartbeat = window.setInterval(() => { void api.registerDevice(deviceLabel()).catch(() => {}) }, 5 * 60_000)
    return () => { window.clearTimeout(initialRefresh); window.clearInterval(heartbeat) }
  }, [refresh, retry])

  const revoke = async (device) => {
    const confirmed = window.confirm(t('Confirm device revoke').replace('{device}', device.device_label).replace('{name}', device.display_name))
    if (!confirmed) return
    setRevokingId(device.id)
    setError('')
    setNotice('')
    try {
      await api.revokeDevice(device.id)
      setDevices((current) => current.filter((item) => item.id !== device.id))
      setNotice(t('Device revoke complete').replace('{device}', device.device_label).replace('{name}', device.display_name))
      if (device.user_id === currentUserId) window.dispatchEvent(new CustomEvent('ruralattend:session-expired'))
    } catch (requestError) { setError(requestError.message) }
    finally { setRevokingId('') }
  }

  return <>
    <section className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" />{t('DEVICE & SYNC MONITOR')}</p><h1>{t('Device status')}</h1><p className="heading-subtitle">{t('Registered browser devices and local attendance awaiting server confirmation.')}</p></div><button className="icon-button" aria-label={t('Refresh device status')} onClick={() => { setError(''); setLoading(true); setRetry((value) => value + 1) }}><RefreshCw size={16} /></button></section>
    {error && <div className="report-error" role="alert"><span>{error}</span><button className="secondary-button" onClick={() => { setError(''); setLoading(true); setRetry((value) => value + 1) }}>{t('Retry')}</button></div>}
    {notice && <div className="toast" role="status">{notice}</div>}
    <div className="settings-panel surface">
      <SettingsRow icon={Cloud} title={t('This browser')} description={storage?.available ? `${storage.sessionCount} ${t('locally stored register(s)')}` : storage?.error ?? t('Checking local attendance storage…')} state={!storage?.available ? t('UNAVAILABLE') : storage.pendingCount ? `${storage.pendingCount} ${t('PENDING')}` : online ? t('READY') : t('OFFLINE')} />
      <SettingsRow icon={Activity} title={t('Sync queue')} description={`${storage?.failedCount ?? 0} ${t('failed')} · ${storage?.conflictCount ?? 0} ${t('conflicts')} · ${storage?.syncingCount ?? 0} ${t('syncing')}`} state={storage?.pendingCount ? t('REVIEW') : t('CLEAR')} />
      <SettingsRow icon={ShieldCheck} title={t('Server registry')} description={t('Device last-seen times update when this account reconnects and while the app is open.')} state={t('SERVER DATA')} />
    </div>
    <section className="surface directory-panel device-list-panel"><div className="section-heading"><div><p className="section-kicker">{t('AUTHORIZED SCHOOL SCOPE')}</p><h2>{loading ? t('Loading registered devices…') : `${devices.length} ${t(devices.length === 1 ? 'registered device' : 'registered devices')}`}</h2></div><span className="tag">{t('SERVER DATA')}</span></div>
      <div className="table-scroll"><table><thead><tr><th>{t('USER')}</th><th>{t('ROLE')}</th><th>{t('DEVICE')}</th><th>{t('LAST SEEN')}</th><th>{t('REGISTERED')}</th><th>{t('ACTION')}</th></tr></thead><tbody>{devices.map((device) => <tr key={device.id}><td><strong>{device.display_name}</strong></td><td>{t(({ teacher: 'Teacher', principal: 'Principal', school_admin: 'School Admin', department: 'Education Department', parent: 'Parent' })[device.role] ?? device.role)}</td><td>{device.device_label}</td><td>{device.last_seen_at ? new Date(device.last_seen_at).toLocaleString(getPreferredLanguage() === 'Hindi' ? 'hi-IN' : 'en-IN') : t('Never')}</td><td>{new Date(device.created_at).toLocaleDateString(getPreferredLanguage() === 'Hindi' ? 'hi-IN' : 'en-IN')}</td><td><button className="secondary-button device-revoke-button" disabled={revokingId === device.id} onClick={() => void revoke(device)}><LogOut size={14} />{revokingId === device.id ? t('Revoking') : t('Revoke & sign out')}</button></td></tr>)}</tbody></table>{!loading && !devices.length && !error && <div className="empty-state">{t('No devices are registered for this account scope.')}</div>}</div>
    </section>
  </>
}

function SettingsRow({ icon: Icon, title, description, state }) {
  return <div className="settings-row"><span className="settings-icon"><Icon size={19} /></span><div><strong>{title}</strong><span>{description}</span></div><span className="settings-state">{state}</span></div>
}
