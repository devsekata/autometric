'use client'

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import { Brand, CompetitorAccount, Platform, SocialAccount, PLATFORM_LIST, PLATFORM_CONFIG } from '@/lib/brands/types'
import PlatformIcon from '../PlatformIcon'
import { CSV_PLATFORMS } from '@/lib/csv/types'
import { useOAuthConnect, CONNECT_OPTIONS } from '@/hooks/useOAuthConnect'
import { COMPETITOR_ADD_ENABLED } from '@/lib/featureFlags'
import { MAX_COMPETITORS_PER_PLATFORM, competitorQuotaMessage } from '@/lib/quotas'
import { isValidHandle, invalidHandleMessage } from '@/lib/competitors/verify'
import { pollVerification } from '@/lib/competitors/pollVerification'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

interface Props {
  orgId: string
  onClose: () => void
  onCreated: (brand: Brand) => void
}

interface PendingItem {
  platform: Platform
  username: string
  avatarUrl?: string | null
  oauthConnected?: boolean
  methodId?: string
  /** 'csv' = akun tanpa token; datanya diupload manual di tab Data Sources. */
  dataSource?: 'api' | 'csv'
}

type Step = 1 | 2 | 3

function StepIndicator({ step }: { step: Step }) {
  const steps = [
    { n: 1, label: 'Brand Name' },
    { n: 2, label: 'Connect Accounts' },
    { n: 3, label: 'Add Competitors' },
  ]
  return (
    <div className="flex items-center px-6 pt-4 pb-3">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className="flex items-center gap-1.5">
            <div style={PJB} className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${
              step > s.n  ? 'bg-[#285D6E] text-white' :
              step === s.n ? 'bg-[#285D6E] text-white' :
              'bg-[#f3f4f6] text-[#9ca3af]'
            }`}>
              {step > s.n ? '✓' : s.n}
            </div>
            <span style={PJB} className={`text-[11.5px] font-semibold whitespace-nowrap ${
              step >= s.n ? 'text-[#111827]' : 'text-[#9ca3af]'
            }`}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`w-5 h-px mx-2 flex-shrink-0 ${step > s.n ? 'bg-[#285D6E]' : 'bg-[#e5e7eb]'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

function PlatformPicker({ selected, onSelect, used }: {
  selected: Platform
  onSelect: (p: Platform) => void
  used: Partial<Record<Platform, number>>
}) {
  return (
    <div className="flex gap-2">
      {PLATFORM_LIST.map(p => {
        const count = used[p] ?? 0
        const full  = count >= MAX_COMPETITORS_PER_PLATFORM
        return (
          <button
            key={p}
            type="button"
            disabled={full}
            title={full ? competitorQuotaMessage(PLATFORM_CONFIG[p].label) : undefined}
            onClick={() => onSelect(p)}
            className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all ${
              full
                ? 'border-[#f3f4f6] bg-[#fafafa] opacity-45 cursor-not-allowed'
                : selected === p
                  ? 'border-[#285D6E] bg-[#285D6E]/5'
                  : 'border-[#e5e7eb] hover:border-[#d1d5db] hover:bg-[#f9fafb]'
            }`}
          >
            <PlatformIcon platform={p} size={24} />
            <span className={`text-[9px] font-bold ${selected === p && !full ? 'text-[#285D6E]' : 'text-[#9ca3af]'}`}>
              {count > 0 ? `${count}/${MAX_COMPETITORS_PER_PLATFORM}` : PLATFORM_CONFIG[p].short}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function AddedList({ items, onRemove, emptyLabel, notFound = [], busy = false }: {
  items: PendingItem[]
  onRemove: (idx: number) => void
  emptyLabel: string
  /** Username yang terbukti tidak ada — ditandai merah supaya jelas mana yang salah. */
  notFound?: string[]
  /** Sedang diverifikasi: baris yang belum diputuskan diberi spinner. */
  busy?: boolean
}) {
  if (items.length === 0) {
    return <p className="text-[12px] text-[#9ca3af] text-center py-2">{emptyLabel}</p>
  }
  return (
    <div className="flex flex-col gap-1.5 max-h-[108px] overflow-y-auto">
      {items.map((item, i) => {
        const bad = notFound.includes(item.username)
        return (
          <div key={i} className={`flex items-center gap-2 px-3 h-9 rounded-lg border ${
            bad ? 'bg-[#fef2f2] border-[#fecaca]' : 'bg-[#f9fafb] border-[#e5e7eb]'
          }`}>
            {item.avatarUrl
              ? <img src={item.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
              : <PlatformIcon platform={item.platform} size={16} />
            }
            <span style={PJB} className={`text-[12.5px] flex-1 truncate ${bad ? 'text-[#b91c1c]' : 'text-[#111827]'}`}>
              @{item.username}
            </span>
            {bad && (
              <span style={PJB} className="text-[10.5px] font-semibold text-[#b91c1c] flex-shrink-0">
                tidak ditemukan
              </span>
            )}
            {busy && !bad && (
              <span className="material-symbols-outlined text-[14px] text-[#9ca3af] animate-spin flex-shrink-0">
                progress_activity
              </span>
            )}
            <button type="button" onClick={() => onRemove(i)} disabled={busy}
              className="text-[#9ca3af] hover:text-[#6b7280] transition-colors disabled:opacity-40">
              <span className="material-symbols-outlined text-[15px]">close</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default function CreateBrandModal({ orgId, onClose, onCreated }: Props) {
  const [step,    setStep]    = useState<Step>(1)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [brandId, setBrandId] = useState<string | null>(null)

  // Step 1
  const [name,    setName]    = useState('')
  const [nameErr, setNameErr] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  // Step 2
  const [accounts,    setAccounts]    = useState<PendingItem[]>([])
  const [tiktokInput, setTiktokInput] = useState('')
  const [tiktokOpen,  setTiktokOpen]  = useState(false)
  const [csvOpen,     setCsvOpen]     = useState(false)
  const [csvPlatform, setCsvPlatform] = useState<Platform>('instagram')
  const [csvInput,    setCsvInput]    = useState('')
  const [csvErr,      setCsvErr]      = useState('')
  const { loading: oauthLoading, error: oauthError, clearError: clearOAuthError, connect, pending, save, reset } = useOAuthConnect(brandId)
  const csvAccounts = accounts.filter(a => a.dataSource === 'csv')
  const igConnected = accounts.some(a => a.platform === 'instagram' && a.oauthConnected)
  const ttConnected = accounts.some(a => a.platform === 'tiktok'    && a.oauthConnected)
  const fbConnected = accounts.some(a => a.platform === 'facebook'  && a.oauthConnected)

  // Step 3
  const [competitors,  setCompetitors]  = useState<PendingItem[]>([])
  const [compPlatform, setCompPlatform] = useState<Platform>('instagram')
  const [compUsername, setCompUsername] = useState('')
  const [compErr,      setCompErr]      = useState('')
  // Fase verifikasi setelah Finish: baris sudah dibuat, Apify sedang memastikan.
  const [verifying,    setVerifying]    = useState(false)
  // Username yang terbukti tidak ada — ditandai di daftar supaya jelas mana yang
  // harus diperbaiki.
  const [notFound,     setNotFound]     = useState<string[]>([])
  const compRef = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])
  useEffect(() => { if (step === 3) compRef.current?.focus() }, [step])

  const initials = name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'

  // ── Step 1 ──────────────────────────────────────────────────────
  async function handleStep1() {
    const trimmed = name.trim()
    if (!trimmed) { setNameErr('Brand name is required.'); return }
    setLoading(true); setError('')
    try {
      const res  = await fetch(`/api/organizations/${orgId}/brands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Something went wrong.'); return }
      setBrandId(json.data.id)
      setStep(2)
    } catch {
      setError('Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2 helpers ──────────────────────────────────────────────
  function connectAccount(opt: typeof CONNECT_OPTIONS[0]) {
    clearOAuthError()
    connect(opt.method)
  }

  function confirmAccount(opt: typeof CONNECT_OPTIONS[0]) {
    save((account) => {
      setAccounts(prev => [
        ...prev.filter(a => a.platform !== account.platform),
        { platform: account.platform, username: account.username, avatarUrl: account.avatar_url, oauthConnected: true, methodId: opt.id },
      ])
      reset()
    }, { skipInitialSync: true })
  }

  function addTiktokAccount() {
    const u = tiktokInput.trim().replace(/^@/, '')
    if (!u) return
    setAccounts(prev => [...prev.filter(a => a.platform !== 'tiktok'), { platform: 'tiktok', username: u, methodId: 'tiktok' }])
    setTiktokInput('')
    setTiktokOpen(false)
    clearOAuthError()
  }

  function addCsvAccount() {
    const u = csvInput.trim().replace(/^@/, '')
    if (!u) { setCsvErr('Isi username-nya dulu.'); return }
    // Cermin validasi server. Keberadaan akunnya diperiksa nanti saat Next
    // (butuh Apify), tapi format salah tidak perlu menunggu selama itu.
    if (!isValidHandle(csvPlatform, u)) { setCsvErr(invalidHandleMessage(csvPlatform, u)); return }
    if (accounts.some(a => a.platform === csvPlatform)) {
      setCsvErr(`${PLATFORM_CONFIG[csvPlatform].label} sudah punya akun di brand ini.`)
      return
    }
    setAccounts(prev => [...prev, { platform: csvPlatform, username: u, dataSource: 'csv' }])
    setCsvInput('')
    setCsvErr('')
  }

  function removeAccount(platform: Platform) {
    setAccounts(prev => prev.filter(a => a.platform !== platform))
  }

  async function handleStep2(skip: boolean) {
    if (!brandId) return
    setLoading(true); setError('')
    try {
      if (!skip) {
        for (const a of accounts) {
          if (a.oauthConnected) continue
          const res = await fetch(`/api/brands/${brandId}/accounts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              platform: a.platform,
              username: a.username,
              dataSource: a.dataSource ?? 'api',
            }),
          })
          if (!res.ok) {
            const json = await res.json()
            setError(json.error ?? 'Failed to connect account.')
            return
          }
        }
      }
      setStep(3)
    } catch {
      setError('Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  // ── Step 3 helpers ──────────────────────────────────────────────
  // Quota is per platform, so each platform fills up independently.
  const compUsed = competitors.reduce<Partial<Record<Platform, number>>>((acc, c) => {
    acc[c.platform] = (acc[c.platform] ?? 0) + 1
    return acc
  }, {})

  function addCompetitor() {
    const u = compUsername.trim().replace(/^@/, '')
    if (!u) { setCompErr('Enter a username.'); return }
    // Cermin validasi server: handle berspasi bikin actor Apify menolak start-run.
    if (!isValidHandle(compPlatform, u)) { setCompErr(invalidHandleMessage(compPlatform, u)); return }
    if ((compUsed[compPlatform] ?? 0) >= MAX_COMPETITORS_PER_PLATFORM) {
      setCompErr(competitorQuotaMessage(PLATFORM_CONFIG[compPlatform].label)); return
    }
    setCompetitors(prev => [...prev, { platform: compPlatform, username: u }])
    setCompUsername('')
    setCompErr('')
    compRef.current?.focus()
  }

  /**
   * Kirim semua competitor lalu TUNGGU keputusan Apify di dalam wizard.
   *
   * Verifikasinya paralel, bukan satu per satu: tiap akun butuh 15-60 detik, jadi
   * enam akun berurutan bisa enam menit. Paralel membuatnya selesai dalam waktu
   * satu akun terlama.
   *
   * Mengembalikan username yang terbukti tidak ada. Yang lolos dan yang kelamaan
   * (dituntaskan sync harian) dianggap beres — hanya not-found yang menahan Finish,
   * karena hanya itu yang butuh tindakan user.
   */
  async function addAndVerifyCompetitors(bId: string): Promise<string[]> {
    setVerifying(true)
    setNotFound([])
    try {
      const created = await Promise.all(competitors.map(async c => {
        const res = await fetch(`/api/brands/${bId}/competitors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform: c.platform, username: c.username }),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          // Ditolak sebelum dibuat (format salah / pre-check / kuota) — pesannya
          // sudah spesifik dari server, jadi diperlakukan sama seperti not-found.
          throw new Error(json.error ?? `Gagal menambahkan @${c.username}.`)
        }
        return (await res.json()).data as CompetitorAccount
      }))

      const outcomes = await Promise.all(created.map(async comp => {
        if (comp.verification_status !== 'pending') return { comp, outcome: 'verified' as const }
        const outcome = await pollVerification(bId, comp.social_account_id)
        return { comp, outcome }
      }))

      return outcomes.filter(o => o.outcome === 'not_found').map(o => o.comp.username)
    } finally {
      setVerifying(false)
    }
  }

  async function handleFinish(skip: boolean) {
    if (!brandId) return
    setLoading(true); setError('')
    try {
      if (!skip && competitors.length > 0) {
        const failed = await addAndVerifyCompetitors(brandId)
        if (failed.length) {
          // Tetap di step 3 supaya username-nya bisa diperbaiki di tempat —
          // sama seperti modal Add Competitor. Brand-nya sudah dibuat di step 1,
          // jadi menutup wizard di sini hanya akan menyembunyikan masalahnya.
          setNotFound(failed)
          setError(
            failed.length === 1
              ? `Akun @${failed[0]} tidak ditemukan. Perbaiki atau hapus dari daftar, lalu Finish lagi.`
              : `${failed.length} akun tidak ditemukan. Perbaiki atau hapus dari daftar, lalu Finish lagi.`,
          )
          return
        }
      }
      const res  = await fetch(`/api/brands/${brandId}`)
      const json = await res.json()
      if (res.ok) onCreated(json.data)
      if (brandId && igConnected) {
        fetch(`/api/brands/${brandId}/instagram/initial-sync`, { method: 'POST' })
          .catch(err => console.error('[ig initial-sync]', err))
      }
      if (brandId && ttConnected) {
        fetch(`/api/brands/${brandId}/tiktok/initial-sync`, { method: 'POST' })
          .catch(err => console.error('[tt initial-sync]', err))
      }
      if (brandId && fbConnected) {
        fetch(`/api/brands/${brandId}/facebook/initial-sync`, { method: 'POST' })
          .catch(err => console.error('[fb initial-sync]', err))
      }
      onClose()
    } catch (err) {
      // Pesan dari server (format handle salah, pre-check, kuota) jauh lebih
      // berguna daripada "Something went wrong" — jangan ditelan.
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />

      <div className="relative bg-white rounded-xl w-full max-w-[500px] mx-4 shadow-xl shadow-black/8 border border-[#e5e7eb]">

        {/* Header */}
        <div className="px-6 pt-5 pb-0">
          <h2 style={PJB} className="text-[15px] font-bold text-[#111827]">New Brand</h2>
          <p className="text-[13px] text-[#9ca3af] mt-0.5">Set up your brand in a few quick steps.</p>
        </div>

        <StepIndicator step={step} />
        <div className="border-t border-[#f3f4f6]" />

        {/* ── Step 1: Brand Name ── */}
        {step === 1 && (
          <div className="px-6 py-5 flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <div style={{ width: 40, height: 40, background: '#285D6E', borderRadius: 10, fontSize: 14 }}
                className="flex items-center justify-center flex-shrink-0 font-bold text-white leading-none select-none">
                {initials}
              </div>
              <div>
                <p style={PJB} className="text-[14px] font-bold text-[#111827]">{name || 'Brand name'}</p>
                <p className="text-[11px] text-[#9ca3af] mt-0.5">0 accounts · 0 competitors</p>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label style={PJB} className="text-[11px] font-bold uppercase tracking-widest text-[#6b7280]">
                Brand name
              </label>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={e => { setName(e.target.value); setNameErr('') }}
                onKeyDown={e => e.key === 'Enter' && handleStep1()}
                placeholder="e.g. Nike Indonesia"
                maxLength={80}
                className={`h-9 px-3 text-[13.5px] text-[#111827] placeholder:text-[#d1d5db] bg-white border rounded-lg outline-none transition-all ${
                  nameErr
                    ? 'border-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-100'
                    : 'border-[#e5e7eb] focus:border-[#285D6E] focus:ring-2 focus:ring-[#285D6E]/10'
                }`}
              />
              {nameErr && <p className="text-[12px] text-red-500">{nameErr}</p>}
            </div>
            {error && <p className="text-[12px] text-red-500">{error}</p>}
          </div>
        )}

        {/* ── Step 2: Confirm Account ── */}
        {step === 2 && pending && (
          <div className="px-6 py-6 flex flex-col gap-4">
            <div>
              <p style={PJB} className="text-[13px] font-semibold text-[#111827]">Confirm account</p>
              <p className="text-[12px] text-[#9ca3af] mt-0.5">Connect this account to your brand?</p>
            </div>
            <div className="flex items-center gap-4 w-full bg-[#f9fafb] rounded-xl px-4 py-3.5 border border-[#f3f4f6]">
              {pending.payload.avatarUrl ? (
                <Image src={pending.payload.avatarUrl} alt={pending.payload.username} width={44} height={44}
                  className="rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-11 h-11 rounded-full bg-[#e5e7eb] flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[22px] text-[#9ca3af]">person</span>
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <span style={PJB} className="text-[13px] font-semibold text-[#111827] truncate">
                  @{pending.payload.username}
                </span>
                <span style={PJB} className="text-[11px] text-[#9ca3af] capitalize">{pending.payload.platform}</span>
              </div>
              <div className="ml-auto shrink-0">
                <PlatformIcon platform={pending.payload.platform as Platform} size={24} />
              </div>
            </div>
            {oauthError && <p className="text-[12px] text-red-500">{oauthError}</p>}
          </div>
        )}

        {/* ── Step 2: Connect Accounts ── */}
        {step === 2 && !pending && (
          <div className="px-6 py-5 flex flex-col gap-3">
            <div>
              <p style={PJB} className="text-[13px] font-semibold text-[#111827]">Connect social accounts</p>
              <p className="text-[12px] text-[#9ca3af] mt-0.5">Connect the platforms you want to track for this brand.</p>
            </div>

            <div className="flex flex-col gap-2">
              {CONNECT_OPTIONS.map(opt => {
                const connected    = accounts.find(a => a.platform === opt.platform && a.methodId === opt.id)
                const platformTaken = !connected && accounts.some(a => a.platform === opt.platform)

                return (
                  <div key={opt.id} className={`rounded-xl border transition-colors ${
                    connected
                      ? 'border-emerald-200 bg-emerald-50/30'
                      : platformTaken
                        ? 'border-[#e5e7eb] opacity-40 pointer-events-none'
                        : 'border-[#e5e7eb] bg-white'
                  }`}>
                    <div className="flex items-center gap-3 px-4 h-[54px]">
                      <PlatformIcon platform={opt.platform} size={30} />

                      <span style={PJB} className="text-[13px] font-semibold text-[#111827] flex-1 leading-tight">
                        {opt.label}
                      </span>

                      {connected ? (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {connected.avatarUrl && (
                            <img src={connected.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
                          )}
                          <span style={PJB} className="text-[11.5px] text-[#374151] max-w-[72px] truncate">
                            @{connected.username}
                          </span>
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                            Connected
                          </span>
                          <button type="button" onClick={() => removeAccount(opt.platform)}
                            className="text-[#9ca3af] hover:text-red-400 transition-colors ml-0.5">
                            <span className="material-symbols-outlined text-[15px]">close</span>
                          </button>
                        </div>
                      ) : platformTaken ? (
                        <span style={PJB} className="text-[11px] text-[#9ca3af] flex-shrink-0">Already connected</span>
                      ) : opt.method === 'manual' ? (
                        <button type="button" onClick={() => setTiktokOpen(o => !o)} style={PJB}
                          className="flex items-center gap-0.5 text-[12.5px] font-semibold text-[#285D6E] flex-shrink-0">
                          Connect
                          <span className="material-symbols-outlined text-[15px]">
                            {tiktokOpen ? 'expand_less' : 'chevron_right'}
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={oauthLoading}
                          onClick={() => connectAccount(opt)}
                          style={PJB}
                          className="flex items-center gap-0.5 text-[12.5px] font-semibold text-[#285D6E] disabled:opacity-40 flex-shrink-0"
                        >
                          Connect
                          <span className="material-symbols-outlined text-[15px]">chevron_right</span>
                        </button>
                      )}
                    </div>

                    {/* TikTok inline username input */}
                    {opt.method === 'manual' && tiktokOpen && !connected && !platformTaken && (
                      <div className="border-t border-[#f3f4f6] px-4 py-3 flex gap-2">
                        <input
                          autoFocus
                          type="text"
                          value={tiktokInput}
                          onChange={e => setTiktokInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && addTiktokAccount()}
                          placeholder="@username on TikTok"
                          className="flex-1 h-8 px-3 text-[12.5px] text-[#111827] placeholder:text-[#d1d5db] bg-white border border-[#e5e7eb] rounded-lg outline-none focus:border-[#285D6E] focus:ring-2 focus:ring-[#285D6E]/10 transition-all"
                        />
                        <button type="button" onClick={addTiktokAccount} style={PJB}
                          className="h-8 px-3 bg-[#f3f4f6] hover:bg-[#e5e7eb] text-[12.5px] font-semibold text-[#374151] rounded-lg transition-colors flex-shrink-0">
                          Add
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* ── Sumber ketiga: data manual ──
                Untuk brand yang tidak punya akses akun resmi Meta/TikTok. Di sini
                CUKUP username-nya; filenya diupload belakangan di tab Data
                Sources. Alasannya: pembuatan brand harus tetap ringan, sementara
                upload data itu pekerjaan berulang tiap periode yang butuh ruang
                sendiri (grid per file, pratinjau, riwayat). */}
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
                      const taken = accounts.some(a => a.platform === p)
                      return (
                        <button
                          key={p}
                          type="button"
                          disabled={taken}
                          title={taken ? `${p} sudah punya akun di brand ini` : undefined}
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
                      onChange={e => { setCsvInput(e.target.value); setCsvErr('') }}
                      onKeyDown={e => e.key === 'Enter' && addCsvAccount()}
                      placeholder={`@username di ${PLATFORM_CONFIG[csvPlatform].label}`}
                      className="flex-1 h-8 px-3 text-[12.5px] text-[#111827] placeholder:text-[#d1d5db] bg-white border border-[#e5e7eb] rounded-lg outline-none focus:border-[#285D6E] focus:ring-2 focus:ring-[#285D6E]/10 transition-all"
                    />
                    <button type="button" onClick={addCsvAccount} style={PJB}
                      className="h-8 px-3 bg-[#f3f4f6] hover:bg-[#e5e7eb] text-[12.5px] font-semibold text-[#374151] rounded-lg transition-colors flex-shrink-0">
                      Tambah
                    </button>
                  </div>
                  {csvErr && <p className="text-[11px] text-red-500">{csvErr}</p>}
                  <p className="text-[11px] text-[#9ca3af]">
                    Filenya diupload nanti di tab <span className="font-semibold text-[#6b7280]">Data Sources</span> pada halaman brand.
                  </p>
                </div>
              )}

              {csvAccounts.length > 0 && (
                <div className="border-t border-[#f3f4f6] px-4 py-2.5 flex flex-col gap-1.5">
                  {csvAccounts.map(a => (
                    <div key={a.platform} className="flex items-center gap-2">
                      <PlatformIcon platform={a.platform} size={16} />
                      <span style={PJB} className="text-[12.5px] text-[#111827] flex-1 truncate">
                        @{a.username}
                      </span>
                      <span className="text-[10px] font-bold text-[#285D6E] bg-[#285D6E]/10 px-1.5 py-0.5 rounded-full">
                        Manual
                      </span>
                      <button type="button" onClick={() => removeAccount(a.platform)}
                        className="text-[#9ca3af] hover:text-red-400 transition-colors">
                        <span className="material-symbols-outlined text-[15px]">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {oauthError && <p className="text-[12px] text-red-500">{oauthError}</p>}
            {error      && <p className="text-[12px] text-red-500">{error}</p>}
          </div>
        )}

        {/* ── Step 3: Add Competitors ── */}
        {step === 3 && (
          <div className="px-6 py-5 flex flex-col gap-4">
            <div>
              <p style={PJB} className="text-[13px] font-semibold text-[#111827]">Add competitors</p>
              <p className="text-[12px] text-[#9ca3af] mt-0.5">
                Track competitor accounts to benchmark against — up to {MAX_COMPETITORS_PER_PLATFORM} per platform.
              </p>
            </div>

            {COMPETITOR_ADD_ENABLED ? (
              <>
                <PlatformPicker used={compUsed} selected={compPlatform} onSelect={p => { setCompPlatform(p); setCompErr('') }} />

                <div className="flex gap-2">
                  <div className="flex-1 flex flex-col gap-1">
                    <input
                      ref={compRef}
                      type="text"
                      value={compUsername}
                      onChange={e => { setCompUsername(e.target.value); setCompErr('') }}
                      onKeyDown={e => e.key === 'Enter' && addCompetitor()}
                      placeholder={`@username on ${PLATFORM_CONFIG[compPlatform].label}`}
                      className={`h-9 px-3 text-[13px] text-[#111827] placeholder:text-[#d1d5db] bg-white border rounded-lg outline-none transition-all ${
                        compErr
                          ? 'border-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-100'
                          : 'border-[#e5e7eb] focus:border-[#285D6E] focus:ring-2 focus:ring-[#285D6E]/10'
                      }`}
                    />
                    {compErr && <p className="text-[11px] text-red-500">{compErr}</p>}
                  </div>
                  <button type="button" onClick={addCompetitor} style={PJB}
                    className="h-9 px-3.5 bg-[#f3f4f6] hover:bg-[#e5e7eb] text-[13px] font-semibold text-[#374151] rounded-lg transition-colors flex-shrink-0 self-start">
                    Add
                  </button>
                </div>

                <AddedList
                  items={competitors}
                  onRemove={i => {
                    const gone = competitors[i]?.username
                    setCompetitors(prev => prev.filter((_, idx) => idx !== i))
                    setNotFound(prev => prev.filter(u => u !== gone))
                    setError('')
                  }}
                  emptyLabel="No competitors added yet."
                  notFound={notFound}
                  busy={verifying}
                />

                {verifying && (
                  <div className="flex items-start gap-2.5 px-3 py-2.5 bg-[#f0f7f5] border border-[#cfe6e1] rounded-lg">
                    <span className="material-symbols-outlined text-[16px] text-[#285D6E] animate-spin flex-shrink-0">
                      progress_activity
                    </span>
                    <p className="text-[12px] text-[#22615c] leading-relaxed">
                      Memeriksa apakah akun-akun ini benar-benar ada… biasanya 10–60 detik.
                      <span className="block text-[11px] text-[#5c8a84] mt-0.5">
                        Brand-nya sudah tersimpan — ini langkah terakhir.
                      </span>
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-[#e5e7eb] bg-[#fafafa] px-4 py-6 flex flex-col items-center text-center gap-1">
                <span className="material-symbols-outlined text-[28px] text-[#cbd1d8]">block</span>
                <p style={PJB} className="text-[13px] font-semibold text-[#374151]">Penambahan competitor dinonaktifkan sementara</p>
                <p className="text-[12px] text-[#9ca3af]">Lewati langkah ini — bisa diaktifkan lagi nanti.</p>
              </div>
            )}

            {error && <p className="text-[12px] text-red-500">{error}</p>}
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-[#f3f4f6]" />
        <div className="px-6 py-4 flex items-center justify-between">

          {step === 1 && (
            <>
              <button type="button" onClick={onClose}
                className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors">
                Cancel
              </button>
              <button type="button" onClick={handleStep1} disabled={!name.trim() || loading} style={PJB}
                className="h-8 px-4 bg-[#285D6E] hover:bg-[#1E4A58] disabled:opacity-40 text-white text-[13px] font-semibold rounded-lg transition-colors flex items-center gap-1.5">
                {loading ? 'Creating…' : <><span>Next</span><span className="material-symbols-outlined text-[14px]">arrow_forward</span></>}
              </button>
            </>
          )}

          {step === 2 && pending && (
            <>
              <button type="button" onClick={reset} disabled={oauthLoading} style={PJB}
                className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors disabled:opacity-40">
                Ganti Akun
              </button>
              <button type="button" disabled={oauthLoading} style={PJB}
                onClick={() => confirmAccount(CONNECT_OPTIONS.find(o => o.method === pending.method) ?? CONNECT_OPTIONS[0])}
                className="h-8 px-4 bg-[#111827] hover:bg-[#1f2937] disabled:opacity-50 text-white text-[13px] font-semibold rounded-lg transition-colors flex items-center gap-2">
                {oauthLoading ? (
                  <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Menghubungkan...</>
                ) : 'Connect'}
              </button>
            </>
          )}

          {step === 2 && !pending && (
            <>
              <button type="button" onClick={() => handleStep2(true)} disabled={loading} style={PJB}
                className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors disabled:opacity-40">
                Skip
              </button>
              <button type="button" onClick={() => handleStep2(false)} disabled={loading} style={PJB}
                className="h-8 px-4 bg-[#285D6E] hover:bg-[#1E4A58] disabled:opacity-40 text-white text-[13px] font-semibold rounded-lg transition-colors flex items-center gap-1.5">
                {loading ? 'Saving…' : <><span>Next</span><span className="material-symbols-outlined text-[14px]">arrow_forward</span></>}
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <button type="button" onClick={() => handleFinish(true)} disabled={loading} style={PJB}
                className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-lg transition-colors disabled:opacity-40">
                Skip
              </button>
              <button type="button" onClick={() => handleFinish(false)} disabled={loading} style={PJB}
                className="h-8 px-4 bg-[#285D6E] hover:bg-[#1E4A58] disabled:opacity-40 text-white text-[13px] font-semibold rounded-lg transition-colors flex items-center gap-1.5">
                {verifying ? 'Memeriksa…'
                  : loading ? 'Saving…'
                  : <><span>Finish</span><span className="material-symbols-outlined text-[14px]">check</span></>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
