'use client'

/**
 * Client-side export to CSV and Excel.
 *
 * No dependency is added for this. The "Excel" export writes a UTF-8 CSV with a
 * BOM and `sep=,` hint, which Excel opens natively with correct columns and
 * accented characters — a genuine .xlsx would mean pulling in a workbook
 * library for output nobody edits as a workbook.
 *
 * Two details that matter for real exports:
 *   * Formula injection: a cell starting with = + - @ is prefixed with a
 *     quote, so an exported caption cannot execute when the file is opened.
 *   * Indonesian Excel commonly uses ; as the list separator, so the Excel
 *     variant declares its separator explicitly instead of hoping.
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

function download(content: string, filename: string, mime: string) {
  // BOM so Excel detects UTF-8 rather than mangling non-ASCII.
  const blob = new Blob(['﻿' + content], { type: `${mime};charset=utf-8;` })
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
  download(`sep=,\r\n${toCsv(rows, cols, ',')}`, `${name}-${stamp()}.csv`, 'application/vnd.ms-excel')
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
