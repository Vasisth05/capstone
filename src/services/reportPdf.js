import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

const hasDevanagari = (value) => /[\u0900-\u097f]/.test(String(value ?? ''))

export function createReportPdf({ title, subtitle, summary = [], columns, rows, generatedAt = new Date(), fontBase64 }) {
  const document = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  if (fontBase64) {
    document.addFileToVFS('NotoSansDevanagari-Regular.ttf', fontBase64)
    document.addFont('NotoSansDevanagari-Regular.ttf', 'NotoHindi', 'normal')
    document.addFont('NotoSansDevanagari-Regular.ttf', 'NotoHindi', 'bold')
  }
  const fontFor = (value) => fontBase64 && hasDevanagari(value) ? 'NotoHindi' : 'helvetica'
  const pageWidth = document.internal.pageSize.getWidth()
  document.setFont(fontFor(title), fontFor(title) === 'NotoHindi' ? 'normal' : 'bold')
  document.setFontSize(18)
  document.setTextColor(30, 68, 76)
  document.text(title, 14, 17)
  document.setFont(fontFor(subtitle), 'normal')
  document.setFontSize(9)
  document.setTextColor(95, 112, 119)
  document.text(subtitle, 14, 24)
  document.text(`Generated ${generatedAt.toLocaleString('en-IN')}`, pageWidth - 14, 17, { align: 'right' })

  if (summary.length) {
    document.setFont(fontFor(summary.join(' ')), 'normal')
    document.setFontSize(9)
    document.setTextColor(45, 91, 73)
    document.text(summary.join('    ·    '), 14, 32)
  }

  autoTable(document, {
    startY: summary.length ? 38 : 32,
    head: [columns.map((column) => column.label)],
    body: rows.map((row) => columns.map((column) => String(row[column.key] ?? '—'))),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.2, textColor: [54, 75, 83], lineColor: [224, 232, 231] },
    headStyles: { fillColor: [31, 75, 67], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 249, 248] },
    margin: { left: 14, right: 14, bottom: 16 },
    didDrawPage: () => {
      const pageNumber = document.internal.getNumberOfPages()
      document.setFont('helvetica', 'normal')
      document.setFontSize(8)
      document.setTextColor(110, 124, 128)
      document.text(`RuralAttend  ·  Page ${pageNumber}`, pageWidth - 14, document.internal.pageSize.getHeight() - 7, { align: 'right' })
    },
    didParseCell: (cell) => {
      const content = cell.cell.text.join(' ')
      if (fontFor(content) === 'NotoHindi') {
        cell.cell.styles.font = 'NotoHindi'
        cell.cell.styles.fontStyle = 'normal'
      }
    },
  })
  return document.output('arraybuffer')
}

async function createHindiReportPdf({ title, subtitle, summary = [], columns, rows, generatedAt = new Date() }) {
  await document.fonts.load('400 12px "Noto Sans Devanagari"')
  await document.fonts.load('700 12px "Noto Sans Devanagari"')
  const { default: html2canvas } = await import('html2canvas')
  const pageWidthPx = 1120
  const rowsPerPage = 10
  const chunks = rows.length ? Array.from({ length: Math.ceil(rows.length / rowsPerPage) }, (_, index) => rows.slice(index * rowsPerPage, (index + 1) * rowsPerPage)) : [[]]
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  const pdfWidth = pdf.internal.pageSize.getWidth()
  const pdfHeight = pdf.internal.pageSize.getHeight()

  for (let pageIndex = 0; pageIndex < chunks.length; pageIndex += 1) {
    const page = document.createElement('article')
    page.className = 'rural-pdf-canvas-page'
    page.lang = 'hi'
    page.dir = 'ltr'
    page.style.cssText = `position:fixed;left:0;top:0;z-index:2147483647;opacity:.01;pointer-events:none;width:${pageWidthPx}px;height:792px;box-sizing:border-box;padding:30px 38px 24px;background:#fff;color:#263f4d;font-family:'Noto Sans Devanagari',sans-serif;display:flex;flex-direction:column;gap:12px;`
    const heading = document.createElement('header')
    heading.style.cssText = 'border-bottom:2px solid #315f51;padding-bottom:10px;'
    const brand = makePdfElement('div', 'RuralAttend · ग्रामीण विद्यालय उपस्थिति', 'font-size:12px;color:#43816d;font-weight:700;margin-bottom:7px;')
    const titleElement = makePdfElement('h1', title, 'font-size:23px;line-height:1.3;color:#1e444c;margin:0 0 4px;font-weight:700;')
    const subtitleElement = makePdfElement('p', subtitle, 'font-size:11px;color:#5f7077;margin:0;')
    heading.append(brand, titleElement, subtitleElement)
    page.append(heading)

    const summaryElement = document.createElement('div')
    summaryElement.style.cssText = 'display:flex;gap:18px;flex-wrap:wrap;font-size:11px;color:#2d5b49;min-height:24px;'
    for (const item of summary) summaryElement.append(makePdfElement('span', item, 'font-weight:600;'))
    const generated = makePdfElement('div', `तैयार किया गया: ${generatedAt.toLocaleString('hi-IN')}`, 'font-size:9px;color:#6e7c80;margin-left:auto;')
    summaryElement.append(generated)
    page.append(summaryElement)

    const table = document.createElement('table')
    table.style.cssText = 'width:100%;border-collapse:collapse;table-layout:fixed;font-size:9px;line-height:1.35;'
    const thead = document.createElement('thead')
    const headRow = document.createElement('tr')
    for (const column of columns) {
      const cell = makePdfElement('th', column.label, 'padding:8px 5px;background:#1f4b43;color:#fff;border:1px solid #dfe8e5;text-align:left;font-weight:700;overflow-wrap:anywhere;')
      headRow.append(cell)
    }
    thead.append(headRow)
    table.append(thead)
    const tbody = document.createElement('tbody')
    if (!chunks[pageIndex].length) {
      const row = document.createElement('tr')
      const cell = makePdfElement('td', 'कोई रिकॉर्ड उपलब्ध नहीं है।', 'padding:12px 6px;border:1px solid #e0e8e7;text-align:center;color:#5f7077;')
      cell.colSpan = Math.max(1, columns.length)
      row.append(cell)
      tbody.append(row)
    }
    for (const [rowIndex, data] of chunks[pageIndex].entries()) {
      const row = document.createElement('tr')
      columns.forEach((column, columnIndex) => {
        let value = data[column.key]
        if (column.key === 'attendance_percent' && value !== null && value !== undefined) value = `${value}%`
        if (['report_date', 'report_month'].includes(column.key) && value) value = new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('hi-IN', { day: 'numeric', month: 'short', year: 'numeric' })
        const background = rowIndex % 2 ? '#f6f9f8' : '#fff'
        row.append(makePdfElement('td', String(value ?? '—'), `padding:7px 5px;background:${background};border:1px solid #e0e8e7;color:#364b53;overflow-wrap:anywhere;${columnIndex === 0 ? 'font-weight:600;' : ''}`))
      })
      tbody.append(row)
    }
    table.append(tbody)
    page.append(table)
    page.append(makePdfElement('footer', `RuralAttend · पृष्ठ ${pageIndex + 1} / ${chunks.length}`, 'margin-top:auto;text-align:right;font-size:9px;color:#6e7c80;padding-top:8px;'))
    document.body.append(page)
    try {
      const canvas = await html2canvas(page, {
        scale: 2, backgroundColor: '#ffffff', logging: false, windowWidth: pageWidthPx, windowHeight: 792,
        onclone: (clonedDocument) => {
          const clonedPage = clonedDocument.querySelector('.rural-pdf-canvas-page')
          if (clonedPage) clonedPage.style.opacity = '1'
        },
      })
      if (pageIndex) pdf.addPage()
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST')
    } finally { page.remove() }
  }
  return pdf.output('arraybuffer')
}

function makePdfElement(tagName, text, style, extraStyle = '') {
  const element = document.createElement(tagName)
  element.textContent = text
  element.style.cssText = `${style}${extraStyle}`
  return element
}

export async function downloadReportPdf(options, filename) {
  const language = options.language ?? (() => {
    try { return JSON.parse(localStorage.getItem('ruralattend-language') ?? '"English"') } catch { return 'English' }
  })()
  let bytes
  if (language === 'Hindi') bytes = await createHindiReportPdf(options)
  else bytes = createReportPdf(options)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return bytes.byteLength
}
