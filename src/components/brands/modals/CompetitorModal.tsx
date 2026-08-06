'use client'

import { useMemo, useState } from 'react'
import { CompetitorAccount, Platform, PLATFORM_CONFIG, PLATFORM_LIST } from '@/lib/brands/types'
import PlatformIcon from '../PlatformIcon'
import { MAX_COMPETITORS_PER_PLATFORM, competitorQuotaMessage } from '@/lib/quotas'
import { isValidHandle, invalidHandleMessage } from '@/lib/competitors/verify'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

interface Props {
  brandName: string
  competitors: CompetitorAccount[]
  onClose: () => void
  /**
   * Membuat competitor lalu MENUNGGU verifikasinya, mengembalikan hasil akhirnya.
   * Modal tidak menutup sendiri: 'not_found' membiarkannya terbuka supaya
   * username-nya bisa langsung diperbaiki.
   */
  onAdded: (platform: Platform, username: string) => Promise<'verified' | 'not_found' | 'timeout'>
}

export default function CompetitorModal({ brandName, competitors, onClose, onAdded }: Props) {
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [username, setUsername] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  // Fase kedua: baris sudah dibuat, Apify sedang memastikan akunnya ada.
  const [checking, setChecking] = useState(false)
  const busy = loading || checking

  // Quota is counted per platform — a full Instagram slot leaves TikTok/Facebook open.
  const usedPerPlatform = useMemo(() => {
    const used = {} as Partial<Record<Platform, number>>
    for (const c of competitors) used[c.platform] = (used[c.platform] ?? 0) + 1
    return used
  }, [competitors])

  const selectedFull = platform ? (usedPerPlatform[platform] ?? 0) >= MAX_COMPETITORS_PER_PLATFORM : false

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!platform) { setError('Select a platform.'); return }
    if (selectedFull) { setError(competitorQuotaMessage(PLATFORM_CONFIG[platform].label)); return }
    const trimmed = username.trim().replace(/^@/, '')
    if (!trimmed) { setError('Enter a username.'); return }
    // Cermin validasi server: handle berspasi bikin actor Apify menolak start-run.
    if (!isValidHandle(platform, trimmed)) {
      setError(invalidHandleMessage(platform, trimmed)); return
    }

    setLoading(true)
    try {
      // Fase 1 selesai begitu barisnya dibuat; fase 2 menunggu Apify. Keduanya
      // dijalani tanpa menutup modal, jadi hasilnya bisa muncul di sini.
      setChecking(true)
      const outcome = await onAdded(platform, trimmed)
      if (outcome === 'not_found') {
        // Barisnya sudah dilepas server. Modal tetap terbuka, username dibiarkan
        // supaya cukup diperbaiki lalu Add lagi.
        setError(`Akun @${trimmed} tidak ditemukan di ${PLATFORM_CONFIG[platform].label}. ` +
                 `Periksa lagi penulisannya.`)
        return
      }
      onClose() // 'verified' atau 'timeout' — sisanya diurus di latar
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
      setChecking(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />

      <div className="relative bg-white rounded-xl w-full max-w-[460px] mx-4 shadow-xl shadow-black/8 border border-[#e5e7eb]">

        <div className="px-6 pt-5 pb-4 sticky top-0 bg-white border-b border-[#f3f4f6] z-10">
          <h2 style={PJB} className="text-[15px] font-bold text-[#111827]">Add Competitor Account</h2>
          <p className="text-[13px] text-[#9ca3af] mt-0.5">
            Track a competitor account for <span className="font-medium text-[#374151]">{brandName}</span>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-5">

          {/* Platform */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <label style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#6b7280]">Platform</label>
              <span className="text-[11px] text-[#9ca3af]">Max {MAX_COMPETITORS_PER_PLATFORM} per platform</span>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {PLATFORM_LIST.map(p => {
                const cfg    = PLATFORM_CONFIG[p]
                const active = platform === p
                const used   = usedPerPlatform[p] ?? 0
                const full   = used >= MAX_COMPETITORS_PER_PLATFORM
                return (
                  <button key={p} type="button" disabled={full}
                    title={full ? competitorQuotaMessage(cfg.label) : undefined}
                    onClick={() => { setPlatform(p); setError('') }}
                    className={`flex flex-col items-center gap-1.5 py-3 rounded-lg border-2 transition-all ${
                      full     ? 'border-[#f3f4f6] bg-[#fafafa] opacity-45 cursor-not-allowed' :
                      active   ? 'border-[#285D6E] bg-[#f0f7fa]' : 'border-[#f3f4f6] hover:border-[#e5e7eb]'
                    }`}>
                    <PlatformIcon platform={p} size={32} />
                    <span style={PJB} className={`text-[10px] font-semibold ${active && !full ? 'text-[#327488]' : 'text-[#9ca3af]'}`}>
                      {cfg.label.replace(' (Twitter)', '')}
                    </span>
                    {used > 0 && (
                      <span style={PJB} className={`text-[9px] font-bold ${full ? 'text-[#ef4444]' : 'text-[#9ca3af]'}`}>
                        {used}/{MAX_COMPETITORS_PER_PLATFORM}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Username */}
          <div className="flex flex-col gap-1.5">
            <label style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#6b7280]">
              Competitor Username
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#9ca3af]">@</span>
              <input
                type="text"
                value={username.replace(/^@/, '')}
                onChange={e => { setUsername(e.target.value); setError('') }}
                placeholder={platform ? `competitor.${platform}.handle` : 'select a platform first'}
                disabled={!platform || busy}
                maxLength={60}
                className="w-full h-9 pl-7 pr-3 text-[13.5px] text-[#111827] placeholder:text-[#d1d5db] bg-white border border-[#e5e7eb] rounded-lg outline-none transition-all focus:border-[#285D6E] focus:ring-2 focus:ring-[#285D6E]/10 disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          </div>

          {/* Sedang diperiksa. Diberi durasi harapan yang jujur (terukur 7-59
              detik) supaya menunggu terasa wajar, bukan seperti macet. */}
          {checking && (
            <div className="flex items-start gap-2.5 -mt-1 px-3 py-2.5 bg-[#f0f7f5] border border-[#cfe6e1] rounded-lg">
              <span className="material-symbols-outlined text-[16px] text-[#285D6E] animate-spin flex-shrink-0">
                progress_activity
              </span>
              <p className="text-[12px] text-[#22615c] leading-relaxed">
                Memeriksa apakah akun ini benar-benar ada… biasanya 10–60 detik.
                <span className="block text-[11px] text-[#5c8a84] mt-0.5">
                  Jangan tutup jendela ini kalau ingin tahu hasilnya.
                </span>
              </p>
            </div>
          )}

          {error && !checking && <p className="text-[12px] text-red-500 -mt-2">{error}</p>}
        </form>

        <div className="border-t border-[#f3f4f6]" />
        <div className="px-6 py-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose}
            className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors">
            {/* Tetap aktif saat memeriksa: competitor-nya sudah tersimpan, dan
                verifikasi jalan terus di latar walau modalnya ditutup. */}
            {busy ? 'Tutup' : 'Cancel'}
          </button>
          <button onClick={handleSubmit} disabled={!platform || selectedFull || !username.trim() || busy} style={PJB}
            className="h-8 px-4 bg-[#285D6E] hover:bg-[#1E4A58] disabled:opacity-40 text-white text-[13px] font-semibold rounded-lg transition-colors">
            {checking ? 'Memeriksa…' : loading ? 'Adding…' : 'Add Competitor'}
          </button>
        </div>
      </div>
    </div>
  )
}
