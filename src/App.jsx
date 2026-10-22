import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  Activity, Bell, BookOpenCheck, CalendarDays, Check, CheckCheck, ChevronDown,
  ChevronRight, CircleHelp, ClipboardCheck, Cloud, CloudOff, Download,
  FileText, GraduationCap, LayoutDashboard, LockKeyhole, LogOut, Menu, MoreHorizontal,
  Plus, QrCode, Search, Settings2, ShieldCheck, SlidersHorizontal, UsersRound, Wifi, X,
} from 'lucide-react'
import {
  getAttendanceStorageStatus,
  loadAttendanceData,
  migrateLegacyAttendance,
  attendanceScopeKey,
  saveAttendanceDraft,
  submitAttendance,
} from './services/attendanceStore.js'
import { api } from './services/apiClient.js'
import { getPreferredLanguage, translateText } from './services/translations.js'
import { createCsvContent } from './services/csvExport.js'
import { syncPendingAttendance } from './services/attendanceSync.js'
import { summarizeChildAttendance } from './services/parentAttendance.js'
import AcademicYearsPanel from './AcademicYearsPanel.jsx'
import LiveDevicesPage from './LiveDevicesPage.jsx'
import LiveReportsPage from './LiveReportsPage.jsx'
import LiveNotificationsPage from './LiveNotificationsPage.jsx'
import LiveDirectoryPage from './LiveDirectoryPage.jsx'
import ProductionEntityDialog from './ProductionEntityDialog.jsx'
import LiveAccountsPage from './LiveAccountsPage.jsx'
import LiveDepartmentPage from './LiveDepartmentPage.jsx'
import LiveAuditPage from './LiveAuditPage.jsx'
import AttendanceConflictReview from './AttendanceConflictReview.jsx'
import './App.css'

const QrScanner = lazy(() => import('./QrScanner.jsx'))

const DEMO_MODE = import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE !== 'false'
const today = new Date().toISOString().slice(0, 10)
const roles = ['Teacher', 'Principal', 'School Admin', 'Education Department', 'Parent']
const apiRoleToUi = { teacher: 'Teacher', principal: 'Principal', school_admin: 'School Admin', department: 'Education Department', parent: 'Parent' }
const studentsSeed = [
  { id: 'ST-104', name: 'Aarav Sharma', className: 'Class V - A', gender: 'Boy', guardian: 'Ravi Sharma' },
  { id: 'ST-108', name: 'Anaya Patel', className: 'Class V - A', gender: 'Girl', guardian: 'Kiran Patel' },
  { id: 'ST-112', name: 'Dev Kumar', className: 'Class V - A', gender: 'Boy', guardian: 'Suman Kumar' },
  { id: 'ST-117', name: 'Isha Devi', className: 'Class V - A', gender: 'Girl', guardian: 'Mohan Devi' },
  { id: 'ST-121', name: 'Kabir Singh', className: 'Class V - A', gender: 'Boy', guardian: 'Pooja Singh' },
  { id: 'ST-126', name: 'Meera Joshi', className: 'Class V - A', gender: 'Girl', guardian: 'Raj Joshi' },
  { id: 'ST-131', name: 'Rohan Das', className: 'Class V - A', gender: 'Boy', guardian: 'Anil Das' },
  { id: 'ST-135', name: 'Sana Khan', className: 'Class V - A', gender: 'Girl', guardian: 'Farah Khan' },
  { id: 'ST-204', name: 'Arjun Patel', className: 'Class IV - A', gender: 'Boy', guardian: 'Nisha Patel' },
  { id: 'ST-208', name: 'Diya Sharma', className: 'Class IV - A', gender: 'Girl', guardian: 'Ravi Sharma' },
  { id: 'ST-212', name: 'Ibrahim Khan', className: 'Class IV - A', gender: 'Boy', guardian: 'Farah Khan' },
  { id: 'ST-217', name: 'Nisha Devi', className: 'Class IV - A', gender: 'Girl', guardian: 'Mohan Devi' },
]
const teachersSeed = [
  { id: 'T-021', name: 'Sita Kumari', subject: 'Class teacher · V-A', phone: '+91 98••• 42 108' },
  { id: 'T-018', name: 'Ramesh Prasad', subject: 'Mathematics · IV-A', phone: '+91 98••• 33 614' },
  { id: 'T-015', name: 'Farida Begum', subject: 'Language · V-A', phone: '+91 98••• 71 205' },
]
const classesSeed = [
  { id: 'CLS-05A', name: 'Class V - A', teacher: 'Sita Kumari', students: 8 },
  { id: 'CLS-05B', name: 'Class V - B', teacher: 'Farida Begum', students: 6 },
  { id: 'CLS-04A', name: 'Class IV - A', teacher: 'Ramesh Prasad', students: 4 },
]
const schoolsSeed = [
  { id: 'SCH-014', name: 'Nandipur Primary School', district: 'Sitamarhi', block: 'Riga', rate: 94, status: 'Verified' },
  { id: 'SCH-018', name: 'Rampur Upper Primary', district: 'Sitamarhi', block: 'Belsand', rate: 89, status: 'Verified' },
  { id: 'SCH-023', name: 'Kalyanpur Government School', district: 'Muzaffarpur', block: 'Kanti', rate: 82, status: 'Pending review' },
]
const initialStatus = { 'ST-104': 'present', 'ST-108': 'present', 'ST-112': 'present', 'ST-117': 'late', 'ST-121': 'present', 'ST-126': 'present', 'ST-131': 'absent', 'ST-135': 'present' }
const emptyStatus = {}
const navByRole = {
  Teacher: [['Dashboard', LayoutDashboard], ['Take attendance', CalendarDays], ['My classes', BookOpenCheck], ['Students', UsersRound], ['History', ClipboardCheck], ['Reports', FileText], ['Audit log', ClipboardCheck]],
  Principal: [['Dashboard', LayoutDashboard], ['Attendance monitor', CalendarDays], ['Students', UsersRound], ['Teachers', GraduationCap], ['Classes', BookOpenCheck], ['Reports', FileText], ['Alerts', Bell], ['Audit log', ClipboardCheck]],
  'School Admin': [['Dashboard', LayoutDashboard], ['Students', UsersRound], ['Teachers', GraduationCap], ['Classes', BookOpenCheck], ['User accounts', ShieldCheck], ['Devices & sync', Cloud], ['Audit log', ClipboardCheck]],
  'Education Department': [['Dashboard', LayoutDashboard], ['School directory', GraduationCap], ['Compare schools', Activity], ['Reports', FileText], ['Alerts', Bell], ['Audit log', ClipboardCheck]],
  Parent: [['My children', UsersRound], ['Attendance', CalendarDays], ['History', ClipboardCheck], ['Notifications', Bell]],
}
const rolePeople = {
  Teacher: ['Sita Kumari', 'SK'], Principal: ['Anil Verma', 'AV'], 'School Admin': ['Maya Singh', 'MS'],
  'Education Department': ['Neha Rao', 'NR'], Parent: ['Ravi Sharma', 'RS'],
}
const readStore = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
const writeStore = (key, value) => localStorage.setItem(key, JSON.stringify(value))
const initials = (name) => name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()
const formatDate = (value) => new Date(`${value}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
const csvDownload = (filename, rows) => {
  const [headers = [], ...values] = rows
  const fields = headers.map((label, index) => [String(index), label])
  const data = values.map((row) => Object.fromEntries(fields.map(([key], index) => [key, row[index]])))
  const content = createCsvContent(data, fields)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

function App() {
  const [role, setRole] = useState(() => DEMO_MODE ? readStore('ruralattend-role', '') : '')
  const [currentUser, setCurrentUser] = useState(null)
  const [authChecking, setAuthChecking] = useState(!DEMO_MODE)
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authPage, setAuthPage] = useState('login')
  const [activeView, setActiveView] = useState(() => role === 'Parent' ? 'My children' : 'Dashboard')
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedClass, setSelectedClass] = useState('Class V - A')
  const [selectedDate, setSelectedDate] = useState(today)
  const [captureMethod, setCaptureMethod] = useState('manual')
  const [attendanceRecords, setAttendanceRecords] = useState({})
  const [submitted, setSubmitted] = useState({})
  const [storageState, setStorageState] = useState({ ready: false, available: true, pendingCount: 0, error: '' })
  const [attendanceConflicts, setAttendanceConflicts] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [audit, setAudit] = useState(() => DEMO_MODE ? readStore('ruralattend-audit', []) : [])
  const [students, setStudents] = useState(() => DEMO_MODE ? readStore('ruralattend-students', studentsSeed) : [])
  const [teachers, setTeachers] = useState(() => DEMO_MODE ? readStore('ruralattend-teachers', teachersSeed) : [])
  const [classes, setClasses] = useState(() => DEMO_MODE ? readStore('ruralattend-classes', classesSeed) : [])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All statuses')
  const [editedAfterSubmission, setEditedAfterSubmission] = useState(false)
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState('')
  const [form, setForm] = useState({})
  const [language, setLanguage] = useState(() => readStore('ruralattend-language', 'English'))
  const [childId, setChildId] = useState('ST-104')
  const [parentAttendance, setParentAttendance] = useState([])
  const [serverReport, setServerReport] = useState(null)
  const [serverTrend, setServerTrend] = useState(null)
  const [serverSchools, setServerSchools] = useState([])
  const [serverSchoolSummary, setServerSchoolSummary] = useState(null)
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => { document.documentElement.lang = language === 'Hindi' ? 'hi' : 'en' }, [language])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  useEffect(() => {
    if (DEMO_MODE) return
    let active = true
    const clearSession = () => {
      setRole('')
      setCurrentUser(null)
      setAuthError('Your session expired. Please sign in again.')
    }
    window.addEventListener('ruralattend:session-expired', clearSession)
    api.getSession().then(({ user }) => {
      if (!active) return
      setCurrentUser(user)
      setRole(apiRoleToUi[user.role] ?? '')
      const preferredLanguage = user.language === 'hi' ? 'Hindi' : 'English'
      setLanguage(preferredLanguage)
      writeStore('ruralattend-language', preferredLanguage)
      setActiveView(user.role === 'parent' ? 'My children' : 'Dashboard')
    }).catch((error) => {
      if (active && error.code !== 'authentication_required' && error.code !== 'session_expired') setAuthError(error.message)
    }).finally(() => { if (active) setAuthChecking(false) })
    return () => {
      active = false
      window.removeEventListener('ruralattend:session-expired', clearSession)
    }
  }, [])

  useEffect(() => {
    if (DEMO_MODE || !currentUser) return
    if (currentUser.role === 'parent' || currentUser.role === 'department') {
      setClasses([])
      return
    }
    let active = true
    api.getClasses().then(({ items }) => {
      if (!active) return
      const nextClasses = items.map((item) => ({
        id: item.id,
        name: `${item.name} - ${item.section}`,
        teacher: item.teacher_names || currentUser.name,
        students: item.student_count,
      }))
      setClasses(nextClasses)
      if (nextClasses.length && !nextClasses.some((item) => item.name === selectedClass)) setSelectedClass(nextClasses[0].name)
    }).catch((error) => { if (active) setNotice(`Could not load your authorized classes: ${error.message}`) })
    return () => { active = false }
  }, [currentUser, selectedClass])

  useEffect(() => {
    if (DEMO_MODE || !currentUser) return
    let active = true
    if (currentUser.role === 'parent') {
      setStudents([])
      api.getChildren().then(({ items }) => {
        if (!active) return
        const loaded = items.map((item) => ({ ...item, id: item.id, name: item.display_name, className: `${item.class_name} - ${item.section}`, gender: item.gender ?? 'Learner', guardian: '' }))
        setStudents(loaded)
        setChildId((selectedId) => loaded.some((student) => student.id === selectedId) ? selectedId : loaded[0]?.id ?? '')
      }).catch((error) => { if (active) setNotice(`Could not load linked children: ${error.message}`) })
      return () => { active = false }
    }
    if (currentUser.role === 'department' || !classes.length) return
    const classForRequest = classes.find((schoolClass) => schoolClass.name === selectedClass)
    if (!classForRequest) return
    api.getStudents({ classId: classForRequest.id, pageSize: '100' }).then(({ items }) => {
      if (!active) return
      const loaded = items.map((item) => ({ ...item, id: item.id, name: item.display_name, className: classForRequest.name, gender: item.gender ?? 'Learner', guardian: '' }))
      setStudents((existing) => [...existing.filter((student) => student.className !== classForRequest.name), ...loaded])
    }).catch((error) => { if (active) setNotice(`Could not load your authorized students: ${error.message}`) })
    return () => { active = false }
  }, [currentUser, classes, selectedClass])

  useEffect(() => {
    if (DEMO_MODE || currentUser?.role !== 'parent' || !/^[0-9a-f-]{36}$/i.test(childId)) return
    let active = true
    api.getChildAttendance(childId).then(({ items }) => {
      if (active) setParentAttendance(items.map((item) => ({ date: item.attendance_date, status: item.status, className: `${item.class_name} - ${item.section}` })))
    }).catch((error) => { if (active) setNotice(`Could not load child attendance: ${error.message}`) })
    return () => { active = false }
  }, [currentUser, childId])

  useEffect(() => {
    if (DEMO_MODE || !currentUser) return
    let active = true
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
    Promise.all([
      api.getReports({ from, to: today }),
      currentUser.role === 'department' || currentUser.role === 'parent'
        ? Promise.resolve(null)
        : api.getReports({ from, to: today, view: 'daily' }),
      currentUser.role === 'department' ? api.getSchools({ date: today, page: 1, pageSize: 25 }) : Promise.resolve(null),
    ]).then(([report, trend, schools]) => {
      if (!active) return
      setServerReport(report)
      setServerTrend(trend)
      if (schools) { setServerSchools(schools.items); setServerSchoolSummary(schools.summary) }
    }).catch((error) => { if (active) setNotice(`Could not load authorized analytics: ${error.message}`) })
    return () => { active = false }
  }, [currentUser])

  useEffect(() => {
    if (DEMO_MODE || !currentUser || !['Students', 'Teachers', 'Classes', 'My classes'].includes(activeView)) return
    let active = true
    const load = activeView === 'Students'
      ? api.getStudents({ pageSize: '100' }).then(({ items }) => setStudents(items.map((item) => ({ ...item, name: item.display_name, admissionNumber: item.admission_number, className: `${item.class_name} - ${item.section}`, gender: item.gender ?? 'Learner', guardian: '' }))))
      : activeView === 'Teachers'
        ? api.getTeachers({ pageSize: '100' }).then(({ items }) => setTeachers(items.map((item) => ({ ...item, name: item.display_name, subject: item.subject ?? item.classes?.join(', ') ?? '', phone: item.email }))))
        : api.getClasses().then(({ items }) => setClasses(items.map((item) => ({ id: item.id, name: `${item.name} - ${item.section}`, teacher: item.teacher_names ?? '', students: item.student_count, gradeLevel: item.grade_level, section: item.section }))))
    load.catch((error) => { if (active) setNotice(`Could not load ${activeView.toLowerCase()}: ${error.message}`) })
    return () => { active = false }
  }, [currentUser, activeView])

  useEffect(() => {
    let active = true
    const legacyAttendance = DEMO_MODE ? readStore('ruralattend-attendance', {}) : {}
    const legacySubmitted = DEMO_MODE ? readStore('ruralattend-submitted', {}) : {}
    (DEMO_MODE ? migrateLegacyAttendance(legacyAttendance, legacySubmitted) : Promise.resolve())
      .then(loadAttendanceData)
      .then((data) => {
        if (!active) return
        setAttendanceRecords(data.attendanceRecords)
        setSubmitted(data.submitted)
        setAttendanceConflicts(data.conflicts ?? [])
        setStorageState({ ready: true, available: true, pendingCount: data.pendingCount, error: '' })
      })
      .catch((error) => {
        if (!active) return
        setStorageState({ ready: true, available: false, pendingCount: 0, error: error.message })
        setNotice(`Offline storage is unavailable. Attendance cannot be safely saved: ${error.message}`)
      })
    return () => { active = false }
  }, [])

  const classStudents = useMemo(() => students.filter((student) => student.className === selectedClass), [students, selectedClass])
  const currentClass = classes.find((schoolClass) => schoolClass.name === selectedClass)
  const recordKey = attendanceScopeKey({ date: selectedDate, className: selectedClass, schoolId: DEMO_MODE ? undefined : currentUser?.schoolId, classId: DEMO_MODE ? undefined : currentClass?.id })
  const currentConflict = attendanceConflicts.find((item) => item.payload.classId === currentClass?.id && item.payload.date === selectedDate)
  const attendance = attendanceRecords[recordKey] ?? (DEMO_MODE && selectedDate === today && selectedClass === 'Class V - A' ? initialStatus : emptyStatus)
  const counts = useMemo(() => classStudents.reduce((total, student) => {
    const status = attendance[student.id]
    total[status || 'unmarked'] += 1
    return total
  }, { present: 0, absent: 0, late: 0, excused: 0, unmarked: 0 }), [classStudents, attendance])
  const attendanceRate = classStudents.length ? Math.round(((counts.present + counts.late) / classStudents.length) * 100) : 0
  const isSubmitted = Boolean(submitted[recordKey])
  const submissionSnapshot = typeof submitted[recordKey] === 'object' ? submitted[recordKey].snapshot : null
  const hasAttendanceChanges = isSubmitted && submissionSnapshot
    ? JSON.stringify(attendance) !== JSON.stringify(submissionSnapshot)
    : isSubmitted && editedAfterSubmission
  const navItems = navByRole[role] ?? navByRole.Teacher
  const currentPerson = DEMO_MODE ? rolePeople[role] ?? rolePeople.Teacher : [currentUser?.name ?? 'School user', initials(currentUser?.name ?? 'User')]
  const visibleStudents = classStudents.filter((student) => {
    const matchesQuery = `${student.name} ${student.id}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (statusFilter === 'All statuses' || (attendance[student.id] ?? 'unmarked') === statusFilter.toLowerCase())
  })

  const signIn = async (credentials) => {
    if (DEMO_MODE) {
      setRole(credentials)
      writeStore('ruralattend-role', credentials)
      setActiveView(credentials === 'Parent' ? 'My children' : 'Dashboard')
      return
    }
    setAuthBusy(true)
    setAuthError('')
    try {
      const { user } = await api.login(credentials.email, credentials.password)
      const uiRole = apiRoleToUi[user.role]
      if (!uiRole) throw new Error('This account does not have a supported RuralAttend role.')
      setCurrentUser(user)
      setRole(uiRole)
      setLanguage(user.language === 'hi' ? 'Hindi' : 'English')
      setActiveView(user.role === 'parent' ? 'My children' : 'Dashboard')
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setAuthBusy(false)
    }
  }
  const signOut = async () => {
    if (!DEMO_MODE) {
      try { await api.logout() } catch (error) { setNotice(`Server sign-out failed: ${error.message}`) }
      setCurrentUser(null)
    }
    setRole('')
    if (DEMO_MODE) writeStore('ruralattend-role', '')
  }
  const requestPasswordReset = async (email) => {
    try {
      const result = await api.forgotPassword(email)
      setNotice(result.message)
      setAuthPage('reset')
    } catch (error) { setAuthError(error.message) }
  }
  const resetPassword = async (token, password) => {
    try {
      const result = await api.resetPassword(token, password)
      setAuthError('')
      setNotice(result.message)
      setAuthPage('login')
    } catch (error) { setAuthError(error.message) }
  }
  const updateAttendance = (studentId, status, method = 'manual') => {
    setCaptureMethod(method)
    const nextRecords = { ...attendanceRecords, [recordKey]: { ...attendance, [studentId]: status } }
    setAttendanceRecords(nextRecords)
    void saveAttendanceDraft({ date: selectedDate, className: selectedClass, classId: currentClass?.id, schoolId: currentUser?.schoolId, teacherId: currentUser?.id ?? currentPerson[1], teacherName: currentPerson[0], statuses: nextRecords[recordKey], captureMethod: method })
      .then(async () => {
        const current = await getAttendanceStorageStatus()
        setStorageState((state) => ({ ...state, pendingCount: current.pendingCount }))
      })
      .catch((error) => setNotice(`Attendance could not be saved: ${error.message}`))
    if (isSubmitted) setEditedAfterSubmission(true)
  }
  const markAll = () => {
    const next = Object.fromEntries(classStudents.map((student) => [student.id, 'present']))
    setAttendanceRecords((records) => {
      const result = { ...records, [recordKey]: next }
      return result
    })
    void saveAttendanceDraft({ date: selectedDate, className: selectedClass, classId: currentClass?.id, schoolId: currentUser?.schoolId, teacherId: currentUser?.id ?? currentPerson[1], teacherName: currentPerson[0], statuses: next })
      .then(async () => {
        const current = await getAttendanceStorageStatus()
        setStorageState((state) => ({ ...state, pendingCount: current.pendingCount }))
      })
      .catch((error) => setNotice(`Attendance could not be saved: ${error.message}`))
    if (isSubmitted) setEditedAfterSubmission(true)
  }
  const saveSubmission = async () => {
    try {
      const result = await submitAttendance({ date: selectedDate, className: selectedClass, classId: currentClass?.id, schoolId: currentUser?.schoolId, revision: submitted[recordKey]?.revision, statuses: attendance, teacherId: currentUser?.id ?? currentPerson[1], teacherName: currentPerson[0], captureMethod })
      const nextSubmitted = { ...submitted, [recordKey]: { at: result.session.submittedAt, snapshot: attendance, syncState: result.session.syncState, idempotencyKey: result.idempotencyKey, revision: result.session.revision } }
      setSubmitted(nextSubmitted)
      const status = await getAttendanceStorageStatus()
      setStorageState((state) => ({ ...state, pendingCount: status.pendingCount }))
    } catch (error) {
      setNotice(error.message)
      return
    }
    const nextAudit = [{ id: Date.now(), action: isSubmitted ? 'Attendance correction submitted' : 'Attendance submitted', detail: `${selectedClass} · ${formatDate(selectedDate)} · ${currentPerson[0]}`, date: new Date().toLocaleString('en-IN') }, ...audit]
    setAudit(nextAudit)
    writeStore('ruralattend-audit', nextAudit)
    setDialog('')
    setNotice(isSubmitted ? 'Correction submitted and recorded in the audit log.' : 'Attendance submitted successfully.')
  }
  const handleQrToken = async (token) => {
    let student
    try {
      if (DEMO_MODE) {
        student = classStudents.find((item) => item.id === token || item.admissionNumber === token)
      } else {
        const result = await api.verifyAttendanceQrToken(token)
        if (result.classId !== currentClass?.id) throw new Error('This QR code belongs to another class. Select its class before scanning.')
        student = classStudents.find((item) => item.id === result.student.id)
      }
      if (!student) throw new Error('That QR code is not valid for the selected class roster.')
      updateAttendance(student.id, 'present', 'qr')
      setNotice(`${student.name} marked present from a verified QR code.`)
      setDialog('')
    } catch (error) { setNotice(error.message) }
  }
  const changeView = (view) => { setActiveView(view); setMenuOpen(false); setQuery(''); setStatusFilter('All statuses') }
  const updateLanguage = async (value) => {
    setLanguage(value)
    writeStore('ruralattend-language', value)
    if (DEMO_MODE) {
      writeStore('ruralattend-language', value)
      return
    }
    try {
      await api.updateProfilePreferences({ language: value === 'Hindi' ? 'hi' : 'en' })
      setNotice('Language preference saved to your account.')
    } catch (error) { setNotice(`Language preference was not saved: ${error.message}`) }
  }
  const syncNow = async (respectBackoff = false) => {
    if (DEMO_MODE) {
      setNotice('Demo attendance is stored locally and is not sent to a server.')
      return
    }
    setSyncing(true)
    try {
      const result = await syncPendingAttendance({ respectBackoff })
      const [current, refreshed] = await Promise.all([getAttendanceStorageStatus(), loadAttendanceData()])
      setStorageState((state) => ({ ...state, pendingCount: current.pendingCount }))
      setAttendanceRecords(refreshed.attendanceRecords)
      setSubmitted(refreshed.submitted)
      setAttendanceConflicts(refreshed.conflicts ?? [])
      if (result.conflicts) setNotice(`${result.conflicts} record(s) conflict with newer server changes. Review them before retrying.`)
      else if (result.failed) setNotice(`${result.failed} record(s) could not sync. They remain saved locally for retry.`)
      else setNotice(result.synced ? `${result.synced} attendance record(s) synced with the server.` : 'No attendance records are waiting to sync.')
    } catch (error) {
      setNotice(`Sync could not start: ${error.message}. Local attendance remains saved.`)
    } finally { setSyncing(false) }
  }
  const refreshAttendanceState = async () => {
    const [refreshed, status] = await Promise.all([loadAttendanceData(), getAttendanceStorageStatus()])
    setAttendanceRecords(refreshed.attendanceRecords)
    setSubmitted(refreshed.submitted)
    setAttendanceConflicts(refreshed.conflicts ?? [])
    setStorageState((state) => ({ ...state, pendingCount: status.pendingCount }))
  }
  const openForm = (kind, item) => { setForm(item ? { ...item } : {}); setDialog(kind) }
  const saveEntity = async (kind, values = form) => {
    if (!DEMO_MODE) {
      try {
        if (kind === 'student') {
          const targetClass = classes.find((schoolClass) => schoolClass.name === values.className)
          if (!targetClass) throw new Error('Choose a class in your authorized school.')
          const payload = { classId: targetClass.id, admissionNumber: values.admissionNumber, displayName: values.name, gender: values.gender || undefined }
          const response = /^[0-9a-f-]{36}$/i.test(values.id ?? '') ? await api.updateStudent(values.id, payload) : await api.createStudent(payload)
          const saved = response.student
          const normalized = { ...saved, name: saved.display_name, admissionNumber: saved.admission_number, className: targetClass.name, gender: saved.gender ?? 'Learner', guardian: '' }
          setStudents((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? normalized : item) : [...current, normalized])
        } else if (kind === 'teacher') {
          if (/^[0-9a-f-]{36}$/i.test(values.id ?? '')) {
            const saved = (await api.updateTeacher(values.id, { displayName: values.name, subject: values.subject || null })).teacher
            setTeachers((current) => current.map((item) => item.id === saved.id ? { ...item, name: saved.display_name, subject: saved.subject } : item))
          } else {
            const response = await api.inviteUser({ email: values.email, displayName: values.name, role: 'teacher', staffCode: values.staffCode, subject: values.subject })
            setNotice(response.invitation === 'sent' ? 'Teacher invitation sent.' : 'Teacher account created; invitation delivery is not configured.')
            setDialog('')
            return
          }
        } else {
          if (role !== 'School Admin') throw new Error('Only a school administrator can create or edit classes.')
          const parts = values.name.split(' - ')
          const className = parts.length > 1 ? parts.slice(0, -1).join(' - ') : parts[0]
          const section = values.section || parts.at(-1)
          const gradeLevel = values.gradeLevel || className.replace(/^class\s*/i, '')
          const payload = { name: className, section, gradeLevel }
          if (/^[0-9a-f-]{36}$/i.test(values.id ?? '')) {
            const saved = (await api.updateClass(values.id, payload)).class
            setClasses((current) => current.map((item) => item.id === saved.id ? { ...item, name: `${saved.name} - ${saved.section}`, section: saved.section, gradeLevel: saved.grade_level } : item))
          } else {
            const years = await api.getAcademicYears()
            const currentYear = years.items.find((year) => year.is_current)
            if (!currentYear) throw new Error('Create an academic year before adding a class.')
            const saved = (await api.createClass({ ...payload, academicYearId: currentYear.id })).class
            setClasses((current) => [...current, { ...saved, name: `${saved.name} - ${saved.section}`, teacher: '', students: 0 }])
          }
        }
        setDialog('')
        setNotice(`${kind[0].toUpperCase() + kind.slice(1)} saved on the server.`)
      } catch (error) {
        setNotice(`${kind[0].toUpperCase() + kind.slice(1)} was not saved: ${error.message}`)
      }
      return
    }
    const setter = kind === 'student' ? setStudents : kind === 'teacher' ? setTeachers : setClasses
    const storageKey = `ruralattend-${kind === 'student' ? 'students' : kind === 'teacher' ? 'teachers' : 'classes'}`
    const current = kind === 'student' ? students : kind === 'teacher' ? teachers : classes
    const entity = { ...form, id: form.id || `${kind.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-4)}` }
    const next = current.some((item) => item.id === entity.id) ? current.map((item) => item.id === entity.id ? entity : item) : [...current, entity]
    setter(next)
    writeStore(storageKey, next)
    setDialog('')
    setNotice(`${kind[0].toUpperCase() + kind.slice(1)} ${form.id ? 'updated' : 'added'} in this demo school.`)
  }
  const deleteEntity = async (kind, item) => {
    if (!DEMO_MODE) {
      if (!window.confirm(`Archive ${item.name}? Historical attendance will be retained.`)) return
      try {
        if (kind === 'student') await api.deleteStudent(item.id)
        else if (kind === 'class') {
          if (role !== 'School Admin') throw new Error('Only a school administrator can delete classes.')
          await api.deleteClass(item.id)
        } else {
          if (role !== 'School Admin') throw new Error('Only a school administrator can deactivate staff.')
          await api.archiveTeacher(item.id)
        }
        const setter = kind === 'student' ? setStudents : kind === 'teacher' ? setTeachers : setClasses
        const current = kind === 'student' ? students : kind === 'teacher' ? teachers : classes
        setter(current.filter((entry) => entry.id !== item.id))
        setNotice(`${kind[0].toUpperCase() + kind.slice(1)} archived on the server.`)
      } catch (error) { setNotice(`${kind[0].toUpperCase() + kind.slice(1)} was not archived: ${error.message}`) }
      return
    }
    if (kind === 'student' && Object.values(attendanceRecords).some((record) => record[item.id])) {
      setNotice('This student has attendance records. Keep the learner in the register or remove linked records first.')
      return
    }
    if (kind === 'class' && students.some((student) => student.className === item.name)) {
      setNotice('This class still has linked students. Reassign them before deleting the class.')
      return
    }
    if (kind === 'teacher' && classes.some((schoolClass) => schoolClass.teacher === item.name)) {
      setNotice('This teacher is assigned to a class. Reassign the class teacher before deleting this account.')
      return
    }
    if (!window.confirm(`Delete ${item.name}? This action only changes this demo device.`)) return
    const current = kind === 'student' ? students : kind === 'teacher' ? teachers : classes
    const next = current.filter((entry) => entry.id !== item.id)
    const setter = kind === 'student' ? setStudents : kind === 'teacher' ? setTeachers : setClasses
    setter(next)
    writeStore(`ruralattend-${kind === 'student' ? 'students' : kind === 'teacher' ? 'teachers' : 'classes'}`, next)
    setNotice(`${kind[0].toUpperCase() + kind.slice(1)} removed.`)
  }
  const exportAttendance = () => csvDownload(`ruralattend-${selectedDate}-${selectedClass.replaceAll(' ', '-')}.csv`, [['Student ID', 'Student', 'Class', 'Date', 'Status'], ...classStudents.map((student) => [student.id, student.name, selectedClass, selectedDate, attendance[student.id] ?? 'Pending'])])

  useEffect(() => {
    if (DEMO_MODE || !currentUser || !online || storageState.pendingCount === 0 || syncing) return
    void syncNow(true)
  }, [currentUser, online, storageState.pendingCount, syncing])

  if (authChecking) return <main className="auth-screen"><section className="auth-panel"><div className="auth-brand"><div className="brand-mark"><BookOpenCheck size={21} /></div><span>RuralAttend</span></div><div className="auth-content"><h1>Checking your session</h1><p className="auth-subtitle">Verifying your secure account session.</p></div></section></main>
  if (!role) return <AuthScreen page={authPage} setPage={setAuthPage} onLogin={signIn} onForgotPassword={requestPasswordReset} onResetPassword={resetPassword} demoMode={DEMO_MODE} error={authError} busy={authBusy} />

  const dashboardView = activeView === 'Dashboard'
  const attendanceView = role !== 'Parent' && (activeView === 'Take attendance' || activeView === 'Attendance monitor' || activeView === 'Attendance')
  const directoryKind = activeView === 'Students' ? 'student' : activeView === 'Teachers' ? 'teacher' : activeView === 'Classes' || activeView === 'My classes' ? 'class' : null
  const workspaceName = DEMO_MODE
    ? role === 'Education Department' ? 'Bihar · Demo Region' : 'Nandipur Primary'
    : role === 'Education Department' ? currentUser?.districtScope ?? translateText('Authorized district') : currentUser?.schoolName ?? translateText('Authorized school')
  const workspaceDescription = DEMO_MODE
    ? role === 'Education Department' ? 'Education department' : 'Sitamarhi · Bihar'
    : role === 'Education Department' ? translateText('Department scope') : translateText('School workspace')

  return <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <div className="brand-lockup"><div className="brand-mark"><BookOpenCheck size={21} /></div><div><strong>RuralAttend</strong><span>School attendance</span></div><button className="icon-button sidebar-close" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={18} /></button></div>
      <div className="school-switcher"><div className="school-seal"><GraduationCap size={20} /></div><div className="school-name"><strong>{workspaceName}</strong><span>{workspaceDescription}</span></div><ChevronDown size={15} /></div>
      <p className="nav-label">WORKSPACE</p>
      <nav className="main-nav" aria-label="Main navigation">{navItems.map(([label, Icon]) => <button key={label} title={sidebarCollapsed ? translateText(label) : undefined} className={`nav-link ${activeView === label ? 'active' : ''}`} onClick={() => changeView(label)}><Icon size={18} /><span>{translateText(label)}</span>{label.toLowerCase().includes('attendance') && <span className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-bottom">{DEMO_MODE && <div className="demo-note"><ShieldCheck size={17} /><div><strong>Evaluation demo</strong><span>Sample data · saved on device</span></div></div>}<button className={`nav-link ${activeView === 'Settings' ? 'active' : ''}`} onClick={() => changeView('Settings')}><Settings2 size={18} /><span>{translateText('Settings')}</span></button><button className="nav-link" onClick={() => changeView('Help')}><CircleHelp size={18} /><span>{translateText('Help & guidance')}</span></button><div className="teacher-profile"><div className="teacher-avatar">{currentPerson[1]}</div><div><strong>{currentPerson[0]}</strong><span>{translateText(role)}</span></div><button className="icon-button" aria-label={translateText('Sign out')} onClick={() => void signOut()}><LogOut size={16} /></button></div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><button className="icon-button navigation-toggle" onClick={() => window.innerWidth <= 650 ? setMenuOpen(true) : setSidebarCollapsed(!sidebarCollapsed)} aria-label="Toggle navigation"><Menu size={20} /></button><div className="breadcrumb"><span>{workspaceName}</span><span className="crumb-slash">/</span><strong>{translateText(activeView)}</strong></div><div className="topbar-actions"><span className={`connection-pill ${online ? 'connected' : 'disconnected'}`}><span className="connection-dot" />{translateText(online ? 'Online' : 'Offline')}<span className="connection-divider" />{online ? <Wifi size={14} /> : <CloudOff size={14} />}</span><button className="icon-button notification-button" aria-label={translateText('Notifications')} onClick={() => changeView(role === 'Parent' ? 'Notifications' : 'Alerts')}><Bell size={18} /><i /></button>{DEMO_MODE ? <label className="role-switch"><span className="sr-only">Switch demo role</span><select value={role} onChange={(event) => signIn(event.target.value)}>{roles.map((item) => <option key={item} value={item}>{translateText(item)}</option>)}</select><ChevronDown size={13} /></label> : <span className="session-role">{translateText(role)}</span>}<div className="top-avatar">{currentPerson[1]}</div></div></header>
      <div className="content-wrap">
        {notice && <div className="toast" role="status"><Check size={16} />{notice}<button aria-label="Dismiss message" onClick={() => setNotice('')}><X size={14} /></button></div>}
        {dashboardView && <Dashboard role={role} name={currentPerson[0]} students={students} teachers={teachers} classes={classes} selectedClass={selectedClass} counts={counts} attendanceRate={attendanceRate} onNavigate={changeView} onNotice={setNotice} childId={childId} setChildId={setChildId} attendanceRecords={attendanceRecords} parentAttendance={parentAttendance} reportData={serverReport} trendData={serverTrend} schoolData={serverSchools} schoolSummary={serverSchoolSummary} demoMode={DEMO_MODE} />}
        {attendanceView && <AttendancePage selectedClass={selectedClass} teacherName={currentPerson[0]} setSelectedClass={(value) => { setSelectedClass(value); setEditedAfterSubmission(false) }} selectedDate={selectedDate} setSelectedDate={(value) => { setSelectedDate(value); setEditedAfterSubmission(false) }} classes={classes} students={visibleStudents} allStudents={classStudents} allCount={classStudents.length} attendance={attendance} counts={counts} attendanceRate={attendanceRate} query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} updateAttendance={updateAttendance} markAll={markAll} submitted={isSubmitted} submission={submitted[recordKey]} hasChanges={hasAttendanceChanges} correctionAllowed={DEMO_MODE || submitted[recordKey]?.syncState === 'synced'} storageState={storageState} syncing={syncing} conflict={currentConflict} onConflictResolved={refreshAttendanceState} onSyncNow={() => void syncNow()} onSubmit={() => setDialog('confirm')} onExport={exportAttendance} onQr={() => setDialog('qr')} />}
        {role === 'Parent' && activeView === 'Attendance' && <ParentPage view="Attendance" students={students} childId={childId} setChildId={setChildId} onNavigate={changeView} attendanceRecords={attendanceRecords} parentAttendance={parentAttendance} demoMode={DEMO_MODE} />}
        {directoryKind && (DEMO_MODE ? <DirectoryPage kind={directoryKind} items={directoryKind === 'student' ? students : directoryKind === 'teacher' ? teachers : classes} query={query} setQuery={setQuery} onAdd={() => openForm(directoryKind)} onEdit={(item) => openForm(directoryKind, item)} onDelete={(item) => deleteEntity(directoryKind, item)} onNavigate={changeView} /> : <LiveDirectoryPage kind={directoryKind} items={directoryKind === 'student' ? students : directoryKind === 'teacher' ? teachers : classes} query={query} setQuery={setQuery} onAdd={() => openForm(directoryKind)} onEdit={(item) => openForm(directoryKind, item)} onDelete={(item) => deleteEntity(directoryKind, item)} onNavigate={changeView} onAssignmentSaved={async () => { const { items } = await api.getClasses(); setClasses(items.map((item) => ({ id: item.id, name: `${item.name} - ${item.section}`, teacher: item.teacher_names ?? '', students: item.student_count, gradeLevel: item.grade_level, section: item.section }))) }} readOnly={role === 'Teacher' || (directoryKind === 'class' && role !== 'School Admin' && role !== 'Principal')} />)}
        {activeView === 'History' && (role === 'Parent' ? <ParentPage view="History" students={students} childId={childId} setChildId={setChildId} onNavigate={changeView} attendanceRecords={attendanceRecords} parentAttendance={parentAttendance} demoMode={DEMO_MODE} /> : <HistoryPage audit={audit} students={students} onExport={exportAttendance} />)}
        {activeView === 'Reports' && (DEMO_MODE ? <ReportsPage students={students} classes={classes} attendanceRecords={attendanceRecords} role={role} onNotice={setNotice} /> : <LiveReportsPage role={role} />)}
        {(activeView === 'School directory' || activeView === 'Compare schools') && (DEMO_MODE ? <DepartmentPage view={activeView} onExport={() => csvDownload('ruralattend-demo-schools.csv', [['School', 'District', 'Block', 'Attendance', 'Verification'], ...schoolsSeed.map((school) => [school.name, school.district, school.block, `${school.rate}%`, school.status])])} /> : <LiveDepartmentPage view={activeView} role={role} />)}
        {activeView === 'My children' && <ParentPage view="Dashboard" students={students} childId={childId} setChildId={setChildId} onNavigate={changeView} attendanceRecords={attendanceRecords} parentAttendance={parentAttendance} demoMode={DEMO_MODE} />}
        {activeView === 'Notifications' && (DEMO_MODE ? <NotificationsPage role={role} /> : <LiveNotificationsPage role={role} />)}
        {activeView === 'Alerts' && (DEMO_MODE ? <NotificationsPage role={role} /> : <LiveNotificationsPage role={role} />)}
        {activeView === 'User accounts' && (DEMO_MODE ? <AccountsPage onNotice={setNotice} /> : <LiveAccountsPage canManage={role === 'School Admin'} />)}
        {activeView === 'Devices & sync' && (DEMO_MODE ? <DevicesPage online={online} audit={audit} /> : <LiveDevicesPage online={online} currentUserId={currentUser?.id} />)}
        {activeView === 'Audit log' && (DEMO_MODE ? <AuditPage audit={audit} /> : <LiveAuditPage />)}
        {activeView === 'Settings' && <SettingsPage role={role} language={language} setLanguage={updateLanguage} demoMode={DEMO_MODE} />}
        {activeView === 'Help' && <HelpPage />}
        {!dashboardView && !attendanceView && !directoryKind && !['History', 'Reports', 'School directory', 'Compare schools', 'My children', 'Notifications', 'Alerts', 'User accounts', 'Devices & sync', 'Audit log', 'Settings', 'Help'].includes(activeView) && <NotFound onNavigate={() => changeView('Dashboard')} />}
      </div>
    </main>

    {dialog && <Dialog type={dialog} form={form} setForm={setForm} classes={classes} demoMode={DEMO_MODE} selectedClass={selectedClass} isCorrection={hasAttendanceChanges} onClose={() => setDialog('')} onSubmit={saveSubmission} onSave={(values) => void saveEntity(dialog, values)} onNotice={setNotice} onQrToken={handleQrToken} />}
  </div>
}

function AuthScreen({ page, setPage, onLogin, onForgotPassword, onResetPassword, demoMode, error, busy }) {
  const [selectedRole, setSelectedRole] = useState('Teacher')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '')
  return <main className="auth-screen"><section className="auth-panel"><div className="auth-brand"><div className="brand-mark"><BookOpenCheck size={21} /></div><span>RuralAttend</span></div><div className="auth-content"><p className="eyebrow"><span className="eyebrow-line" />{translateText('RURAL SCHOOL ATTENDANCE')}</p><h1>{translateText(page === 'login' ? 'Welcome back' : page === 'forgot' ? 'Reset your password' : page === 'unauthorized' ? 'Access unavailable' : 'Choose a new password')}</h1><p className="auth-subtitle">{translateText(page === 'login' ? 'A calmer, clearer school day starts here.' : page === 'forgot' ? 'We will send a short-lived reset link if the account exists.' : 'Use the secure, single-use link sent to your account email.')}</p>
    {error && <div className="auth-error" role="alert">{error}</div>}
    {page === 'login' ? <><label className="form-label">{translateText('Email address')}<input type="email" autoComplete="username" required placeholder="name@school.edu.in" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label className="form-label">{translateText('Password')}<input type="password" autoComplete="current-password" required placeholder={translateText('Enter your password')} value={password} onChange={(event) => setPassword(event.target.value)} /></label>{demoMode && <label className="form-label">{translateText('Sign in as')}<select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value)}>{roles.map((item) => <option key={item}>{translateText(item)}</option>)}</select></label>}<button className="primary-button auth-submit" disabled={busy} onClick={() => onLogin(demoMode ? selectedRole : { email, password })}><LockKeyhole size={16} />{translateText(busy ? 'Signing in…' : demoMode ? 'Enter demo workspace' : 'Sign in securely')}</button><button className="link-button" onClick={() => setPage('forgot')}>{translateText('Forgot password?')}</button>{demoMode && <div className="demo-callout"><ShieldCheck size={17} /><span><strong>{translateText('Project evaluation mode')}</strong> {translateText('No real account or password is required. Role selection is enabled only in this development demo.')}</span></div>}</> : page === 'forgot' ? <><label className="form-label">{translateText('Account email')}<input type="email" autoComplete="email" required placeholder="name@school.edu.in" value={email} onChange={(event) => setEmail(event.target.value)} /></label><button className="primary-button auth-submit" onClick={() => onForgotPassword(email)}>{translateText('Send recovery instructions')}</button><button className="link-button" onClick={() => setPage('login')}>{translateText('Back to login')}</button></> : page === 'reset' ? <><label className="form-label">{translateText('One-time reset token')}<input required value={resetToken} onChange={(event) => setResetToken(event.target.value)} placeholder={translateText('Paste the token from your email')} /></label><label className="form-label">{translateText('New password')}<input type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={translateText('At least 12 characters')} /></label><button className="primary-button auth-submit" onClick={() => onResetPassword(resetToken, password)}>{translateText('Set new password')}</button><button className="link-button" onClick={() => setPage('login')}>{translateText('Back to login')}</button></> : <><p className="auth-subtitle">{translateText('Your account does not have permission to open this page.')}</p><button className="primary-button auth-submit" onClick={() => setPage('login')}>{translateText('Return to sign in')}</button></>}
    </div><footer className="auth-footer"><span>© 2026 RuralAttend</span><span>{translateText(demoMode ? 'Demo data · no production accounts' : 'Secure account access')}</span></footer></section><aside className="auth-aside"><div className="aside-kicker">{translateText('A better school day, together')}</div><div className="aside-art"><div className="art-sun" /><div className="art-hill hill-back" /><div className="art-hill hill-front" /><div className="art-school"><div className="school-roof" /><div className="school-building"><div /><div /><div /></div></div></div><div className="aside-caption"><span>{translateText('01 / ATTENDANCE THAT WORKS OFFLINE')}</span><h2>{translateText('Every learner is accounted for.')}</h2><p>{translateText('Designed for teachers, families and school leaders across rural communities.')}</p></div></aside></main>
}

function Dashboard({ role, name, students, teachers, classes, selectedClass, counts, attendanceRate, onNavigate, onNotice, childId, setChildId, attendanceRecords, parentAttendance, reportData, trendData, schoolData, schoolSummary, demoMode }) {
  const department = role === 'Education Department'
  const parent = role === 'Parent'
  const reportRows = reportData?.items ?? []
  const total = demoMode ? students.length : reportRows.reduce((sum, row) => sum + row.student_count, 0)
  const schoolCount = demoMode ? 128 : schoolSummary?.total ?? schoolData.length
  const regionalRate = demoMode ? 91.4 : schoolSummary?.average_attendance ?? (schoolData.length ? Math.round(schoolData.reduce((sum, school) => sum + school.attendance_percent, 0) / schoolData.length) : 0)
  const schoolsToShow = demoMode ? schoolsSeed : schoolData
  const greeting = role === 'Teacher' ? 'Your class, in focus.' : role === 'Principal' ? 'A clear view of your school.' : role === 'School Admin' ? 'School operations, at a glance.' : department ? 'Attendance across the region.' : 'Your child’s school day.'
  if (parent) return <ParentPage view="Dashboard" students={students} childId={childId} setChildId={setChildId} onNavigate={onNavigate} attendanceRecords={attendanceRecords} parentAttendance={parentAttendance} demoMode={DEMO_MODE} />
  const pendingVerification = demoMode ? schoolsToShow.filter((school) => (school.verification_status ?? school.status) !== 'verified' && (school.verification_status ?? school.status) !== 'Verified').length : schoolSummary?.needs_verification ?? schoolsToShow.filter((school) => school.verification_status !== 'verified').length
  const statItems = department ? [['Schools monitored', String(schoolCount), demoMode ? 'Across 6 demo districts' : `${new Set(schoolsToShow.map((school) => school.district)).size} authorized districts`], ['Average attendance', `${regionalRate}%`, demoMode ? 'Illustrative monthly sample' : 'Recorded sessions for the selected day'], ['Needs review', String(pendingVerification), 'Verification pending']] : role === 'Teacher' ? [['Assigned classes', String(classes.length), 'Server-authorized assignments'], ['Attendance today', `${counts.present + counts.late}/${Math.max(classStudentsCount(classes, selectedClass), 1)}`, 'Selected class register'], ['Pending submissions', String(counts.unmarked), 'Students unmarked'], ['Offline records', String(reportData?.pendingSyncCount ?? 0), 'Awaiting server confirmation']] : [['Students', String(total), demoMode ? 'Across demo sections' : 'Active students in report scope'], ['Teachers', String(demoMode ? teachers.length : new Set(classes.map((item) => item.teacher).filter(Boolean)).size), 'Teaching staff'], ['Present (30 days)', String((reportData?.totals?.presentCount ?? 0) + (reportData?.totals?.lateCount ?? 0)), 'Recorded school days'], ['Attendance rate', `${demoMode ? attendanceRate : reportData?.totals?.attendancePercent ?? 0}%`, demoMode ? 'Selected class' : 'Recorded student-days']]
  return <><section className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" />{translateText(role)} {translateText(demoMode ? 'PORTAL · DEMO DATA' : 'PORTAL · AUTHORIZED DATA')}</p><h1>{translateText(greeting)}</h1><p className="heading-subtitle">{translateText('Good morning,')} {name}. {translateText('Here’s what needs your attention today.')}</p></div><div className="heading-date"><CalendarDays size={17} /><span>{formatDate(today)}</span></div></section><section className={`metric-grid ${department ? 'three-metrics' : ''}`}>{statItems.map(([label, value, note], index) => <div className="metric-card" key={label}><div className={`metric-icon metric-${index}`}><Activity size={17} /></div><span>{translateText(label)}</span><strong>{value}</strong><small>{translateText(note)}</small></div>)}</section>
    <div className="dashboard-columns"><section className="surface dashboard-main"><div className="section-heading"><div><p className="section-kicker">{translateText(department ? 'REGIONAL OVERVIEW' : 'TODAY AT A GLANCE')}</p><h2>{translateText(department ? 'School attendance' : role === 'Teacher' ? 'My classes' : 'Class attendance')}</h2></div><button className="quiet-link" onClick={() => onNavigate(department ? 'School directory' : role === 'Teacher' ? 'My classes' : 'Attendance monitor')}>{translateText('View all')} <ChevronRight size={15} /></button></div>{department ? <SchoolMiniList schools={schoolsToShow} demoMode={demoMode} /> : <><div className="class-list">{classes.slice(0, 3).map((schoolClass, index) => { const rate = reportRows.find((item) => item.class_id === schoolClass.id)?.attendance_percent ?? (demoMode ? [94, 88, 91][index] : 0); return <button key={schoolClass.id} className="class-list-row" onClick={() => onNavigate(role === 'Teacher' ? 'Take attendance' : 'Attendance monitor')}><span className={`class-monogram mono-${index}`}>{schoolClass.name.split(' ').slice(-1)[0]}</span><span className="class-row-copy"><strong>{schoolClass.name}</strong><small>{schoolClass.teacher} · {schoolClass.students} {translateText('learners')}</small></span><span className="mini-rate">{rate}%</span><ChevronRight size={17} /></button> })}</div><div className="chart-strip"><div><strong>{translateText('Attendance overview')}</strong><span>{translateText(demoMode ? 'Illustrative sample data' : 'Authorized records · last 30 days')}</span></div><MiniChart data={demoMode ? null : trendData?.items ?? []} demoMode={demoMode} /></div></>}</section><section className="surface action-panel"><div className="section-heading"><div><p className="section-kicker">{translateText('QUICK ACTIONS')}</p><h2>{translateText('Pick up where you left off')}</h2></div></div><div className="action-list">{(role === 'Teacher' ? [['Take attendance', CalendarDays, 'Open today’s register'], ['Review attendance', ClipboardCheck, 'Check or correct entries'], ['Download report', Download, 'Export a class CSV']] : department ? [['School directory', GraduationCap, 'Browse authorized schools'], ['Compare schools', Activity, 'Review attendance rates'], ['Consolidated report', Download, 'Export regional summary']] : [['Attendance monitor', CalendarDays, 'Review today’s registers'], ['Low attendance', Activity, 'Follow up with families'], ['Download reports', Download, 'Export school data']]).map(([label, Icon, desc]) => <button key={label} onClick={() => label.includes('Download') || label.includes('Consolidated') ? demoMode ? csvDownload('ruralattend-demo-report.csv', [['Report', 'Status'], ['Demo summary', 'Sample data']]) : reportData ? csvDownload('ruralattend-attendance-report.csv', [['Class', 'Section', 'Attendance %'], ...reportRows.map((item) => [item.class_name, item.section, `${item.attendance_percent}%`])]) : onNotice(translateText('Report data is not available yet. Try again after the server report loads.')) : onNavigate(label.startsWith('Review') ? 'History' : label.startsWith('Low') ? 'Alerts' : label.startsWith('Download') ? 'Reports' : label)}><span className="action-icon"><Icon size={17} /></span><span><strong>{translateText(label)}</strong><small>{translateText(desc)}</small></span><ChevronRight size={16} /></button>)}</div><div className="sync-status"><span className="sync-icon"><Cloud size={16} /></span><span><strong>{translateText(demoMode ? 'Evaluation demo' : storageStateLabel(reportData))}</strong><small>{translateText(demoMode ? 'Attendance stays on this device' : 'Server-backed reports · offline drafts on this device')}</small></span><span className="sync-dot" /></div></section></div><p className="demo-disclaimer"><ShieldCheck size={14} /> {translateText(demoMode ? 'Demo workspace. School, attendance and regional figures are illustrative sample data.' : 'Statistics are calculated from records available to your server-authorized account.')}</p></>
}

function MiniChart({ data = [], demoMode }) {
  const dailyTotals = new Map()
  if (!demoMode) {
    for (const row of data) {
      if (!row.report_date) continue
      const date = String(row.report_date).slice(0, 10)
      const totals = dailyTotals.get(date) ?? { present: 0, late: 0, recorded: 0 }
      totals.present += row.present_count
      totals.late += row.late_count
      totals.recorded += row.recorded_count
      dailyTotals.set(date, totals)
    }
  }
  const trend = demoMode
    ? [62, 76, 68, 90, 81]
    : [...dailyTotals.values()].slice(-5).map((totals) => totals.recorded
      ? Math.round(((totals.present + totals.late) / totals.recorded) * 100)
      : 0)
  return trend.length
    ? <div className="mini-chart" role="img" aria-label={translateText('Weekly attendance trend')}>{trend.map((rate, index) => <span key={index} title={`${rate}%`} style={{ height: `${Math.max(rate, 4)}%` }} />)}</div>
    : <span className="chart-empty">{translateText('No attendance trend data is available yet.')}</span>
}
const classStudentsCount = (classes, name) => classes.find((item) => item.name === name)?.students ?? 0
const storageStateLabel = (reportData) => reportData ? `${translateText('Updated')} ${new Date(reportData.generatedAt).toLocaleTimeString(getPreferredLanguage() === 'Hindi' ? 'hi-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit' })}` : translateText('Waiting for server data')
function SchoolMiniList({ schools, demoMode }) { return <div className="school-mini-list">{schools.map((school) => <div className="school-mini-row" key={school.id}><span className="school-initial">{initials(school.name)}</span><span><strong>{school.name}</strong><small>{school.block} {translateText('block')} · {school.district}</small></span><strong className="mini-rate">{demoMode ? school.rate : school.attendance_percent}%</strong></div>)}{!schools.length && <div className="empty-state">{translateText('No schools are available in your authorized district.')}</div>}</div> }

function AttendancePage({ selectedClass, teacherName, setSelectedClass, selectedDate, setSelectedDate, classes, students, allStudents, allCount, attendance, counts, attendanceRate, query, setQuery, statusFilter, setStatusFilter, updateAttendance, markAll, submitted, submission, hasChanges, correctionAllowed, storageState, syncing, conflict, onConflictResolved, onSyncNow, onSubmit, onExport, onQr }) {
  const dateLocale = getPreferredLanguage() === 'Hindi' ? 'hi-IN' : 'en-IN'
  const syncMessage = !storageState.ready ? 'Opening local attendance store…' : !storageState.available ? 'Local storage unavailable · attendance cannot be saved' : submission?.syncState === 'conflict' ? 'Sync conflict · review server changes before editing' : submission?.syncState === 'failed' ? 'Sync failed · retry without losing this local record' : submission?.syncState === 'syncing' || syncing ? 'Syncing attendance with the server…' : storageState.pendingCount ? 'submitted record(s) pending sync' : submission?.syncState === 'synced' ? 'Server confirmed · synced' : submitted ? hasChanges ? 'Changes detected · correction will be audited' : 'Saved on this device · not yet submitted' : 'Draft saved locally on this device'
  const statusLabel = submitted ? 'SUBMITTED' : 'READY TO MARK'
  return <><section className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" />{translateText('DAILY REGISTER')} · {translateText(statusLabel)}</p><h1>{translateText('Take attendance')}</h1><p className="heading-subtitle">{translateText('A quick, reliable register for every school day.')}</p></div><div className="heading-date"><CalendarDays size={17} /><span>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div></section>{!navigator.onLine && <div className="offline-banner"><CloudOff size={17} /><span><strong>{translateText('You’re offline.')}</strong> {translateText('Changes stay on this device until connectivity returns.')}</span></div>}
    <section className="attendance-summary"><div className="summary-rate"><span>{translateText('CLASS ATTENDANCE')}</span><strong>{attendanceRate}<small>%</small></strong><div className="rate-bar"><span style={{ width: `${attendanceRate}%` }} /></div></div>{[['Present', counts.present, 'present'], ['Absent', counts.absent, 'absent'], ['Late', counts.late, 'late'], ['Excused', counts.excused, 'excused']].map(([label, value, color]) => <div className="summary-count" key={label}><span className={`status-dot dot-${color}`} />{translateText(label)}<strong>{value}</strong></div>)}</section>
    <section className="surface attendance-panel"><div className="panel-heading"><div><p className="section-kicker">{translateText('CLASS REGISTER')}</p><h2>{selectedClass}</h2></div><div className="panel-controls"><label className="select-wrap"><span className="sr-only">{translateText('Select class')}</span><select value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)}>{classes.map((schoolClass) => <option key={schoolClass.id}>{schoolClass.name}</option>)}</select><ChevronDown size={15} /></label><label className="date-wrap"><span className="sr-only">{translateText('Attendance date')}</span><CalendarDays size={15} /><input type="date" aria-label={translateText('Attendance date')} value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label></div></div>
      <div className="toolbar-row"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={translateText('Find a student by name or ID')} /></label><label className="filter-select"><SlidersHorizontal size={15} /><select aria-label={translateText('Filter by attendance status')} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="All statuses">{translateText('All statuses')}</option>{['Present', 'Absent', 'Late', 'Excused', 'Unmarked'].map((status) => <option key={status} value={status}>{translateText(status)}</option>)}</select></label><span className="marked-count">{allCount - counts.unmarked} <span>{translateText('of')} {allCount} {translateText('marked')}</span></span><button className="text-action" onClick={markAll}><CheckCheck size={16} />{translateText('Mark all present')}</button></div>
      <div className="roster-head"><span>{translateText('STUDENT')}</span><span>{translateText('STUDENT ID')}</span><span>{translateText('ATTENDANCE STATUS')}</span></div><div className="roster-list">{students.map((student) => <div className="student-row" key={student.id}><div className="student-cell"><div className={`student-avatar avatar-${student.name[0].toLowerCase()}`}>{initials(student.name)}</div><div className="student-detail"><strong>{student.name}</strong><span>{translateText(student.gender === 'Boy' ? 'Boy' : student.gender === 'Girl' ? 'Girl' : student.gender)}</span></div></div><span className="student-id">{student.id}</span><div className="status-controls" role="group" aria-label={`${translateText('Attendance for')} ${student.name}`}>{['present', 'absent', 'late', 'excused'].map((status) => <button key={status} aria-pressed={attendance[student.id] === status} className={`status-button status-${status} ${attendance[student.id] === status ? 'selected' : ''}`} onClick={() => updateAttendance(student.id, status)}>{status === 'present' ? <Check size={14} /> : status === 'late' ? <Activity size={14} /> : status === 'absent' ? <X size={14} /> : <MoreHorizontal size={14} />}<span>{translateText(status[0].toUpperCase() + status.slice(1))}</span></button>)}</div></div>)}{students.length === 0 && <div className="empty-state">{translateText('No learners match these filters.')}</div>}</div>
      <div className="panel-footer"><div className="footer-note"><Cloud size={16} /><span>{storageState.pendingCount && syncMessage === 'submitted record(s) pending sync' ? `${storageState.pendingCount} ${translateText(syncMessage)}` : translateText(syncMessage)}</span></div><div className="footer-actions"><button className="secondary-button" onClick={onSyncNow} disabled={!storageState.available || !storageState.pendingCount || syncing}><Cloud size={16} />{translateText(syncing ? 'Syncing…' : 'Sync now')}</button><button className="secondary-button" onClick={onQr}><QrCode size={16} />{translateText('QR workflow')}</button><button className="secondary-button export-button" onClick={onExport}><Download size={16} />CSV</button><button className="primary-button" onClick={onSubmit} disabled={!storageState.ready || !storageState.available || counts.unmarked > 0 || (submitted && (!hasChanges || !correctionAllowed))}>{translateText(submitted ? hasChanges ? 'Submit correction' : 'Already submitted' : 'Review & submit')}<ChevronRight size={16} /></button></div></div>
    </section>{conflict && <AttendanceConflictReview conflict={conflict} className={selectedClass} teacherName={teacherName} students={allStudents} onResolved={onConflictResolved} />}<p className="page-note"><ShieldCheck size={14} /> {counts.unmarked ? translateText('{count} students still need a status before submission.').replace('{count}', String(counts.unmarked)) : translateText('All learners have a status. Submission is recorded in this device’s audit log.')}</p></>
}

function DirectoryPage({ kind, items, query, setQuery, onAdd, onEdit, onDelete, onNavigate }) {
  const title = kind === 'student' ? 'Students' : kind === 'teacher' ? 'Teachers & staff' : 'Classes & sections'
  const filtered = items.filter((item) => `${item.name} ${item.id} ${item.className ?? ''} ${item.subject ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  return <><section className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" />SCHOOL DIRECTORY · DEMO DATA</p><h1>{title}</h1><p className="heading-subtitle">Manage the people and groups connected to Nandipur Primary.</p></div><button className="primary-button" onClick={onAdd}><Plus size={16} />Add {kind}</button></section><section className="surface directory-panel"><div className="directory-toolbar"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${title.toLowerCase()}`} /></label><span className="directory-total"><UsersRound size={16} />{filtered.length} records</span></div><div className="table-scroll"><table><thead><tr><th>{kind === 'class' ? 'CLASS' : 'NAME'}</th><th>{kind === 'student' ? 'STUDENT ID' : kind === 'teacher' ? 'STAFF ID' : 'CLASS ID'}</th><th>{kind === 'student' ? 'SECTION' : kind === 'teacher' ? 'ASSIGNMENT' : 'CLASS TEACHER'}</th><th>{kind === 'student' ? 'GUARDIAN' : kind === 'class' ? 'LEARNERS' : 'CONTACT'}</th><th>DETAILS</th><th /></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><div className="table-person"><span className="table-avatar">{initials(item.name)}</span><strong>{item.name}</strong></div></td><td className="mono-text">{item.id}</td><td>{item.className || item.subject || item.teacher}</td><td>{item.guardian || item.students || item.phone}</td><td><span className="tag">{kind === 'student' ? item.gender : kind === 'teacher' ? 'Active' : 'Open'}</span></td><td><div className="row-actions"><button aria-label={`Edit ${item.name}`} onClick={() => onEdit(item)}>Edit</button><button aria-label={`View ${item.name}`} onClick={() => onNavigate(kind === 'student' ? 'Reports' : kind === 'class' ? 'Take attendance' : 'Reports')}>View</button><button aria-label={`Delete ${item.name}`} onClick={() => onDelete(item)}><X size={15} /></button></div></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="empty-state">No records found. Add a record to get started.</div>}</div></section></>
}

function ReportsPage({ students, classes, attendanceRecords, role, onNotice }) {
  const [from, setFrom] = useState(today.slice(0, 8) + '01')
  const [to, setTo] = useState(today)
  const [classFilter, setClassFilter] = useState('All classes')
  const validRange = from <= to
  const rows = (classFilter === 'All classes' ? classes : classes.filter((schoolClass) => schoolClass.name === classFilter)).map((schoolClass) => {
    const registers = Object.entries(attendanceRecords).filter(([key]) => key.endsWith(`-${schoolClass.name}`) && key.slice(0, 10) >= from && key.slice(0, 10) <= to).map(([key, record]) => ({ date: key.slice(0, 10), record }))
    const currentRegisterExists = registers.some((entry) => entry.date === today)
    if (to === today && schoolClass.name === 'Class V - A' && !currentRegisterExists) registers.push({ date: today, record: initialStatus })
    const statuses = registers.flatMap(({ record }) => students.filter((student) => student.className === schoolClass.name).map((student) => record[student.id])).filter(Boolean)
    const attended = statuses.filter((status) => ['present', 'late'].includes(status)).length
    const current = registers.find((entry) => entry.date === to)?.record ?? {}
    const studentCount = students.filter((student) => student.className === schoolClass.name).length
    return { ...schoolClass, students: studentCount, studentCount, present: Object.values(current).filter((status) => ['present', 'late'].includes(status)).length, attended, marked: statuses.length, rate: statuses.length ? Math.round(attended / statuses.length * 100) : 0 }
  }).filter(() => validRange)
  const totalMarked = rows.reduce((sum, row) => sum + row.marked, 0)
  const totalAttended = rows.reduce((sum, row) => sum + row.attended, 0)
  const periodRate = totalMarked ? Math.round(totalAttended / totalMarked * 100) : 0
  const exportReport = () => csvDownload('ruralattend-attendance-report.csv', [['Class', 'Teacher', 'Students', 'Present on end date', 'Recorded attendance', 'Records'], ...rows.map((row) => [row.name, row.teacher, row.studentCount, row.present, `${row.rate}%`, row.marked])])
  const exportPdf = async () => {
    try {
      const { downloadReportPdf } = await import('./services/reportPdf.js')
      await downloadReportPdf({
        title: translateText('Attendance report'),
        subtitle: `${translateText('Illustrative sample data')} · ${formatDate(from)} ${translateText('to')} ${formatDate(to)}`,
        summary: [`${translateText('Attendance')}: ${periodRate}%`, `${translateText('Students')}: ${students.length}`, `${translateText('RECORDED MARKS')}: ${totalMarked}`, `${translateText('Present')}: ${totalAttended}`],
        columns: [{ label: translateText('Class'), key: 'name' }, { label: translateText('Teacher'), key: 'teacher' }, { label: translateText('Students'), key: 'studentCount' }, { label: translateText('Present on end date'), key: 'present' }, { label: translateText('ATTENDANCE %'), key: 'rateLabel' }, { label: translateText('Recorded'), key: 'marked' }],
        rows: rows.map((row) => ({ ...row, rateLabel: `${row.rate}%` })),
      }, `ruralattend-demo-report-${from}-${to}.pdf`)
    } catch (error) { onNotice(`Could not generate PDF: ${error.message}`) }
  }
  const rate = periodRate
  const onExport = exportReport
  return <>
    <section className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" />{translateText('REPORTS & ANALYTICS · SAMPLE DATA')}</p><h1>{translateText('Attendance reports')}</h1><p className="heading-subtitle">{translateText('Review class performance and export a shareable summary.')}</p></div><div className="report-heading-actions"><button className="secondary-button" onClick={exportPdf}><FileText size={16} />{translateText('Generate PDF')}</button><button className="secondary-button" onClick={onExport}><Download size={16} />{translateText('Export CSV')}</button></div></section>
    <div className="report-filters surface"><label>{translateText('From')}<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>{translateText('To')}<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><label>{translateText('Class')}<select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}><option>{translateText('All classes')}</option>{classes.map((schoolClass) => <option key={schoolClass.id} value={schoolClass.name}>{schoolClass.name}</option>)}</select></label></div>
    <div className="report-summary"><div><span>{translateText('AVERAGE ATTENDANCE')}</span><strong>{rate}<small>%</small></strong><small>{translateText('Selected classes · selected dates')}</small></div><div><span>{translateText('STUDENTS IN REPORT')}</span><strong>{students.length}</strong><small>{classes.length} {translateText('Across demo sections')}</small></div><div><span>{translateText('REPORT PERIOD')}</span><strong className="period-value">{formatDate(from)} – {formatDate(to)}</strong><small>{translateText('Illustrative date range')}</small></div></div>
    <section className="surface report-table"><div className="section-heading"><div><p className="section-kicker">{translateText('CLASS-WISE SUMMARY')}</p><h2>{translateText(role === 'Education Department' ? 'Regional attendance' : 'School attendance')}</h2></div><span className="tag">{translateText('DEMO DATA')}</span></div><div className="table-scroll"><table><thead><tr><th>{translateText('CLASS')}</th><th>{translateText('TEACHER')}</th><th>{translateText('LEARNERS')}</th><th>{translateText('PRESENT TODAY')}</th><th>{translateText('ATTENDANCE')}</th><th>{translateText('STATUS')}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.teacher}</td><td>{row.students}</td><td>{row.present}</td><td><div className="table-rate"><span><i style={{ width: `${row.rate}%` }} /></span><strong>{row.rate}%</strong></div></td><td><span className="status-badge badge-approved">{translateText('On track')}</span></td></tr>)}</tbody></table></div></section>
    <p className="demo-disclaimer">{translateText('Percentage excludes students without recorded attendance. Classes with no attendance records show 0% rather than dividing by zero.')}</p>
  </>
}

function DepartmentPage({ view, onExport }) {
  const [district, setDistrict] = useState('All districts')
  const [date, setDate] = useState(today)
  const filtered = schoolsSeed.filter((school) => district === 'All districts' || school.district === district)
  return <><section className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" />EDUCATION DEPARTMENT · DEMO REGION</p><h1>{view}</h1><p className="heading-subtitle">Illustrative school and attendance data for Bihar.</p></div><button className="secondary-button" onClick={onExport}><Download size={16} />Consolidated CSV</button></section><div className="report-filters surface"><label>District<select value={district} onChange={(event) => setDistrict(event.target.value)}><option>All districts</option>{[...new Set(schoolsSeed.map((school) => school.district))].map((item) => <option key={item}>{item}</option>)}</select></label><label>Attendance date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><span className="directory-total">{filtered.length} demo schools</span></div><div className="department-summary"><div><span>SCHOOLS IN VIEW</span><strong>{filtered.length}</strong></div><div><span>AVERAGE ATTENDANCE</span><strong>{filtered.length ? Math.round(filtered.reduce((sum, school) => sum + school.rate, 0) / filtered.length) : 0}%</strong></div><div><span>NEEDS VERIFICATION</span><strong>{filtered.filter((school) => school.status !== 'Verified').length}</strong></div></div><section className="surface directory-panel"><div className="section-heading"><div><p className="section-kicker">DIRECTORY</p><h2>{district} · {formatDate(date)}</h2></div></div><div className="table-scroll"><table><thead><tr><th>SCHOOL</th><th>DISTRICT</th><th>BLOCK</th><th>ATTENDANCE</th><th>VERIFICATION</th></tr></thead><tbody>{filtered.map((school) => <tr key={school.id}><td><div className="table-person"><span className="table-avatar"><GraduationCap size={17} /></span><strong>{school.name}</strong></div></td><td>{school.district}</td><td>{school.block}</td><td><strong>{school.rate}%</strong></td><td><span className={`status-badge ${school.status === 'Verified' ? 'badge-approved' : 'badge-pending'}`}>{school.status}</span></td></tr>)}</tbody></table></div></section><p className="demo-disclaimer">All schools, rates, districts, and verification statuses on this page are illustrative demo data.</p></>
}

function ParentPage({ view, students, childId, setChildId, onNavigate, attendanceRecords, parentAttendance, demoMode }) {
  const children = demoMode ? students.filter((student) => ['ST-104', 'ST-208'].includes(student.id)) : students
  const child = children.find((student) => student.id === childId) ?? children[0]
  const childRecords = demoMode
    ? Object.entries(attendanceRecords ?? {}).filter(([key, record]) => key.endsWith(child?.className ?? '') && record[child?.id]).map(([key, record]) => ({ date: key.slice(0, 10), status: record[child.id] })).sort((a, b) => b.date.localeCompare(a.date))
    : (parentAttendance ?? []).filter((record) => record.className === child?.className)
  if (!child) return <section className="parent-home"><p className="eyebrow"><span className="eyebrow-line" />{translateText('FAMILY PORTAL')}</p><h1>{translateText('No linked children')}</h1><p className="heading-subtitle">{translateText('Ask your school administrator to link your account to a student.')}</p></section>
  const { todayStatus, attendanceRate: childRate } = summarizeChildAttendance(childRecords, today, demoMode)
  const title = view === 'History' ? 'Attendance history' : view === 'Attendance' ? 'Attendance calendar' : 'School days, made clear.'
  const monthStart = new Date(`${today}T00:00:00`)
  const year = monthStart.getFullYear()
  const month = monthStart.getMonth()
  const monthOffset = (monthStart.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const calendarCellCount = Math.ceil((monthOffset + daysInMonth) / 7) * 7
  const dateLocale = getPreferredLanguage() === 'Hindi' ? 'hi-IN' : 'en-IN'
  const weekDays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(dateLocale, { weekday: 'short' }).format(new Date(2024, 0, index + 1)))
  const monthLabel = new Intl.DateTimeFormat(dateLocale, { month: 'long', year: 'numeric' }).format(monthStart)
  return <section className="parent-home"><div className="parent-welcome"><div><p className="eyebrow"><span className="eyebrow-line" />{translateText('FAMILY PORTAL · LINKED CHILDREN ONLY')}</p><h1>{translateText(title)}</h1><p>{translateText('Daily attendance updates for your family.')}</p></div><label className="child-card"><span className="student-avatar">{initials(child.name)}</span><span className="child-card-copy"><strong>{child.name}</strong><small>{child.className} · {demoMode ? 'Nandipur Primary' : child.school_name}</small></span><select aria-label={translateText('Choose a linked child')} value={child.id} onChange={(event) => setChildId(event.target.value)}>{children.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={16} /></label></div>
    {view === 'History' ? <section className="surface timeline-panel"><div className="section-heading"><div><p className="section-kicker">{child.name.toUpperCase()}</p><h2>{translateText('Recorded school days')}</h2></div><span className="tag">{childRecords.length} {translateText('RECORDS')}</span></div>{childRecords.length ? childRecords.map((record) => <div className="timeline-row" key={record.date}><span className={`status-dot dot-${record.status}`} /><span><strong>{formatDate(record.date)}</strong><small>{record.status[0].toUpperCase() + record.status.slice(1)} · {child.className}</small></span></div>) : <div className="empty-state">{translateText('No attendance history has been recorded for this child on this device.')}</div>}</section> : <><div className="parent-attendance-card"><div className={`parent-status-icon ${todayStatus === 'absent' ? 'parent-absent' : ''}`}>{todayStatus === 'absent' ? <X size={24} /> : todayStatus === null ? <CalendarDays size={22} /> : <Check size={24} />}</div><span>{translateText('Today')} · {formatDate(today)}</span><h2>{translateText(todayStatus === 'absent' ? 'Marked absent' : todayStatus === 'late' ? 'Arrived late' : todayStatus === 'excused' ? 'Excused absence' : todayStatus === null ? 'Not recorded' : 'Present at school')}</h2><p>{translateText('Daily status recorded by the class teacher.')}</p><div className="parent-progress"><span style={{ width: `${childRate ?? 0}%` }} /></div><div className="parent-progress-caption"><span>{translateText('Recorded attendance')}</span><strong>{childRate === null ? '—' : `${childRate}%`}</strong></div></div><div className="calendar-preview surface"><div className="section-heading"><div><p className="section-kicker">{monthLabel} · {child.name.toUpperCase()}</p><h2>{translateText('Attendance calendar')}</h2></div><button className="quiet-link" onClick={() => onNavigate('History')}>{translateText('Full history')} <ChevronRight size={15} /></button></div><div className="calendar-days">{weekDays.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div><div className="calendar-dates">{Array.from({ length: calendarCellCount }, (_, index) => { const day = index - monthOffset + 1; const validDay = day > 0 && day <= daysInMonth; const date = validDay ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : ''; const status = childRecords.find((record) => record.date === date)?.status; const weekday = validDay && new Date(year, month, day).getDay() !== 0 && new Date(year, month, day).getDay() !== 6; return <span key={index} className={status ? `calendar-${status}` : validDay && weekday ? (demoMode ? 'calendar-present' : 'calendar-unrecorded') : validDay ? 'calendar-no-school' : ''}>{validDay ? day : ''}</span> })}</div><div className="calendar-legend"><span><i className="dot-present" />{translateText('Present')}</span><span><i className="dot-absent" />{translateText('Absent')}</span><span><i className="calendar-unrecorded" />{translateText('No record')}</span><span><i className="calendar-no-school" />{translateText('No school')}</span></div></div><div className="parent-quick-links"><button onClick={() => onNavigate('Notifications')}><Bell size={19} /><span><strong>{translateText('Absence notifications')}</strong><small>{translateText('Manage school updates')}</small></span><ChevronRight size={17} /></button><button onClick={() => onNavigate('Settings')}><Settings2 size={19} /><span><strong>{translateText('Language & preferences')}</strong><small>{translateText('English · change settings')}</small></span><ChevronRight size={17} /></button></div></>}
    <p className="demo-disclaimer">{translateText('Only linked children appear here. Sample attendance defaults are illustrative; records are stored on this device.')}</p></section>
}

function HistoryPage({ audit, students, onExport }) {
  return <><section className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" />{translateText('REVIEW & AUDIT')}</p><h1>{translateText('Attendance history')}</h1><p className="heading-subtitle">{translateText('Submitted registers and corrections recorded on this device.')}</p></div><button className="secondary-button" onClick={onExport}><Download size={16} />{translateText('Export CSV')}</button></section><section className="surface timeline-panel"><div className="section-heading"><div><p className="section-kicker">{translateText('RECENT ACTIVITY')}</p><h2>{translateText('Register changes')}</h2></div><span className="tag">{audit.length} {translateText('EVENTS')}</span></div>{audit.length ? audit.map((entry) => <div className="timeline-row" key={entry.id}><span className="timeline-icon"><ClipboardCheck size={17} /></span><span><strong>{entry.action}</strong><small>{entry.detail}</small></span><time>{entry.date}</time></div>) : <div className="empty-state">{translateText('No attendance submissions yet. Submitted registers and corrections will appear here.')}</div>}</section><p className="demo-disclaimer">{translateText('Current learner directory:')} {students.length} {translateText('students')} · {translateText('Events are stored locally and can be cleared from browser storage.')}</p></>
}

function NotificationsPage({ role }) {
  const notificationSeed = [['Attendance submitted', 'Class V - A register was submitted for today.', 'Today · 9:18 am', 'approved'], ['Low attendance follow-up', 'A learner has attendance below the 75% review threshold.', 'Yesterday · 3:40 pm', 'pending'], ['School calendar updated', 'The October school calendar is available for families.', '12 Oct · 11:05 am', 'info']]
  const [read, setRead] = useState(() => readStore('ruralattend-demo-notification-read', []))
  const markOne = (title) => {
    const next = [...new Set([...read, title])]
    setRead(next)
    writeStore('ruralattend-demo-notification-read', next)
  }
  const markAll = () => {
    const next = notificationSeed.map(([title]) => title)
    setRead(next)
    writeStore('ruralattend-demo-notification-read', next)
  }
  return <><section className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" />{translateText('INBOX · DEMO NOTIFICATIONS')}</p><h1>{translateText(role === 'Parent' ? 'School messages' : 'Notifications & alerts')}</h1><p className="heading-subtitle">{translateText('Illustrative updates for this evaluation account.')}</p></div><button className="secondary-button" onClick={markAll}><CheckCheck size={16} />{translateText('Mark all read')}</button></section><section className="surface notification-list">{notificationSeed.map(([title, text, time, state]) => { const isRead = read.includes(title); return <article className={`notification-row ${isRead ? 'notification-read' : ''}`} key={title}><span className={`notification-mark mark-${state}`}><Bell size={16} /></span><div><strong>{translateText(title)}</strong><p>{translateText(text)}</p><time>{translateText(time)}</time></div><span className={`status-badge ${isRead ? '' : state === 'approved' ? 'badge-approved' : 'badge-pending'}`}>{translateText(isRead ? 'Read' : state === 'approved' ? 'Approved' : state === 'pending' ? 'Needs review' : 'Unread')}</span>{!isRead && <button className="secondary-button" onClick={() => markOne(title)}>{translateText('Mark read')}</button>}</article> })}</section></>
}
function AccountsPage({ onNotice }) { return <><section className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" />{translateText('ACCESS MANAGEMENT · DEMO')}</p><h1>{translateText('User accounts')}</h1><p className="heading-subtitle">{translateText('Sample roles and access levels for this school.')}</p></div><button className="primary-button" onClick={() => onNotice(translateText('Invitations require the authenticated server workspace; demo accounts are illustrative only.'))}><Plus size={16} />{translateText('Invite user')}</button></section><section className="surface directory-panel"><div className="table-scroll"><table><thead><tr><th>{translateText('USER')}</th><th>{translateText('ROLE')}</th><th>{translateText('STATUS')}</th><th>{translateText('LAST ACTIVE')}</th></tr></thead><tbody>{[['Sita Kumari', 'Teacher', 'Active', 'Today'], ['Anil Verma', 'Principal', 'Active', 'Today'], ['Maya Singh', 'School Admin', 'Active', 'Yesterday'], ['Ravi Sharma', 'Parent', 'Active', 'Today']].map(([name, role, status, active]) => <tr key={name}><td><div className="table-person"><span className="table-avatar">{initials(name)}</span><strong>{name}</strong></div></td><td>{translateText(role)}</td><td><span className="status-badge badge-approved">{translateText(status)}</span></td><td>{translateText(active)}</td></tr>)}</tbody></table></div></section><p className="demo-disclaimer">{translateText('Account management is illustrative only. This frontend demo has no authentication server or real user provisioning.')}</p></> }
function DevicesPage({ online, audit }) { return <><section className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" />{translateText('DEVICE & SYNC MONITOR')}</p><h1>{translateText('Device status')}</h1><p className="heading-subtitle">{translateText('Local storage and connectivity for this browser.')}</p></div><span className={`status-badge ${online ? 'badge-approved' : 'badge-pending'}`}>{translateText(online ? 'Online' : 'Offline')}</span></section><div className="settings-panel surface"><SettingsRow icon={Cloud} title="This browser" description="Attendance drafts are stored in local browser storage." state={online ? 'CONNECTED' : 'OFFLINE'} /><SettingsRow icon={ClipboardCheck} title="Pending sync queue" description="No remote service is configured in this demo build." state={`${audit.length} LOCAL EVENTS`} /><SettingsRow icon={ShieldCheck} title="Service status" description="PWA installation and server sync are not configured." state="DEMO MODE" /></div></> }
function AuditPage({ audit }) { return <><section className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" />{translateText('ADMINISTRATION · AUDIT TRAIL')}</p><h1>{translateText('Audit log')}</h1><p className="heading-subtitle">{translateText('Attendance submissions and corrections made in this demo.')}</p></div></section><section className="surface timeline-panel">{audit.length ? audit.map((entry) => <div className="timeline-row" key={entry.id}><span className="timeline-icon"><ShieldCheck size={17} /></span><span><strong>{translateText(entry.action)}</strong><small>{translateText(entry.detail)}</small></span><time>{entry.date}</time></div>) : <div className="empty-state">{translateText('No events recorded yet.')}</div>}</section></> }
function SettingsPage({ role, language, setLanguage, demoMode }) {
  const [preferences, setPreferences] = useState(() => readStore('ruralattend-notification-preferences', { absence: true, attendance: true, school_updates: true }))
  const [preferenceError, setPreferenceError] = useState('')
  useEffect(() => {
    if (demoMode) return
    let active = true
    api.getNotificationPreferences().then(({ preferences: saved }) => { if (active) setPreferences(saved) }).catch((error) => { if (active) setPreferenceError(error.message) })
    return () => { active = false }
  }, [demoMode])
  const updatePreference = async (key, checked) => {
    const previous = preferences[key]
    const next = { ...preferences, [key]: checked }
    setPreferences(next)
    setPreferenceError('')
    if (demoMode) {
      writeStore('ruralattend-notification-preferences', next)
      return
    }
    try { await api.updateNotificationPreferences({ [key]: checked }) }
    catch (error) { setPreferences((current) => ({ ...current, [key]: previous })); setPreferenceError(`Could not save preference: ${error.message}`) }
  }
  return <><section className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" />{translateText('PROFILE & PREFERENCES')}</p><h1>{translateText('Settings')}</h1><p className="heading-subtitle">{translateText('Personal preferences for the')} {translateText(role.toLowerCase())} {translateText('workspace.')}</p></div></section>{!demoMode && ['School Admin', 'Principal'].includes(role) && <AcademicYearsPanel canManage={role === 'School Admin'} />}<div className="settings-panel surface"><SettingsRow icon={GraduationCap} title={translateText('School / account')} description={demoMode ? 'Nandipur Primary · Sitamarhi, Bihar' : translateText('Account scope is enforced by the server.')} state={role.toUpperCase()} /><div className="settings-row"><span className="settings-icon"><Activity size={19} /></span><div><strong>{translateText('Language preference')}</strong><span>{translateText('Save English or Hindi as your preferred language.')}</span></div><select className="settings-select" value={language} onChange={(event) => setLanguage(event.target.value)}><option>English</option><option>Hindi</option></select></div><SettingsRow icon={Cloud} title={translateText('Offline attendance')} description={translateText('Drafts stay on this device until the server confirms synchronization.')} state="INDEXEDDB" />{[['absence', 'Absence alerts', 'Notify me when a linked learner is marked absent.'], ['attendance', 'Attendance updates', 'Notify me when attendance is submitted or changed.'], ['school_updates', 'School updates', 'Receive in-app messages from the school.']].map(([key, title, description]) => <label className="settings-row preference-row" key={key}><span className="settings-icon"><Bell size={19} /></span><span className="preference-copy"><strong>{translateText(title)}</strong><small>{translateText(description)}</small></span><input type="checkbox" checked={Boolean(preferences[key])} onChange={(event) => void updatePreference(key, event.target.checked)} /></label>)}</div>{preferenceError && <p className="report-error" role="alert">{preferenceError}</p>}<p className="demo-disclaimer">{translateText(demoMode ? 'Demo preferences are saved locally; attendance sync is disabled.' : 'Notification delivery is in-app only. SMS/email providers require separate configuration.')}</p></>
}
function SettingsRow({ icon: Icon, title, description, state }) { return <div className="settings-row"><span className="settings-icon"><Icon size={19} /></span><div><strong>{translateText(title)}</strong><span>{translateText(description)}</span></div><span className="settings-state">{translateText(state)}</span></div> }
function HelpPage() {
  const items = [
    ['1', 'Choose a role', 'Use the role selector in the top bar to explore teacher, principal, admin, department and parent experiences.'],
    ['2', 'Take attendance', 'Select a class and date, search learners, mark each status, then review and confirm submission. Drafts save on this browser.'],
    ['3', 'Review reports', 'Use report filters, download a generated PDF, or export a CSV.'],
    ['4', 'Understand demo limits', 'All records are illustrative. Authentication, server APIs, PostgreSQL and cross-device synchronization are not configured in demo mode. Production QR codes must be issued by the school.'],
  ]
  return <><section className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" />{translateText('HELP & GUIDANCE')}</p><h1>{translateText('Using RuralAttend')}</h1><p className="heading-subtitle">{translateText('A short guide to this project evaluation build.')}</p></div></section><div className="help-list">{items.map(([num, title, text]) => <article className="help-row" key={num}><span>{num}</span><div><strong>{translateText(title)}</strong><p>{translateText(text)}</p></div></article>)}</div></>
}
function NotFound({ onNavigate }) { return <div className="not-found"><span>404</span><h1>{translateText('Page not found')}</h1><p>{translateText('This page is not part of the current demo workspace.')}</p><button className="primary-button" onClick={onNavigate}>{translateText('Back to dashboard')}</button></div> }

function Dialog({ type, form, setForm, classes, demoMode, selectedClass, isCorrection, onClose, onSubmit, onSave, onNotice, onQrToken }) {
  const [qrCode, setQrCode] = useState('')
  const isEntity = ['student', 'teacher', 'class'].includes(type)
  const entityLabel = translateText(({ student: 'Student', teacher: 'Teacher', class: 'Class' })[type] ?? type)
  const title = type === 'confirm' ? translateText(isCorrection ? 'Review attendance correction' : 'Review attendance submission') : type === 'qr' ? translateText('QR attendance workflow') : `${translateText(form.id ? 'Edit' : 'Add')} ${entityLabel}`
  if (!demoMode && isEntity) return <ProductionEntityDialog type={type} form={form} classes={classes} onClose={onClose} onSave={onSave} onNotice={onNotice} />
  const handleSave = () => {
    if (type === 'student' && (!form.name || !form.className)) return onNotice(translateText('Enter a student name and select a class.'))
    if (type === 'teacher' && (!form.name || !form.subject)) return onNotice(translateText('Enter a staff name and teaching assignment.'))
    if (type === 'class' && !form.name) return onNotice(translateText('Enter a class name.'))
    onSave()
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="modal-heading"><div><p className="section-kicker">RURALATTEND · DEMO</p><h2 id="dialog-title">{title}</h2></div><button className="icon-button" onClick={onClose} aria-label={translateText('Close dialog')}><X size={18} /></button></div>
    {type === 'confirm' && <><p className="modal-copy">{translateText(isCorrection ? 'Submit your changes to' : 'Submit')} <strong>{selectedClass}</strong> {translateText('attendance? This will save a local record and add a timestamped audit entry.')}</p><div className="confirmation-note"><ShieldCheck size={17} />{translateText('Changes can be corrected later; all demo data stays in this browser.')}</div><div className="modal-actions"><button className="secondary-button" onClick={onClose}>{translateText('Go back')}</button><button className="primary-button" onClick={onSubmit}><CheckCheck size={16} />{translateText(isCorrection ? 'Confirm correction' : 'Confirm submission')}</button></div></>}
    {type === 'qr' && <><p className="modal-copy">{translateText('Scan a school-issued signed learner code. Camera access requires permission; the manual field remains available on any device.')}</p><Suspense fallback={<div className="empty-state">{translateText('Loading camera scanner…')}</div>}><QrScanner onDecode={onQrToken} /></Suspense><label className="form-label">{translateText('Enter token manually')}<input value={qrCode} onChange={(event) => setQrCode(event.target.value)} placeholder={translateText(demoMode ? 'Example: ST-104' : 'Paste the signed attendance QR token')} /></label><div className="modal-actions"><button className="secondary-button" onClick={onClose}>{translateText('Cancel')}</button><button className="primary-button" disabled={!qrCode.trim()} onClick={() => { const token = qrCode.trim(); if (demoMode && !/^ST-\d+$/.test(token)) return onNotice(translateText('Enter a valid demo student token such as ST-104.')); void onQrToken(token) }}><QrCode size={16} />{translateText('Verify & mark present')}</button></div></>}
    {isEntity && <><label className="form-label">{translateText('Name')}<input value={form.name ?? ''} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={translateText(type === 'class' ? 'Class VI - A' : 'Full name')} /></label>{type === 'student' && <><label className="form-label">{translateText('Student ID')}<input value={form.id ?? ''} onChange={(event) => setForm({ ...form, id: event.target.value })} placeholder={translateText('Auto-generated if blank')} /></label><label className="form-label">{translateText('Class')}<select value={form.className ?? 'Class V - A'} onChange={(event) => setForm({ ...form, className: event.target.value })}>{['Class V - A', 'Class V - B', 'Class IV - A'].map((name) => <option key={name}>{name}</option>)}</select></label><label className="form-label">{translateText('Guardian')}<input value={form.guardian ?? ''} onChange={(event) => setForm({ ...form, guardian: event.target.value })} placeholder={translateText('Guardian name')} /></label></>}{type === 'teacher' && <><label className="form-label">{translateText('Staff ID')}<input value={form.id ?? ''} onChange={(event) => setForm({ ...form, id: event.target.value })} placeholder={translateText('Auto-generated if blank')} /></label><label className="form-label">{translateText('Assignment')}<input value={form.subject ?? ''} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder={translateText('Subject or class')} /></label><label className="form-label">{translateText('Contact')}<input value={form.phone ?? ''} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder={translateText('Phone number')} /></label></>}{type === 'class' && <><label className="form-label">{translateText('Class ID')}<input value={form.id ?? ''} onChange={(event) => setForm({ ...form, id: event.target.value })} placeholder={translateText('Auto-generated if blank')} /></label><label className="form-label">{translateText('Class teacher')}<input value={form.teacher ?? ''} onChange={(event) => setForm({ ...form, teacher: event.target.value })} placeholder={translateText('Teacher name')} /></label><label className="form-label">{translateText('Learner count')}<input type="number" min="0" value={form.students ?? 0} onChange={(event) => setForm({ ...form, students: Number(event.target.value) })} /></label></>}<div className="modal-actions"><button className="secondary-button" onClick={onClose}>{translateText('Cancel')}</button><button className="primary-button" onClick={handleSave}><Check size={16} />{translateText('Save')} {entityLabel}</button></div></>}
    </section></div>
}

export default App
