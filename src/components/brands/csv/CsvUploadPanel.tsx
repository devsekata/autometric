'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import PlatformIcon from '../PlatformIcon'
import { Platform } from '@/lib/brands/types'
import { CSV_PLATFORMS, DetectedFile, IngestResult } from '@/lib/csv/types'
import type { CategoryCatalog } from '@/lib/csv/engine'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const
const ACCEPT = '.csv,.xlsx,.xls'

/** Akun yang sudah terpasang di brand. Hanya `platform` yang benar-benar
 *  dipakai panel ini (untuk tahu platform mana yang masih butuh username);
 *  sisanya opsional supaya pemanggil tidak perlu mengarang nilai. */
export interface ExistingAccount {
  platform: Platform
  username?: string
  social_account_id?: string
  connected?: boolean
  data_source?: 'api' | 'csv'
}

/** Satu baris di grid: file + platform/kategori yang bisa dikoreksi user. */
interface Row {
  file: File
  detected: (DetectedFile & { platform_guessed?: boolean }) | null
  platform: Platform | ''
  category: string
  /** Username akun, hanya diminta untuk platform yang belum punya akun. */
  username: string
}

type Phase = 'pick' | 'detecting' | 'review' | 'sending' | 'done'

interface Props {
  brandId: string
  accounts: ExistingAccount[]
  /** Dipanggil setelah ingest sukses, supaya pemanggil bisa menyegarkan datanya. */
  onDone?: (results: IngestResult[]) => void
  onCancel?: () => void
  compact?: boolean
}

function fmtBytes(n: number | null | undefined) {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function CsvUploadPanel({
  brandId, accounts, onDone, onCancel, compact = false,
}: Props) {
  const [phase,   setPhase]   = useState<Phase>('pick')
  const [rows,    setRows]    = useState<Row[]>([])
  const [error,   setError]   = useState('')
  const [results, setResults] = useState<IngestResult[]>([])
  const [catalog, setCatalog] = useState<CategoryCatalog | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/csv/categories')
      .then(r => r.json())
      .then(j => { if (alive && j.data) setCatalog(j.data) })
      .catch(() => { /* dropdown tetap bisa dipakai dengan kategori hasil deteksi */ })
    return () => { alive = false }
  }, [])

  const accountFor = useCallback(
    (p: Platform | '') => accounts.find(a => a.platform === p) ?? null,
    [accounts],
  )

  async function handleFiles(picked: FileList | File[]) {
    const list = Array.from(picked)
    if (!list.length) return
    setError('')
    setPhase('detecting')

    const form = new FormData()
    for (const f of list) form.append('files', f)

    try {
      const res  = await fetch(`/api/brands/${brandId}/csv/preview`, { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Gagal membaca file.'); setPhase('pick'); return }

      const detected: (DetectedFile & { platform_guessed?: boolean })[] = json.data.files
      const byName = new Map(detected.map(d => [d.filename, d]))
      setRows(list.map(f => {
        const d = byName.get(f.name) ?? null
        return {
          file: f,
          detected: d,
          platform: (d?.platform as Platform) ?? '',
          category: d?.category ?? '',
          username: '',
        }
      }))
      setPhase('review')
    } catch {
      setError('Gagal menghubungi server.')
      setPhase('pick')
    }
  }

  function patch(i: number, next: Partial<Row>) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...next } : r))
  }

  // Platform yang dipakai di batch ini tapi belum punya akun di brand → username wajib.
  const missingAccountPlatforms = Array.from(new Set(
    rows.map(r => r.platform).filter((p): p is Platform => !!p && !accountFor(p))
  ))
  const usernameByPlatform = new Map<Platform, string>()
  for (const r of rows) {
    if (r.platform && r.username.trim()) usernameByPlatform.set(r.platform, r.username.trim())
  }

  const blocked = rows.filter(r => !r.platform || !r.category)
  const missingUsername = missingAccountPlatforms.filter(p => !usernameByPlatform.get(p))
  const canSend = rows.length > 0 && blocked.length === 0 && missingUsername.length === 0

  async function send(dryRun: boolean) {
    setError('')
    setPhase('sending')
    const form = new FormData()
    for (const r of rows) form.append('files', r.file)
    form.append('assignments', JSON.stringify(rows.map(r => ({
      filename: r.file.name,
      platform: r.platform,
      category: r.category,
      username: r.username.trim() || usernameByPlatform.get(r.platform as Platform) || undefined,
    }))))
    if (dryRun) form.append('dry_run', 'true')

    try {
      const res  = await fetch(`/api/brands/${brandId}/csv/ingest`, { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Gagal memproses file.'); setPhase('review'); return }
      setResults(json.data.results ?? [])
      if (dryRun) {
        setPhase('review')
      } else {
        setPhase('done')
        onDone?.(json.data.results ?? [])
      }
    } catch {
      setError('Gagal menghubungi server.')
      setPhase('review')
    }
  }

  const catsFor = (p: Platform | '') =>
    (p && catalog?.categories?.[p]) ? catalog.categories[p] : []

  // ── Layar pilih file ────────────────────────────────────────────────────
  if (phase === 'pick' || phase === 'detecting') {
    return (
      <div className="flex flex-col gap-3">
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
          onClick={() => inputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
            compact ? 'py-7' : 'py-12'
          } ${dragging ? 'border-[#1B8A80] bg-[#1B8A80]/5' : 'border-[#e5e7eb] hover:border-[#d1d5db] hover:bg-[#fafafa]'}`}
        >
          {phase === 'detecting' ? (
            <>
              <span className="material-symbols-outlined text-[30px] text-[#1B8A80] animate-spin">progress_activity</span>
              <p style={PJB} className="text-[13px] font-semibold text-[#374151]">Mengenali file…</p>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[30px] text-[#cbd1d8]">upload_file</span>
              <p style={PJB} className="text-[13px] font-semibold text-[#374151]">
                Tarik file ke sini, atau klik untuk memilih
              </p>
              <p className="text-[12px] text-[#9ca3af]">
                Export Fanpage Karma — CSV atau XLSX, bisa banyak file sekaligus
              </p>
            </>
          )}
          <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden
            onChange={e => e.target.files && handleFiles(e.target.files)} />
        </div>

        <p className="text-[11.5px] text-[#9ca3af] leading-relaxed">
          Platform dan jenis data dikenali otomatis dari isi file — Anda hanya perlu
          mengoreksi kalau ada yang salah. Twitter/X belum didukung.
        </p>

        {error && <p className="text-[12px] text-red-500">{error}</p>}
        {onCancel && (
          <div className="flex justify-end">
            <button type="button" onClick={onCancel} style={PJB}
              className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors">
              Tutup
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Layar hasil ─────────────────────────────────────────────────────────
  if (phase === 'done') {
    const ok     = results.filter(r => r.ok)
    const failed = results.filter(r => !r.ok)
    const rowsIn = ok.reduce((n, r) => n + (r.rows ?? 0), 0)
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
            failed.length ? 'bg-amber-50' : 'bg-emerald-50'}`}>
            <span className={`material-symbols-outlined text-[22px] ${
              failed.length ? 'text-amber-500' : 'text-emerald-600'}`}>
              {failed.length ? 'warning' : 'check_circle'}
            </span>
          </div>
          <div>
            <p style={PJB} className="text-[14px] font-bold text-[#111827]">
              {failed.length
                ? `${ok.length} file berhasil, ${failed.length} gagal`
                : `${ok.length} file berhasil diproses`}
            </p>
            <p className="text-[12.5px] text-[#9ca3af] mt-0.5">
              {rowsIn.toLocaleString('en-US')} baris masuk. Dashboard terisi setelah
              pemrosesan terjadwal berikutnya berjalan.
            </p>
          </div>
        </div>

        <div className="flex flex-col divide-y divide-[#f3f4f6] border border-[#e5e7eb] rounded-xl overflow-hidden">
          {results.map((r, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3">
              <span className={`material-symbols-outlined text-[17px] mt-0.5 flex-shrink-0 ${
                r.ok ? 'text-emerald-500' : 'text-red-400'}`}>
                {r.ok ? 'check' : 'close'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] text-[#111827] font-medium break-all">{r.file}</p>
                <p className="text-[11.5px] text-[#9ca3af] mt-0.5">
                  {r.platform} · {r.category}
                  {r.ok && r.table ? ` · ${r.rows?.toLocaleString('en-US')} baris → ${r.table}` : ''}
                </p>
                {!r.ok && r.error && (
                  <p className="text-[11.5px] text-red-500 mt-1 break-words">{r.error}</p>
                )}
                {r.ok && r.extra_note && (
                  <p className="text-[11.5px] text-[#6b7280] mt-0.5">{r.extra_note}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-between">
          <button type="button" onClick={() => { setRows([]); setResults([]); setPhase('pick') }} style={PJB}
            className="h-9 px-4 border border-[#e5e7eb] text-[13px] font-semibold text-[#374151] rounded-lg hover:bg-[#f9fafb] transition-colors">
            Upload lagi
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} style={PJB}
              className="h-9 px-4 bg-[#1B8A80] hover:bg-[#177A70] text-white text-[13px] font-semibold rounded-lg transition-colors">
              Selesai
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Layar review grid ───────────────────────────────────────────────────
  const dryResults = results.filter(r => r.dry_run)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p style={PJB} className="text-[13px] font-semibold text-[#111827]">
            {rows.length} file siap diproses
          </p>
          <p className="text-[12px] text-[#9ca3af] mt-0.5">
            Periksa platform dan jenis datanya. Baris bertanda kuning perlu Anda pastikan.
          </p>
        </div>
        <button type="button" onClick={() => inputRef.current?.click()} style={PJB}
          className="flex items-center gap-1 h-8 px-3 border border-[#e5e7eb] text-[12.5px] font-semibold text-[#374151] rounded-lg hover:bg-[#f9fafb] transition-colors">
          <span className="material-symbols-outlined text-[15px]">add</span>
          Tambah file
        </button>
        <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden
          onChange={e => e.target.files && handleFiles([...rows.map(r => r.file), ...Array.from(e.target.files)])} />
      </div>

      <div className="border border-[#e5e7eb] rounded-xl overflow-hidden">
        <div className="grid grid-cols-[1fr_130px_170px_64px_36px] gap-x-3 px-3 py-2 bg-[#fafafa] border-b border-[#e5e7eb]">
          {['File', 'Platform', 'Jenis data', 'Baris', ''].map((h, i) => (
            <span key={i} style={PJB} className="text-[10px] font-bold uppercase tracking-widest text-[#c4c9d4]">{h}</span>
          ))}
        </div>

        <div className="divide-y divide-[#f3f4f6] max-h-[340px] overflow-y-auto">
          {rows.map((r, i) => {
            const unsupported = r.detected && !r.detected.supported
            const warn = !r.platform || !r.category || r.detected?.needs_confirmation || unsupported
            return (
              <div key={`${r.file.name}-${i}`}
                className={`grid grid-cols-[1fr_130px_170px_64px_36px] gap-x-3 px-3 py-2.5 items-center ${
                  warn ? 'bg-amber-50/40' : ''}`}>

                <div className="min-w-0">
                  <p className="text-[12.5px] text-[#111827] font-medium truncate" title={r.file.name}>
                    {r.file.name}
                  </p>
                  <p className="text-[11px] text-[#9ca3af] mt-0.5 truncate">
                    {fmtBytes(r.file.size)}
                    {r.detected?.title ? ` · “${r.detected.title}”` : ''}
                  </p>
                  {unsupported && r.detected?.reason && (
                    <p className="text-[11px] text-amber-700 mt-0.5">{r.detected.reason}</p>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {r.platform && <PlatformIcon platform={r.platform} size={16} />}
                  <select
                    value={r.platform}
                    onChange={e => patch(i, { platform: e.target.value as Platform, category: '' })}
                    className="flex-1 h-8 px-1.5 text-[12px] text-[#111827] bg-white border border-[#e5e7eb] rounded-lg outline-none focus:border-[#1B8A80]">
                    <option value="">Pilih…</option>
                    {CSV_PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>

                <select
                  value={r.category}
                  onChange={e => patch(i, { category: e.target.value })}
                  className="h-8 px-1.5 text-[12px] text-[#111827] bg-white border border-[#e5e7eb] rounded-lg outline-none focus:border-[#1B8A80]">
                  <option value="">Pilih…</option>
                  {catsFor(r.platform).map(c => (
                    <option key={c.category} value={c.category}>{c.label}</option>
                  ))}
                  {/* Kategori hasil deteksi yang belum ada di katalog tetap bisa dipakai. */}
                  {r.category && !catsFor(r.platform).some(c => c.category === r.category) && (
                    <option value={r.category}>{r.category}</option>
                  )}
                </select>

                <span className="text-[12px] text-[#6b7280] tabular-nums">
                  {r.detected?.rows?.toLocaleString('en-US') ?? '—'}
                </span>

                <button type="button" title="Keluarkan dari daftar"
                  onClick={() => setRows(prev => prev.filter((_, idx) => idx !== i))}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-[#c4c9d4] hover:text-[#ef4444] hover:bg-[#fee2e2] transition-colors">
                  <span className="material-symbols-outlined text-[15px]">close</span>
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Username hanya diminta untuk platform yang brand-nya belum punya akun. */}
      {missingAccountPlatforms.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-[#e5e7eb] bg-[#fafafa] px-4 py-3">
          <p style={PJB} className="text-[12px] font-semibold text-[#374151]">
            Username akun
          </p>
          <p className="text-[11.5px] text-[#9ca3af] -mt-1">
            Brand ini belum punya akun untuk platform di bawah. Isi username-nya supaya
            datanya punya pemilik yang jelas.
          </p>
          {missingAccountPlatforms.map(p => {
            const idx = rows.findIndex(r => r.platform === p)
            return (
              <div key={p} className="flex items-center gap-2">
                <PlatformIcon platform={p} size={18} />
                <input
                  type="text"
                  value={usernameByPlatform.get(p) ?? ''}
                  onChange={e => patch(idx, { username: e.target.value })}
                  placeholder={`@username di ${p}`}
                  className="flex-1 h-8 px-2.5 text-[12.5px] text-[#111827] placeholder:text-[#d1d5db] bg-white border border-[#e5e7eb] rounded-lg outline-none focus:border-[#1B8A80]"
                />
              </div>
            )
          })}
        </div>
      )}

      {/* Hasil pratinjau: tabel tujuan tiap file, tanpa menulis apa pun. */}
      {dryResults.length > 0 && (
        <div className="rounded-xl border border-[#e5e7eb] overflow-hidden">
          <p style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#9ca3af] px-4 pt-3 pb-2">
            Pratinjau tujuan
          </p>
          <div className="divide-y divide-[#f3f4f6]">
            {dryResults.map((r, i) => (
              <div key={i} className="px-4 py-2.5">
                <p className="text-[12px] text-[#111827] font-medium break-all">{r.file}</p>
                {r.ok
                  ? (r.planned_writes ?? []).map((w, k) => (
                      <p key={k} className="text-[11.5px] text-[#6b7280] mt-0.5">
                        → <span className="font-medium text-[#374151]">{w.schema}.{w.table}</span>
                        {' '}· {w.rows.toLocaleString('en-US')} baris · key {w.key_cols.join(' + ')}
                      </p>
                    ))
                  : <p className="text-[11.5px] text-red-500 mt-0.5 break-words">{r.error}</p>
                }
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-[12px] text-red-500">{error}</p>}

      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => { setRows([]); setResults([]); setPhase('pick') }} style={PJB}
          className="h-9 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors">
          Ganti file
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => send(true)} disabled={!canSend || phase === 'sending'} style={PJB}
            className="h-9 px-4 border border-[#e5e7eb] text-[13px] font-semibold text-[#374151] rounded-lg hover:bg-[#f9fafb] disabled:opacity-40 transition-colors">
            Pratinjau
          </button>
          <button type="button" onClick={() => send(false)} disabled={!canSend || phase === 'sending'} style={PJB}
            className="h-9 px-4 bg-[#1B8A80] hover:bg-[#177A70] disabled:opacity-40 text-white text-[13px] font-semibold rounded-lg transition-colors flex items-center gap-2">
            {phase === 'sending'
              ? <><span className="material-symbols-outlined text-[15px] animate-spin">progress_activity</span> Memproses…</>
              : <>Proses {rows.length} file</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}
