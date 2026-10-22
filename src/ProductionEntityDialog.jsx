import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { translateText as t } from './services/translations.js'

export default function ProductionEntityDialog({ type, form, classes, onClose, onSave, onNotice }) {
  const [values, setValues] = useState({ ...form })
  const isEditing = Boolean(values.id)
  const update = (key, value) => setValues((current) => ({ ...current, [key]: value }))
  const save = () => {
    if (!values.name?.trim()) return onNotice(t('Enter a name before saving.'))
    if (type === 'student' && (!values.admissionNumber?.trim() || !values.className)) return onNotice(t('Enter an admission number and select a class.'))
    if (type === 'teacher' && (!isEditing && (!values.email?.trim() || !values.staffCode?.trim()) || !values.subject?.trim())) return onNotice(t('Enter the teacher email, staff code, and assignment.'))
    if (type === 'class' && !values.section?.trim()) return onNotice(t('Enter a section for this class.'))
    onSave(values)
  }
  const entityName = t(({ student: 'Student', teacher: 'Teacher', class: 'Class' })[type])
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="entity-dialog-title"><div className="modal-heading"><div><p className="section-kicker">{t('SERVER-MANAGED RECORD')}</p><h2 id="entity-dialog-title">{t(isEditing ? 'Update' : 'Add')} {entityName}</h2></div><button className="icon-button" onClick={onClose} aria-label={t('Close dialog')}><X size={18} /></button></div>
    <label className="form-label">{t('Name')}<input autoFocus value={values.name ?? ''} onChange={(event) => update('name', event.target.value)} /></label>
    {type === 'student' && <><label className="form-label">{t('Admission number')}<input value={values.admissionNumber ?? ''} onChange={(event) => update('admissionNumber', event.target.value)} /></label><label className="form-label">{t('Class')}<select value={values.className ?? ''} onChange={(event) => update('className', event.target.value)}><option value="">{t('Select a class')}</option>{classes.map((item) => <option key={item.id}>{item.name}</option>)}</select></label><label className="form-label">{t('Gender')}<select value={values.gender ?? ''} onChange={(event) => update('gender', event.target.value)}><option value="">{t('Not specified')}</option><option value="female">{t('Female')}</option><option value="male">{t('Male')}</option><option value="other">{t('Other')}</option><option value="undisclosed">{t('Prefer not to say')}</option></select></label></>}
    {type === 'teacher' && <>{!isEditing && <><label className="form-label">{t('Account email')}<input type="email" autoComplete="email" value={values.email ?? ''} onChange={(event) => update('email', event.target.value)} /></label><label className="form-label">{t('Staff code')}<input value={values.staffCode ?? ''} onChange={(event) => update('staffCode', event.target.value)} /></label></>}<label className="form-label">{t('Assignment / subject')}<input value={values.subject ?? ''} onChange={(event) => update('subject', event.target.value)} /></label></>}
    {type === 'class' && <><label className="form-label">{t('Academic grade')}<input value={values.gradeLevel ?? ''} onChange={(event) => update('gradeLevel', event.target.value)} placeholder={t('e.g. 6')} /></label><label className="form-label">{t('Section')}<input value={values.section ?? ''} onChange={(event) => update('section', event.target.value)} placeholder={t('e.g. A')} /></label><p className="modal-copy">{t('Class name and section are stored separately in the school database.')}</p></>}
    <div className="modal-actions"><button className="secondary-button" onClick={onClose}>{t('Cancel')}</button><button className="primary-button" onClick={save}><Check size={16} />{t('Save')} {entityName}</button></div>
  </section></div>
}
