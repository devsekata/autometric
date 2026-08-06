'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBrandDetail } from './BrandDetailContext'
import PlatformIcon from '../PlatformIcon'
import CsvUploadPanel, { type ExistingAccount } from '../csv/CsvUploadPanel'
import { BrandDataSource, CsvUploadLog, CSV_PLATFORMS } from '@/lib/csv/types'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const STATUS_STYLE: Record<string, string> = {
  success: 'text-emerald-700 bg-emerald-50',
  failed:  'text-red-600 bg-red-50',
  skipped: 'text-[#6b7280] bg-[#f3f4f6]',
}

export default function BrandDataSourcesTab() {
  const { brand } = useBrandDetail()
  const [sources, setSources] = useState<BrandDataSource[]>([])
  const [history, setHistory] = useState<CsvUploadLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [showUpload, setShowUpload] = useState(false)

  const load = useCallback(async () => {
    try {
      const res  = await fetch(`/api/brands/${brand.id}/csv/sources`)
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Gagal memuat data.'); return }
      setSources(json.data.sources ?? [])
      setHistory(json.data.history ?? [])
      setError('')
    } catch {
      setError('Gagal memuat data.')
    } finally {
      setLoading(false)
    }
  }, [brand.id])

  useEffect(() => { load() }, [load])

  const csvAccounts: ExistingAccount[] = sources
    .filter(s => CSV_PLATFORMS.includes(s.platform))
    .map(s => ({
      platform: s.platform,
      social_account_id: s.social_account_id,
      username: s.username,
      connected: s.connected,
      data_source: s.data_source,
    }))

  const unusedPlatforms = CSV_PLATFORMS.filter(p => !sources.some(s => s.platform === p))

  return (
    <div className="max-w-3xl pb-10">

      <div className="flex items-center justify-between py-4 border-b border-[#e5e7eb]">
        <div>
          <h2 style={PJB} className="text-[14px] font-bold text-[#111827]">Data Sources</h2>
          <p className="text-[12.5px] text-[#9ca3af] mt-0.5">
            Dari mana data brand ini berasal — akun resmi, atau upload manual.
          </p>
        </div>
        <button onClick={() => setShowUpload(true)} style={PJB}
          className="flex items-center gap-1.5 h-9 px-4 bg-[#285D6E] hover:bg-[#1E4A58] text-white text-[13px] font-semibold rounded-lg transition-colors">
          <span className="material-symbols-outlined text-[15px]">upload_file</span>
          Upload Data
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-[#9ca3af]">
          <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
          <span className="text-[13px]">Memuat…</span>
        </div>
      ) : (
        <>
          {error && <p className="text-[12px] text-red-500 mt-3">{error}</p>}

          {/* ── Sumber per platform ── */}
          <div className="mt-5">
            <p style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#c4c9d4] mb-2">
              Per platform
            </p>

            {sources.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#e5e7eb] bg-[#fafafa] px-4 py-8 flex flex-col items-center gap-1.5 text-center">
                <span className="material-symbols-outlined text-[28px] text-[#cbd1d8]">database</span>
                <p style={PJB} className="text-[13px] font-semibold text-[#374151]">Belum ada sumber data</p>
                <p className="text-[12px] text-[#9ca3af]">
                  Hubungkan akun resmi di tab Accounts, atau upload file export di sini.
                </p>
              </div>
            ) : (
              <div className="border border-[#e5e7eb] rounded-xl overflow-hidden">
                <div className="grid grid-cols-[28px_1fr_120px_110px_70px] gap-x-3 px-3 py-2 bg-[#fafafa] border-b border-[#e5e7eb]">
                  {['', 'Akun', 'Sumber', 'Data s/d', 'Upload'].map((h, i) => (
                    <span key={i} style={PJB} className="text-[10px] font-bold uppercase tracking-widest text-[#c4c9d4]">{h}</span>
                  ))}
                </div>
                <div className="divide-y divide-[#f3f4f6]">
                  {sources.map(s => (
                    <div key={s.social_account_id + s.platform}
                      className="grid grid-cols-[28px_1fr_120px_110px_70px] gap-x-3 px-3 py-3 items-center">
                      <PlatformIcon platform={s.platform} size={22} />
                      <div className="min-w-0">
                        <p className="text-[12.5px] text-[#111827] font-medium truncate">{s.username}</p>
                        <p className="text-[11px] text-[#9ca3af] capitalize mt-0.5">{s.platform}</p>
                      </div>
                      <span style={PJB} className={`inline-flex items-center gap-1 justify-self-start text-[10.5px] font-bold px-2 py-1 rounded-full ${
                        s.data_source === 'csv'
                          ? 'text-[#285D6E] bg-[#285D6E]/10'
                          : 'text-blue-700 bg-blue-50'
                      }`}>
                        <span className="material-symbols-outlined text-[12px]">
                          {s.data_source === 'csv' ? 'upload_file' : 'sync'}
                        </span>
                        {s.data_source === 'csv' ? 'Upload CSV' : 'Akun resmi'}
                      </span>
                      <span className="text-[12px] text-[#6b7280] tabular-nums">
                        {s.data_source === 'csv' ? fmtDate(s.data_through) : 'otomatis'}
                      </span>
                      <span className="text-[12px] text-[#6b7280] tabular-nums">
                        {s.data_source === 'csv' ? s.upload_count : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {unusedPlatforms.length > 0 && (
              <p className="text-[11.5px] text-[#9ca3af] mt-2">
                Belum ada sumber untuk: {unusedPlatforms.join(', ')}.
              </p>
            )}
          </div>

          {/* ── Riwayat upload ── */}
          {history.length > 0 && (
            <div className="mt-8">
              <p style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#c4c9d4] mb-2">
                Riwayat upload
              </p>
              <div className="border border-[#e5e7eb] rounded-xl overflow-hidden">
                <div className="grid grid-cols-[1fr_100px_150px_80px_88px] gap-x-3 px-3 py-2 bg-[#fafafa] border-b border-[#e5e7eb]">
                  {['File', 'Platform', 'Jenis data', 'Baris', 'Waktu'].map((h, i) => (
                    <span key={i} style={PJB} className="text-[10px] font-bold uppercase tracking-widest text-[#c4c9d4]">{h}</span>
                  ))}
                </div>
                <div className="divide-y divide-[#f3f4f6] max-h-[420px] overflow-y-auto">
                  {history.map(h => (
                    <div key={h.id} className="grid grid-cols-[1fr_100px_150px_80px_88px] gap-x-3 px-3 py-2.5 items-start">
                      <div className="min-w-0">
                        <p className="text-[12px] text-[#111827] font-medium truncate" title={h.file_name}>
                          {h.file_name}
                        </p>
                        <span style={PJB} className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded mt-1 ${
                          STATUS_STYLE[h.status] ?? STATUS_STYLE.skipped}`}>
                          {h.status === 'success' ? 'Berhasil' : h.status === 'failed' ? 'Gagal' : 'Dilewati'}
                        </span>
                        {h.status === 'failed' && h.error_message && (
                          <p className="text-[11px] text-red-500 mt-1 break-words">{h.error_message}</p>
                        )}
                        {h.status === 'success' && h.target_table && (
                          <p className="text-[11px] text-[#9ca3af] mt-0.5 truncate">→ {h.target_table}</p>
                        )}
                      </div>
                      <span className="text-[12px] text-[#6b7280] capitalize">{h.platform}</span>
                      <span className="text-[12px] text-[#6b7280] truncate">{h.category ?? '—'}</span>
                      <span className="text-[12px] text-[#6b7280] tabular-nums">
                        {h.rows_written?.toLocaleString('en-US') ?? '—'}
                      </span>
                      <span className="text-[11.5px] text-[#9ca3af]">{fmtDateTime(h.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {showUpload && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[720px] max-h-[88vh] overflow-y-auto">
            <div className="px-6 pt-5 pb-4 border-b border-[#f3f4f6]">
              <h3 style={PJB} className="text-[15px] font-bold text-[#111827]">Upload data</h3>
              <p className="text-[12.5px] text-[#9ca3af] mt-0.5">
                File export Fanpage Karma untuk {brand.name}.
              </p>
            </div>
            <div className="px-6 py-5">
              <CsvUploadPanel
                brandId={brand.id}
                accounts={csvAccounts}
                onDone={() => { load() }}
                onCancel={() => setShowUpload(false)}
              />
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
