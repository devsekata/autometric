'use client'

/**
 * Client-side export to CSV and Excel.
 *
 * No dependency is added for this. CSV is UTF-8 with a BOM. Excel is a real
 * .xlsx workbook: one sheet, inline strings, numbers as numbers, written as an
 * uncompressed ZIP by `buildXlsx` below — a workbook library would be a large
 * download for a file this simple.
 *
 * Formula injection: a CSV cell starting with = + - @ is prefixed with a
 * quote, so an exported caption cannot execute when the file is opened. The
 * .xlsx writes text as inline strings, which Excel never evaluates.
 */

export interface ExportColumn<T> {
  key: string
  header: string
  value: (row: T) => string | number | null | undefined
}

/** Neutralises spreadsheet formula injection and escapes quotes. */
function cell(raw: string | number | null | undefined): string {
  const s = raw === null || raw === undefined ? '' : String(raw)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return `"${safe.replace(/"/g, '""')}"`
}

function toCsv<T>(rows: T[], cols: ExportColumn<T>[], sep: string): string {
  const head = cols.map(c => cell(c.header)).join(sep)
  const body = rows.map(r => cols.map(c => cell(c.value(r))).join(sep))
  return [head, ...body].join('\r\n')
}

function download(content: string | Uint8Array, filename: string, mime: string) {
  // Text gets a BOM so Excel detects UTF-8 rather than mangling non-ASCII.
  const blob = typeof content === 'string'
    ? new Blob(['﻿' + content], { type: `${mime};charset=utf-8;` })
    : new Blob([content as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoke on the next tick; revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

const stamp = () => new Date().toISOString().slice(0, 10)

export function exportCsv<T>(rows: T[], cols: ExportColumn<T>[], name: string) {
  download(toCsv(rows, cols, ','), `${name}-${stamp()}.csv`, 'text/csv')
}

export function exportExcel<T>(rows: T[], cols: ExportColumn<T>[], name: string) {
  download(buildXlsx(rows, cols), `${name}-${stamp()}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
}

/* ── .xlsx writer ─────────────────────────────────────────────────────────── */

const enc = new TextEncoder()

/** XML-escapes text and drops characters XML 1.0 cannot carry. */
function xmlText(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 0 → A, 25 → Z, 26 → AA. */
function colName(i: number): string {
  let n = i + 1
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function sheetXml<T>(rows: T[], cols: ExportColumn<T>[]): string {
  const cellXml = (ref: string, v: string | number | null | undefined) => {
    if (v === null || v === undefined || v === '') return ''
    if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : ''
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(String(v))}</t></is></c>`
  }
  const line = (r: number, values: (string | number | null | undefined)[]) =>
    `<row r="${r}">${values.map((v, i) => cellXml(`${colName(i)}${r}`, v)).join('')}</row>`
  const body = [
    line(1, cols.map(c => c.header)),
    ...rows.map((row, i) => line(i + 2, cols.map(c => c.value(row)))),
  ]
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + `<sheetData>${body.join('')}</sheetData></worksheet>`
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A ZIP with every entry STOREd (no compression) — all an .xlsx needs. */
function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const now = new Date()
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint16(8, 0, true)      // stored
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, f.data.length, true)
    local.setUint32(22, f.data.length, true)
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true)
    locals.push(new Uint8Array(local.buffer), name, f.data)

    const central = new DataView(new ArrayBuffer(46))
    central.setUint32(0, 0x02014b50, true)
    central.setUint16(4, 20, true)
    central.setUint16(6, 20, true)
    central.setUint16(8, 0x0800, true)
    central.setUint16(10, 0, true)
    central.setUint16(12, time, true)
    central.setUint16(14, date, true)
    central.setUint32(16, crc, true)
    central.setUint32(20, f.data.length, true)
    central.setUint32(24, f.data.length, true)
    central.setUint16(28, name.length, true)
    central.setUint32(42, offset, true)
    centrals.push(new Uint8Array(central.buffer), name)

    offset += 30 + name.length + f.data.length
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)

  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)]
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0))
  let at = 0
  for (const b of parts) { out.set(b, at); at += b.length }
  return out
}

/** A one-sheet .xlsx workbook of `rows`. Exported for the verifier. */
export function buildXlsx<T>(rows: T[], cols: ExportColumn<T>[], sheetName = 'Creators'): Uint8Array {
  const NS = 'http://schemas.openxmlformats.org/'
  const files: [string, string][] = [
    ['[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + `<Types xmlns="${NS}package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '</Types>'],
    ['_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + `<Relationships xmlns="${NS}package/2006/relationships">`
      + `<Relationship Id="rId1" Type="${NS}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
      + '</Relationships>'],
    ['xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + `<workbook xmlns="${NS}spreadsheetml/2006/main" xmlns:r="${NS}officeDocument/2006/relationships">`
      + `<sheets><sheet name="${xmlText(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + `<Relationships xmlns="${NS}package/2006/relationships">`
      + `<Relationship Id="rId1" Type="${NS}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
      + '</Relationships>'],
    ['xl/worksheets/sheet1.xml', sheetXml(rows, cols)],
  ]
  return zipStore(files.map(([name, xml]) => ({ name, data: enc.encode(xml) })))
}

/**
 * "PDF" export via the browser's print dialog, which offers Save as PDF.
 * Honest about what it is: this opens a print view rather than generating a
 * PDF server-side, and the caller labels the button accordingly.
 */
export function exportPrintable(title: string, html: string) {
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return false
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>
      body{font-family:system-ui,"Segoe UI",Roboto,sans-serif;color:#111827;padding:28px;}
      h1{font-size:19px;margin:0 0 4px}
      .sub{font-size:12px;color:#6b7280;margin-bottom:18px}
      table{width:100%;border-collapse:collapse;font-size:11.5px}
      th{text-align:left;text-transform:uppercase;font-size:9.5px;letter-spacing:.06em;color:#9ca3af;
         border-bottom:1px solid #e5e7eb;padding:6px 8px}
      td{border-bottom:1px solid #f3f4f6;padding:6px 8px}
      .num{text-align:right;font-variant-numeric:tabular-nums}
      @media print{@page{margin:14mm}}
    </style></head><body>${html}</body></html>`)
  w.document.close()
  w.focus()
  // Give the document a tick to lay out before the dialog opens.
  setTimeout(() => w.print(), 250)
  return true
}
