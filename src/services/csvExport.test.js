import assert from 'node:assert/strict'
import test from 'node:test'
import { createCsvContent } from './csvExport.js'

test('CSV export quotes values and neutralizes spreadsheet formulas', () => {
  const csv = createCsvContent([{ name: '=HYPERLINK("https://bad.example")', note: 'a,b' }], [['name', 'Student'], ['note', 'Note']])
  assert.equal(csv, '"Student","Note"\r\n"\'=HYPERLINK(""https://bad.example"")","a,b"')
})

test('CSV export preserves empty values as empty quoted cells', () => {
  assert.equal(createCsvContent([{ value: null }], [['value', 'Value']]), '"Value"\r\n""')
})
