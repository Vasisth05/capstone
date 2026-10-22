import { useEffect, useState } from 'react'
import { Check, Link2, Plus, RefreshCw, UserPlus, X } from 'lucide-react'
import { api } from './services/apiClient.js'
import { translateText as t } from './services/translations.js'

export default function LiveAccountsPage({ canManage = false }) {
  const [users, setUsers] = useState([])
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showInvite, setShowInvite] = useState(false)
  const [invite, setInvite] = useState({ email: '', displayName: '', role: 'teacher', staffCode: '', subject: '' })
  const [parentId, setParentId] = useState('')
  const [linkedChildren, setLinkedChildren] = useState([])
  const [linksForParentId, setLinksForParentId] = useState('')
  const [selectedChildren, setSelectedChildren] = useState([])
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [statusUpdatingId, setStatusUpdatingId] = useState('')

  const load = async ({ showLoading = false } = {}) => {
    if (showLoading) setLoading(true)
    try {
      const [userResult, studentResult] = await Promise.all([api.getUsers(), api.getStudents({ pageSize: '100' })])
      setError('')
      setUsers(userResult.items)
      setStudents(studentResult.items)
    } catch (requestError) { setError(requestError.message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(initialLoad)
  }, [])
  useEffect(() => {
    if (!parentId) return undefined
    let active = true
    api.getParentChildren(parentId).then(({ items }) => { if (active) { setLinkedChildren(items); setLinksForParentId(parentId) } }).catch((requestError) => { if (active) setError(requestError.message) })
    return () => { active = false }
  }, [parentId])

  const visibleChildren = linksForParentId === parentId ? linkedChildren : []

  const submitInvite = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await api.inviteUser(invite)
      setInvite({ email: '', displayName: '', role: 'teacher', staffCode: '', subject: '' })
      setShowInvite(false)
      await load()
      setNotice(t(result.invitation === 'delivery_not_configured' ? 'Account created; invitation email is not configured. Configure the email provider before users can activate.' : result.invitation === 'logged_in_development' ? 'Invitation logged by the development email adapter.' : 'Account invitation sent.'))
    } catch (requestError) { setError(requestError.message) }
    finally { setSaving(false) }
  }

  const linkChildren = async (event) => {
    event.preventDefault()
    if (!parentId || !selectedChildren.length) return setError(t('Select a parent and at least one student to link.'))
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await api.linkParentChildren(parentId, selectedChildren)
      setSelectedChildren([])
      const { items } = await api.getParentChildren(parentId)
      setLinkedChildren(items)
      setLinksForParentId(parentId)
      setNotice(t('Children linked to the parent account.'))
    } catch (requestError) { setError(requestError.message) }
    finally { setSaving(false) }
  }

  const unlinkChild = async (studentId) => {
    if (!window.confirm(t('Remove this parent-child link? Attendance history will be retained.'))) return
    setNotice('')
    try {
      await api.unlinkParentChild(parentId, studentId)
      setLinkedChildren((current) => current.filter((student) => student.id !== studentId))
      setNotice(t('Parent-child link removed.'))
    } catch (requestError) { setError(requestError.message) }
  }

  const updateParentStatus = async (user) => {
    const active = !user.active
    const confirmed = window.confirm(t(active ? 'Confirm parent reactivation' : 'Confirm parent deactivation').replace('{name}', user.display_name))
    if (!confirmed) return
    setStatusUpdatingId(user.id)
    setError('')
    setNotice('')
    try {
      const { user: updated } = await api.updateParentAccountStatus(user.id, active)
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, ...updated } : item))
      setNotice(t(active ? 'Parent account reactivated.' : 'Parent account deactivated.').replace('{name}', user.display_name))
    } catch (requestError) { setError(requestError.message) }
    finally { setStatusUpdatingId('') }
  }

  return <>
    <section className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" />{t('ACCESS MANAGEMENT · SERVER DATA')}</p><h1>{t('User accounts')}</h1><p className="heading-subtitle">{t('Invite school staff and manage parent-child relationships.')}</p></div><div className="report-heading-actions"><button className="secondary-button" onClick={() => void load({ showLoading: true })}><RefreshCw size={15} />{t('Refresh')}</button>{canManage && <button className="primary-button" onClick={() => setShowInvite((value) => !value)}><UserPlus size={16} />{t('Invite user')}</button>}</div></section>
    {error && <div className="report-error" role="status"><span>{error}</span><button className="icon-button" aria-label={t('Dismiss message')} onClick={() => setError('')}><X size={15} /></button></div>}
    {notice && <div className="toast" role="status">{notice}</div>}
    {showInvite && <form className="surface invite-form" onSubmit={submitInvite}><div className="section-heading"><div><p className="section-kicker">{t('ONE-TIME INVITATION')}</p><h2>{t('Create an account invite')}</h2></div><button type="button" className="icon-button" aria-label={t('Close invitation form')} onClick={() => setShowInvite(false)}><X size={17} /></button></div><div className="invite-fields"><label className="form-label">{t('Name')}<input required value={invite.displayName} onChange={(event) => setInvite({ ...invite, displayName: event.target.value })} /></label><label className="form-label">{t('Email')}<input required type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} /></label><label className="form-label">{t('Role')}<select value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value })}><option value="teacher">{t('Teacher')}</option><option value="parent">{t('Parent / guardian')}</option></select></label>{invite.role === 'teacher' && <><label className="form-label">{t('Staff code')}<input required value={invite.staffCode} onChange={(event) => setInvite({ ...invite, staffCode: event.target.value })} /></label><label className="form-label">{t('Assignment')}<input value={invite.subject} onChange={(event) => setInvite({ ...invite, subject: event.target.value })} /></label></>}</div><div className="modal-actions"><button className="primary-button" disabled={saving}><Plus size={15} />{saving ? t('Creating…') : t('Create invitation')}</button></div></form>}
    <div className="accounts-layout"><section className="surface directory-panel"><div className="section-heading account-list-heading"><div><p className="section-kicker">{t('SCHOOL USERS')}</p><h2>{loading ? t('Loading accounts…') : `${users.length} ${t('accounts')}`}</h2></div></div><div className="table-scroll"><table><thead><tr><th>{t('USER')}</th><th>{t('ROLE')}</th><th>{t('STATUS')}</th><th>{t('STAFF CODE')}</th>{canManage && <th>{t('ACCESS')}</th>}</tr></thead><tbody>{users.map((user) => {
      const statusLabel = user.active ? 'Active' : user.role === 'parent' && user.activated_at ? 'Suspended' : 'Invitation pending'
      return <tr key={user.id}><td><div className="table-person"><span className="table-avatar">{user.display_name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span><strong>{user.display_name}</strong><small>{user.email}</small></span></div></td><td>{t(({ teacher: 'Teacher', principal: 'Principal', school_admin: 'School Admin', department: 'Education Department', parent: 'Parent' })[user.role] ?? user.role)}</td><td><span className={`status-badge ${user.active ? 'badge-approved' : 'badge-pending'}`}>{t(statusLabel)}</span></td><td>{user.staff_code ?? '—'}</td>{canManage && <td>{user.role === 'parent' && user.activated_at ? <button className="secondary-button" disabled={statusUpdatingId === user.id} onClick={() => void updateParentStatus(user)}>{statusUpdatingId === user.id ? t('Saving…') : t(user.active ? 'Deactivate' : 'Reactivate')}</button> : '—'}</td>}</tr>
    })}</tbody></table>{!loading && !users.length && <div className="empty-state">{t('No accounts in this school.')}</div>}</div></section>
      {canManage && <section className="surface parent-link-panel"><div className="section-heading"><div><p className="section-kicker">{t('FAMILY ACCESS')}</p><h2>{t('Link children')}</h2></div><span className="settings-icon"><Link2 size={17} /></span></div><label className="form-label">{t('Parent account')}<select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">{t('Choose parent')}</option>{users.filter((user) => user.role === 'parent').map((user) => <option key={user.id} value={user.id}>{user.display_name} · {user.email}</option>)}</select></label>{parentId && <><div className="linked-children">{visibleChildren.map((student) => <div key={student.id}><span><strong>{student.display_name}</strong><small>{student.class_name} · {student.admission_number}</small></span><button className="icon-button" aria-label={`${t('Unlink')} ${student.display_name}`} onClick={() => void unlinkChild(student.id)}><X size={15} /></button></div>)}{linksForParentId === parentId && !visibleChildren.length && <p className="muted-copy">{t('No children linked to this account yet.')}</p>}</div><form onSubmit={linkChildren}><label className="form-label">{t('Add student')}<select multiple value={selectedChildren} onChange={(event) => setSelectedChildren([...event.target.selectedOptions].map((option) => option.value))}>{students.filter((student) => !visibleChildren.some((linked) => linked.id === student.id)).map((student) => <option key={student.id} value={student.id}>{student.display_name} · {student.admission_number}</option>)}</select></label><button className="secondary-button" disabled={saving || !selectedChildren.length}><Check size={15} />{t('Link selected')}</button></form></>}</section>}
    </div>
  </>
}
