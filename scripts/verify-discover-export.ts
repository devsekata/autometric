/**
 * Builds a Discover Excel export offline and writes it where a spreadsheet
 * reader can check it.
 *
 *   npm run verify:export [-- <out.xlsx>]     (default: the OS temp folder)
 *
 * The rows exercise what an export has to survive: accents and emoji, XML
 * metacharacters, a caption starting with "=", control characters, numbers
 * that must stay numbers, and empty cells that must stay empty (not 0).
 * Nothing touches a database.
 */
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildXlsx, type ExportColumn } from '../src/components/discover/exportData'

interface Row { name: string; followers: number | null; er: number | null; note: string }

const rows: Row[] = [
  { name: 'Raisa Andriana', followers: 4007007, er: 0.98, note: 'Café & "kopi" <b>' },
  { name: '=HYPERLINK("x")', followers: null, er: 2.29, note: 'line\u0001break\u0008' },
  { name: 'Iben 🌙', followers: 0, er: null, note: '' },
]
const cols: ExportColumn<Row>[] = [
  { key: 'name', header: 'Username', value: r => r.name },
  { key: 'followers', header: 'Followers', value: r => r.followers ?? '' },
  { key: 'er', header: 'Engagement rate (%)', value: r => r.er ?? '' },
  { key: 'note', header: 'Note', value: r => r.note },
]

const out = process.argv[2] ?? join(tmpdir(), 'discover-export-check.xlsx')
const bytes = buildXlsx(rows, cols)
writeFileSync(out, bytes)
console.log(`wrote ${bytes.length} bytes to ${out}`)
