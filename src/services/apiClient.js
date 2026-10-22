const API_BASE = import.meta.env?.VITE_API_BASE_URL ?? '/api'

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

async function request(path, { method = 'GET', body, idempotencyKey, signal } = {}) {
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    })
  } catch (error) {
    throw new ApiError(0, 'network_error', error instanceof Error ? error.message : 'The server could not be reached.')
  }

  if (response.status === 204) return null
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/forgot')) {
      window.dispatchEvent(new CustomEvent('ruralattend:session-expired'))
    }
    throw new ApiError(response.status, payload.code ?? 'request_error', payload.error ?? 'The request failed.', payload.details)
  }
  return payload
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request('/auth/logout', { method: 'POST', body: {} }),
  getSession: () => request('/auth/me'),
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (token, password) => request('/auth/reset-password', { method: 'POST', body: { token, password } }),
  getClasses: () => request('/classes'),
  getAcademicYears: () => request('/classes/academic-years'),
  createAcademicYear: (data) => request('/classes/academic-years', { method: 'POST', body: data }),
  updateAcademicYear: (yearId, data) => request(`/classes/academic-years/${encodeURIComponent(yearId)}`, { method: 'PATCH', body: data }),
  archiveAcademicYear: (yearId) => request(`/classes/academic-years/${encodeURIComponent(yearId)}`, { method: 'DELETE' }),
  getClass: (classId) => request(`/classes/${encodeURIComponent(classId)}`),
  createClass: (data) => request('/classes', { method: 'POST', body: data }),
  updateClass: (classId, data) => request(`/classes/${encodeURIComponent(classId)}`, { method: 'PATCH', body: data }),
  deleteClass: (classId) => request(`/classes/${encodeURIComponent(classId)}`, { method: 'DELETE' }),
  assignTeacherToClass: (classId, teacherId, dates = {}) => request(`/classes/${encodeURIComponent(classId)}/assignments`, { method: 'POST', body: { teacherId, ...dates } }),
  updateTeacherAssignment: (classId, teacherId, startsOn, endsOn) => request(`/classes/${encodeURIComponent(classId)}/assignments/${encodeURIComponent(teacherId)}/${encodeURIComponent(startsOn)}`, { method: 'PATCH', body: { endsOn } }),
  getStudents: (params = {}) => request(`/students?${new URLSearchParams(params)}`),
  createStudent: (data) => request('/students', { method: 'POST', body: data }),
  updateStudent: (studentId, data) => request(`/students/${encodeURIComponent(studentId)}`, { method: 'PATCH', body: data }),
  deleteStudent: (studentId) => request(`/students/${encodeURIComponent(studentId)}`, { method: 'DELETE' }),
  getTeachers: (params = {}) => request(`/teachers?${new URLSearchParams(params)}`),
  updateTeacher: (teacherId, data) => request(`/teachers/${encodeURIComponent(teacherId)}`, { method: 'PATCH', body: data }),
  archiveTeacher: (teacherId) => request(`/teachers/${encodeURIComponent(teacherId)}`, { method: 'DELETE' }),
  getUsers: () => request('/users'),
  updateParentAccountStatus: (userId, active) => request(`/users/${encodeURIComponent(userId)}/status`, { method: 'PATCH', body: { active } }),
  updateProfilePreferences: (preferences) => request('/users/me/preferences', { method: 'PATCH', body: preferences }),
  inviteUser: (data) => request('/users', { method: 'POST', body: data }),
  getParentChildren: (parentUserId) => request(`/users/${encodeURIComponent(parentUserId)}/children`),
  linkParentChildren: (parentUserId, studentIds) => request(`/users/${encodeURIComponent(parentUserId)}/children`, { method: 'POST', body: { studentIds } }),
  unlinkParentChild: (parentUserId, studentId) => request(`/users/${encodeURIComponent(parentUserId)}/children/${encodeURIComponent(studentId)}`, { method: 'DELETE' }),
  getReports: (params = {}, signal) => request(`/reports/attendance?${new URLSearchParams(params)}`, { signal }),
  getNotifications: (params = {}) => request(`/notifications?${new URLSearchParams(params)}`),
  getAuditLog: (params = {}, signal) => request(`/audit?${new URLSearchParams(params)}`, { signal }),
  getDevices: () => request('/devices'),
  registerDevice: (deviceLabel) => request('/devices/register', { method: 'POST', body: { deviceLabel } }),
  revokeDevice: (deviceId) => request(`/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' }),
  markNotificationRead: (id) => request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH', body: {} }),
  markAllNotificationsRead: () => request('/notifications/read-all', { method: 'PATCH', body: {} }),
  getNotificationPreferences: () => request('/notifications/preferences'),
  updateNotificationPreferences: (preferences) => request('/notifications/preferences', { method: 'PATCH', body: preferences }),
  getSchools: (params = {}) => request(`/schools?${new URLSearchParams(params)}`),
  getSchool: (schoolId) => request(`/schools/${encodeURIComponent(schoolId)}`),
  updateSchool: (schoolId, data) => request(`/schools/${encodeURIComponent(schoolId)}`, { method: 'PATCH', body: data }),
  updateSchoolVerification: (schoolId, status) => request(`/schools/${encodeURIComponent(schoolId)}/verification`, { method: 'PATCH', body: { status } }),
  getChildren: () => request('/parents/me/children'),
  getChildAttendance: (studentId) => request(`/parents/me/children/${encodeURIComponent(studentId)}/attendance`),
  updateParentPreferences: (preferences) => request('/parents/me/preferences', { method: 'PATCH', body: preferences }),
  syncAttendance: (idempotencyKey, payload) => request('/attendance/sync', { method: 'POST', idempotencyKey, body: payload }),
  getAttendance: (params = {}) => request(`/attendance?${new URLSearchParams(params)}`),
  getAttendanceSession: (sessionId) => request(`/attendance/${encodeURIComponent(sessionId)}`),
  createAttendanceQrToken: (studentId) => request('/attendance/qr-token', { method: 'POST', body: { studentId } }),
  verifyAttendanceQrToken: (token) => request('/attendance/qr/verify', { method: 'POST', body: { token } }),
}
