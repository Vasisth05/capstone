import { inflateSync } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const input = resolve(root, 'node_modules/@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff')
const output = resolve(root, 'public/fonts/NotoSansDevanagari-Regular.ttf')
const woff = await readFile(input)
if (woff.toString('ascii', 0, 4) !== 'wOFF') throw new Error('Expected a WOFF font file.')

const flavor = woff.readUInt32BE(4)
const count = woff.readUInt16BE(12)
const tables = []
for (let index = 0; index < count; index += 1) {
  const offset = 44 + index * 20
  const tag = woff.toString('ascii', offset, offset + 4)
  const start = woff.readUInt32BE(offset + 4)
  const compressedLength = woff.readUInt32BE(offset + 8)
  const originalLength = woff.readUInt32BE(offset + 12)
  const content = woff.subarray(start, start + compressedLength)
  const data = compressedLength === originalLength ? Buffer.from(content) : inflateSync(content)
  if (data.length !== originalLength) throw new Error(`Invalid WOFF table length: ${tag}`)
  tables.push({ tag, data, checksum: checksum(data) })
}

tables.sort((left, right) => left.tag.localeCompare(right.tag))
const highestPower = 2 ** Math.floor(Math.log2(count))
const searchRange = highestPower * 16
const sfnt = Buffer.alloc(12 + count * 16)
sfnt.writeUInt32BE(flavor, 0)
sfnt.writeUInt16BE(count, 4)
sfnt.writeUInt16BE(searchRange, 6)
sfnt.writeUInt16BE(Math.log2(highestPower), 8)
sfnt.writeUInt16BE(count * 16 - searchRange, 10)

let dataOffset = sfnt.length
const chunks = [sfnt]
for (let index = 0; index < tables.length; index += 1) {
  const table = tables[index]
  const directoryOffset = 12 + index * 16
  sfnt.write(table.tag, directoryOffset, 4, 'ascii')
  sfnt.writeUInt32BE(table.checksum, directoryOffset + 4)
  sfnt.writeUInt32BE(dataOffset, directoryOffset + 8)
  sfnt.writeUInt32BE(table.data.length, directoryOffset + 12)
  chunks.push(table.data)
  const padding = (4 - (table.data.length % 4)) % 4
  if (padding) chunks.push(Buffer.alloc(padding))
  dataOffset += table.data.length + padding
}

await mkdir(dirname(output), { recursive: true })
await writeFile(output, Buffer.concat(chunks))
console.log(`Wrote ${output} (${dataOffset} bytes)`)

function checksum(data) {
  const padded = Buffer.alloc(Math.ceil(data.length / 4) * 4)
  data.copy(padded)
  let sum = 0
  for (let offset = 0; offset < padded.length; offset += 4) sum = (sum + padded.readUInt32BE(offset)) >>> 0
  return sum
}
