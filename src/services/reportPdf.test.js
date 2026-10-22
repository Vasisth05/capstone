import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createReportPdf } from './reportPdf.js'

test('report PDF contains a generated PDF document with report content', () => {
  const bytes = createReportPdf({
    title: 'Attendance report',
    subtitle: '01 Oct 2026 to 19 Oct 2026',
    summary: ['Attendance 92%', 'Recorded 48'],
    columns: [{ label: 'Class', key: 'className' }, { label: 'Attendance', key: 'rate' }],
    rows: [{ className: 'Class V A', rate: '92%' }],
    generatedAt: new Date('2026-10-19T09:00:00Z'),
  })
  const signature = new TextDecoder().decode(bytes.slice(0, 8))
  assert.equal(signature.slice(0, 5), '%PDF-')
  assert.ok(bytes.byteLength > 1000)
})

test('report PDF renders empty reports with headers and no records', () => {
  const bytes = createReportPdf({ title: 'Attendance report', subtitle: 'No records', columns: [{ label: 'Class', key: 'className' }], rows: [] })
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-')
})

test('report PDF embeds the Devanagari font for Hindi content', async () => {
  const fontBase64 = (await readFile(new URL('../../public/fonts/NotoSansDevanagari-Regular.ttf', import.meta.url))).toString('base64')
  const bytes = createReportPdf({
    title: 'उपस्थिति रिपोर्ट', subtitle: 'अधिकृत रिकॉर्ड', summary: ['दर्ज: 12'],
    columns: [{ label: 'विद्यार्थी', key: 'student' }, { label: 'स्थिति', key: 'status' }],
    rows: [{ student: 'आरव शर्मा', status: 'उपस्थित' }], fontBase64,
  })
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-')
  assert.ok(new TextDecoder('latin1').decode(bytes).includes('NotoHindi'))
  assert.ok(bytes.byteLength > 10_000)
})
