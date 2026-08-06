'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Platform, PLATFORM_CONFIG, SocialAccount } from '@/lib/brands/types'
import PlatformIcon from '../PlatformIcon'
import { useOAuthConnect, CONNECT_OPTIONS } from '@/hooks/useOAuthConnect'
import { CSV_PLATFORMS } from '@/lib/csv/types'
import { isValidHandle, invalidHandleMessage } from '@/lib/competitors/verify'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

interface SessionAccount {
  account: SocialAccount
  is_new:  boolean
}

interface Props {
  brandId:        string
  brandName:      string
  usedPlatforms?: Platform[]
  onClose:        () => void
  onConnected:    (account: SocialAccount) => void
}

export default function ConnectAccountModal({ brandId, brandName, usedPlatforms = [], onClose, onConnected }: Props) {
  const { loading, error, pending, connect, reset, save } = useOAuthConnect(brandId)
  const [sessionConnected, setSessionConnected] = useState<SessionAccount[]>([])

  // ── Akun bersumber CSV ──
  // Sengaja hanya MENDAFTARKAN akunnya, tidak mengunggah file: sama persis
  // dengan langkah 2 wizard Add New Brand, supaya "punya channel" berarti hal
  // yang sama dari pintu mana pun. Filenya menyusul di tab Data Sources.
  const [csvOpen,     setCsvOpen]     = useState(false)
  const [csvPlatform, setCsvPlatform] = useState<Platform>('instagram')
  const [csvInput,    setCsvInput]    = useState('')
  const [csvErr,      setCsvErr]      = useState('')
  const [csvBusy,     setCsvBusy]     = useState(false)

  const allConnectedPlatforms: Platform[] = [
    ...usedPlatforms,
    ...sessionConnected.map(s => s.account.platform),
  ]
  const csvRegistered = sessionConnected
    .filter(s => s.account.data_source === 'csv')
    .map(s => s.account)

  /**
   * Tutup modal sambil menyerahkan apa pun yang sudah terlanjur dibuat.
   *
   * Baik OAuth maupun CSV sudah MENULIS akunnya ke server begitu langkahnya
   * selesai — tidak ada yang bisa dibatalkan lagi di sini. Jadi menutup tanpa
   * meneruskannya bukan "batal", cuma membuat induknya tidak tahu, dan akunnya
   * baru muncul setelah refresh. Untuk akun CSV itu terasa parah: user baru
   * saja menunggu ~30 detik verifikasi.
   */
  function closeAndHandOff() {
    for (const { account } of sessionConnected) onConnected(account)
    onClose()
  }

  /**
   * Daftarkan akun CSV lewat POST /accounts (dataSource: 'csv').
   *
   * Menunggu responsnya dengan sengaja. Endpoint itu memverifikasi keberadaan
   * akun lewat Apify — terukur ~32 detik untuk Instagram, ~10 detik untuk
   * Facebook — dan itulah satu-satunya yang menghalangi username salah ketik
   * menjadi pemilik data L0 yang diunggah nanti. Tombolnya diberi spinner dan
   * estimasi supaya tunggunya terbaca sebagai kerja, bukan sebagai hang.
   */
  async function addCsvAccount() {
    const u = csvInput.trim().replace(/^@/, '')
    if (!u) { setCsvErr('Isi username-nya dulu.'); return }
    // Cermin validasi server — format salah tidak perlu menunggu Apify.
    if (!isValidHandle(csvPlatform, u)) { setCsvErr(invalidHandleMessage(csvPlatform, u)); return }
    if (allConnectedPlatforms.includes(csvPlatform)) {
      setCsvErr(`${PLATFORM_CONFIG[csvPlatform].label} sudah punya akun di brand ini.`)
      return
    }

    setCsvBusy(true)
    setCsvErr('')
    try {
      const res = await fetch(`/api/brands/${brandId}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: csvPlatform, username: u, dataSource: 'csv' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCsvErr(json.error ?? 'Gagal mendaftarkan akun.')
        return
      }
      setSessionConnected(prev => [...prev, { account: json.data as SocialAccount, is_new: !!json.is_new }])
      setCsvInput('')
      setCsvOpen(false)
    } catch {
      setCsvErr('Gagal menghubungi server.')
    } finally {
      setCsvBusy(false)
    }
  }

  // ── Confirm step ──────────────────────────────────────────────────
  if (pending) {
    const { payload } = pending
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/25" />

        <div className="relative bg-white rounded-xl w-full max-w-[460px] mx-4 shadow-xl shadow-black/8 border border-[#e5e7eb]">
          <div className="px-6 pt-5 pb-4">
            <h2 style={PJB} className="text-[15px] font-bold text-[#111827]">Confirm Account</h2>
            <p className="text-[13px] text-[#9ca3af] mt-0.5">
              Connect this account to <span className="font-medium text-[#374151]">{brandName}</span>?
            </p>
          </div>
          <div className="border-t border-[#f3f4f6]" />

          <div className="px-6 py-6 flex flex-col items-center gap-4">
            <div className="flex items-center gap-4 w-full bg-[#f9fafb] rounded-xl px-4 py-3.5 border border-[#f3f4f6]">
              {payload.avatarUrl ? (
                <Image src={payload.avatarUrl} alt={payload.username} width={44} height={44}
                  className="rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-11 h-11 rounded-full bg-[#e5e7eb] flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[22px] text-[#9ca3af]">person</span>
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <span style={PJB} className="text-[13px] font-semibold text-[#111827] truncate">
                  @{payload.username}
                </span>
                <span style={PJB} className="text-[11px] text-[#9ca3af] capitalize">{payload.platform}</span>
              </div>
              <div className="ml-auto shrink-0">
                <PlatformIcon platform={payload.platform as Platform} size={24} />
              </div>
            </div>

            {error && <p className="text-[12px] text-red-500 self-start">{error}</p>}
          </div>

          <div className="border-t border-[#f3f4f6]" />
          <div className="px-6 py-4 flex justify-between items-center">
            <button type="button" onClick={reset} disabled={loading} style={PJB}
              className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors disabled:opacity-40">
              Ganti Akun
            </button>

            <button type="button" disabled={loading} style={PJB}
              onClick={() => save((account, is_new) => {
                setSessionConnected(prev => [...prev, { account, is_new }])
                reset()
              })}
              className="h-8 px-4 text-[13px] font-semibold bg-[#111827] text-white rounded-lg hover:bg-[#1f2937] transition-colors disabled:opacity-50 flex items-center gap-2">
              {loading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Menghubungkan...
                </>
              ) : 'Connect'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Platform list ─────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Klik latar saat verifikasi CSV masih jalan tidak menutup apa pun:
          request-nya tetap selesai di server, jadi menutup di tengah hanya
          menyembunyikan akun yang tetap terbuat. */}
      <div className="absolute inset-0 bg-black/25" onClick={csvBusy ? undefined : closeAndHandOff} />

      <div className="relative bg-white rounded-xl w-full max-w-[460px] mx-4 shadow-xl shadow-black/8 border border-[#e5e7eb]">
        <div className="px-6 pt-5 pb-4">
          <h2 style={PJB} className="text-[15px] font-bold text-[#111827]">Connect Account</h2>
          <p className="text-[13px] text-[#9ca3af] mt-0.5">
            Link a social account to <span className="font-medium text-[#374151]">{brandName}</span>
          </p>
        </div>
        <div className="border-t border-[#f3f4f6]" />

        <div className="px-6 py-5 flex flex-col gap-2">
          {CONNECT_OPTIONS.map(opt => {
            const taken = allConnectedPlatforms.includes(opt.platform)
            // Platform yang baru didaftarkan sebagai CSV juga 'taken', tapi
            // menyebutnya "Already connected" salah — tidak ada token di sana,
            // dan user yang membacanya akan mengira datanya sudah mengalir
            // sendiri. Akun lama tidak bisa dibedakan dari sini (usedPlatforms
            // cuma daftar platform), jadi hanya yang sesi ini yang dikoreksi.
            const takenByCsv = csvRegistered.some(a => a.platform === opt.platform)
            return (
              <div key={opt.id} className={`rounded-xl border transition-colors ${
                taken ? 'border-[#e5e7eb] opacity-40 pointer-events-none' : 'border-[#e5e7eb] bg-white'
              }`}>
                <div className="flex items-center gap-3 px-4 h-[54px]">
                  <PlatformIcon platform={opt.platform} size={30} />
                  <span style={PJB} className="text-[13px] font-semibold text-[#111827] flex-1 leading-tight">
                    {opt.label}
                  </span>
                  {taken ? (
                    <span style={PJB} className="text-[11px] text-[#9ca3af] flex-shrink-0">
                      {takenByCsv ? 'Terdaftar via CSV' : 'Already connected'}
                    </span>
                  ) : (
                    <button type="button" disabled={loading} style={PJB}
                      onClick={() => connect(opt.method)}
                      className="flex items-center gap-0.5 text-[12.5px] font-semibold text-[#285D6E] disabled:opacity-40 flex-shrink-0">
                      Connect
                      <span className="material-symbols-outlined text-[15px]">chevron_right</span>
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {/* ── Data manual (CSV) ──
              Sejajar dengan opsi OAuth di atas karena hasilnya sama: satu
              channel terpasang di brand ini. Bedanya cuma dari mana angkanya
              datang — file, bukan token. */}
          <div className="rounded-xl border border-[#e5e7eb] bg-white">
            <div className="flex items-center gap-3 px-4 h-[54px]">
              <span className="material-symbols-outlined text-[26px] text-[#6b7280]">upload_file</span>
              <div className="flex-1 min-w-0">
                <p style={PJB} className="text-[13px] font-semibold text-[#111827] leading-tight">
                  Data manual (upload CSV)
                </p>
                <p className="text-[11px] text-[#9ca3af] mt-0.5 truncate">
                  Tidak punya akses akun resmi? Daftarkan username-nya di sini.
                </p>
              </div>
              <button type="button" onClick={() => setCsvOpen(o => !o)} style={PJB}
                className="flex items-center gap-0.5 text-[12.5px] font-semibold text-[#285D6E] flex-shrink-0">
                Tambah
                <span className="material-symbols-outlined text-[15px]">
                  {csvOpen ? 'expand_less' : 'chevron_right'}
                </span>
              </button>
            </div>

            {csvOpen && (
              <div className="border-t border-[#f3f4f6] px-4 py-3 flex flex-col gap-2">
                <div className="flex gap-2">
                  {CSV_PLATFORMS.map(p => {
                    const taken = allConnectedPlatforms.includes(p)
                    return (
                      <button
                        key={p}
                        type="button"
                        disabled={taken || csvBusy}
                        title={taken ? `${PLATFORM_CONFIG[p].label} sudah punya akun di brand ini` : undefined}
                        onClick={() => { setCsvPlatform(p); setCsvErr('') }}
                        className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg border transition-all ${
                          taken
                            ? 'border-[#f3f4f6] bg-[#fafafa] opacity-45 cursor-not-allowed'
                            : csvPlatform === p
                              ? 'border-[#285D6E] bg-[#285D6E]/5'
                              : 'border-[#e5e7eb] hover:border-[#d1d5db]'
                        }`}>
                        <PlatformIcon platform={p} size={20} />
                        <span className={`text-[9px] font-bold ${
                          csvPlatform === p && !taken ? 'text-[#285D6E]' : 'text-[#9ca3af]'}`}>
                          {PLATFORM_CONFIG[p].short}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div className="flex gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={csvInput}
                    disabled={csvBusy}
                    onChange={e => { setCsvInput(e.target.value); setCsvErr('') }}
                    onKeyDown={e => e.key === 'Enter' && !csvBusy && addCsvAccount()}
                    placeholder={`@username di ${PLATFORM_CONFIG[csvPlatform].label}`}
                    className="flex-1 h-8 px-3 text-[12.5px] text-[#111827] placeholder:text-[#d1d5db] bg-white border border-[#e5e7eb] rounded-lg outline-none focus:border-[#285D6E] focus:ring-2 focus:ring-[#285D6E]/10 transition-all disabled:bg-[#fafafa] disabled:text-[#9ca3af]"
                  />
                  <button type="button" onClick={addCsvAccount} disabled={csvBusy} style={PJB}
                    className="h-8 px-3 bg-[#f3f4f6] hover:bg-[#e5e7eb] text-[12.5px] font-semibold text-[#374151] rounded-lg transition-colors flex-shrink-0 disabled:opacity-60 flex items-center gap-1.5">
                    {csvBusy && <span className="w-3 h-3 border-2 border-[#9ca3af]/40 border-t-[#6b7280] rounded-full animate-spin" />}
                    {csvBusy ? 'Memeriksa…' : 'Tambah'}
                  </button>
                </div>
                {csvBusy && (
                  // Angkanya terukur, bukan karangan: run profil Apify ~32 detik
                  // untuk Instagram, ~10 detik untuk Facebook.
                  <p className="text-[11px] text-[#9ca3af]">
                    Memeriksa akun @{csvInput.trim().replace(/^@/, '')} di {PLATFORM_CONFIG[csvPlatform].label} —
                    biasanya {csvPlatform === 'instagram' ? '±30 detik' : '±10 detik'}. Jangan tutup jendela ini.
                  </p>
                )}
                {csvErr && <p className="text-[11px] text-red-500">{csvErr}</p>}
                {!csvBusy && !csvErr && (
                  <p className="text-[11px] text-[#9ca3af]">
                    Filenya diupload nanti di tab <span className="font-semibold text-[#6b7280]">Data Sources</span> pada halaman brand.
                  </p>
                )}
              </div>
            )}

            {csvRegistered.length > 0 && (
              <div className="border-t border-[#f3f4f6] px-4 py-2.5 flex flex-col gap-1.5">
                {csvRegistered.map(a => (
                  <div key={a.id} className="flex items-center gap-2">
                    <PlatformIcon platform={a.platform} size={16} />
                    <span style={PJB} className="text-[12.5px] text-[#111827] flex-1 truncate">
                      @{a.username}
                    </span>
                    <span className="text-[10px] font-bold text-[#285D6E] bg-[#285D6E]/10 px-1.5 py-0.5 rounded-full">
                      CSV
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-[12px] text-red-500">{error}</p>}
        </div>

        <div className="border-t border-[#f3f4f6]" />
        <div className="px-6 py-4 flex justify-between items-center">
          <button type="button" onClick={closeAndHandOff} style={PJB}
            className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors">
            {sessionConnected.length > 0 ? 'Tutup' : 'Close'}
          </button>

          {sessionConnected.length > 0 && (
            <button type="button" style={PJB}
              onClick={closeAndHandOff}
              className="h-8 px-4 text-[13px] font-semibold bg-[#285D6E] text-white rounded-lg hover:bg-[#1E4A58] transition-colors flex items-center gap-1.5">
              Simpan
              <span className="material-symbols-outlined text-[14px]">check</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
