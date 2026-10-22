function csvCell(value) {
  let text = String(value ?? '')
  if (/^[\t\r=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export function createCsvContent(rows, fields) {
  const lines = [
    fields.map(([, label]) => label),
    ...rows.map((row) => fields.map(([key]) => row[key])),
  ]
  return lines.map((line) => line.map(csvCell).join(',')).join('\r\n')
}
