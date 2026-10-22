export function summarizeChildAttendance(records, today, demoMode = false) {
  const rows = Array.isArray(records) ? records : []
  const todayStatus = rows.find((record) => record.date === today)?.status ?? (demoMode ? 'present' : null)
  const attendanceRate = rows.length
    ? Math.round(rows.filter((record) => ['present', 'late'].includes(record.status)).length / rows.length * 100)
    : demoMode ? 94 : null
  return { todayStatus, attendanceRate }
}
