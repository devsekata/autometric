'use client'

import { createContext, useContext, useState } from 'react'
import { Brand, CompetitorAccount, Platform, PLATFORM_CONFIG, SocialAccount } from '@/lib/brands/types'
import { pollVerification, type VerifyOutcome } from '@/lib/competitors/pollVerification'

/** Pesan sekali-pakai soal competitor. `warn` = ada yang dihapus; `info` = sekadar kabar. */
export interface CompetitorNotice {
  tone: 'warn' | 'info'
  text: string
}

interface BrandDetailCtx {
  brand: Brand
  orgName: string
  addAccount: (account: SocialAccount) => void
  disconnectAccount: (accountId: string) => Promise<void>
  /** Membuat baris competitor (status 'pending'); tidak menunggu verifikasi. */
  addCompetitor: (platform: Platform, username: string) => Promise<CompetitorAccount>
  /** Menunggu keputusan Apify, supaya modal Add bisa tetap terbuka. */
  awaitCompetitorVerification: (
    comp: CompetitorAccount, modalOpen?: () => boolean,
  ) => Promise<VerifyOutcome>
  removeCompetitor: (socialAccountId: string) => Promise<void>
  updateBrandName: (name: string) => Promise<void>
  deleteBrand: () => Promise<void>
  /** Hasil verifikasi competitor yang menyusul di background. */
  competitorNotice: CompetitorNotice | null
  clearCompetitorNotice: () => void
}

const Ctx = createContext<BrandDetailCtx | null>(null)

export function BrandDetailProvider({
  initial,
  orgName,
  children,
}: {
  initial: Brand
  orgName: string
  children: React.ReactNode
}) {
  const [brand, setBrand] = useState<Brand>(initial)
  const [competitorNotice, setCompetitorNotice] = useState<CompetitorNotice | null>(null)

  function addAccount(account: SocialAccount) {
    setBrand(b => ({
      ...b,
      profile_url: b.profile_url ?? account.avatar_url,
      accounts: [...b.accounts, account],
    }))
  }

  async function disconnectAccount(accountId: string) {
    const res = await fetch(`/api/brands/${brand.id}/accounts/${accountId}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to disconnect account')
    setBrand(b => ({ ...b, accounts: b.accounts.filter(a => a.id !== accountId) }))
  }

  /**
   * Buat competitor-nya. Sengaja TIDAK menunggu verifikasi dan tidak memulai
   * polling — pemanggilnya (modal) yang menentukan mau menunggu atau tidak.
   */
  async function addCompetitor(platform: Platform, username: string): Promise<CompetitorAccount> {
    const res = await fetch(`/api/brands/${brand.id}/competitors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, username }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error ?? 'Failed to add competitor')
    }
    const { data } = await res.json() as { data: CompetitorAccount }
    setBrand(b => ({ ...b, competitors: [...b.competitors, data] }))
    return data
  }

  const fetchCompetitors = async (): Promise<CompetitorAccount[] | null> => {
    try {
      const res = await fetch(`/api/brands/${brand.id}/competitors`)
      if (!res.ok) return null
      const { data } = await res.json()
      return data as CompetitorAccount[]
    } catch { return null }
  }

  function patchCompetitor(id: string, fresh: CompetitorAccount) {
    setBrand(b => ({
      ...b,
      competitors: b.competitors.map(c => c.social_account_id === id
        ? {
            ...c,
            avatar_url:          fresh.avatar_url ?? c.avatar_url,
            profile_url:         fresh.profile_url ?? c.profile_url,
            verification_status: fresh.verification_status ?? c.verification_status,
          }
        : c),
    }))
  }

  /**
   * Tunggu Apify memutuskan akunnya ada atau tidak.
   *
   * Dipanggil dari modal Add Competitor dan ditunggu, supaya modalnya tetap
   * terbuka selama pemeriksaan dan hasilnya bisa ditampilkan di tempat — user
   * yang salah ketik langsung bisa memperbaikinya tanpa membuka modal lagi.
   *
   * Polling-nya sendiri ada di @/lib/competitors/pollVerification, dipakai bersama
   * wizard Create Brand supaya kedua jalur berperilaku identik. Yang khusus di
   * sini cuma efek sampingnya: sinkronisasi state brand dan pemilihan pesan.
   */
  async function awaitCompetitorVerification(
    comp: CompetitorAccount,
    /**
     * Apakah modal Add masih terbuka? Menentukan SIAPA yang menyampaikan hasil
     * negatifnya: kalau masih terbuka, modal menampilkannya inline; kalau sudah
     * ditutup, banner yang mengambil alih. Tanpa ini, menutup modal di tengah
     * pemeriksaan membuat pesannya hilang tanpa jejak.
     */
    modalOpen?: () => boolean,
  ): Promise<VerifyOutcome> {
    const id = comp.social_account_id
    const who = `@${comp.username}`
    const platformLabel = PLATFORM_CONFIG[comp.platform]?.label ?? comp.platform

    const outcome = await pollVerification(brand.id, id, {
      onFresh: fresh => patchCompetitor(id, fresh),
    })

    if (outcome === 'not_found') {
      setBrand(b => ({
        ...b,
        competitors: b.competitors.filter(c => c.social_account_id !== id),
      }))
      if (!modalOpen?.()) {
        setCompetitorNotice({
          tone: 'warn',
          text: `${who} dihapus otomatis — akun ${platformLabel} itu tidak ditemukan. ` +
                `Periksa lagi penulisan username-nya, lalu tambahkan kembali.`,
        })
      }
      return outcome
    }

    if (outcome === 'timeout') {
      setCompetitorNotice({
        tone: 'info',
        text: `Verifikasi ${who} (${platformLabel}) belum selesai — platform sedang lambat merespons. ` +
              `Sync harian akan menuntaskannya sendiri; tidak perlu ditambahkan ulang.`,
      })
    }

    // Avatar bisa menyusul setelah verifikasi selesai.
    pollCompetitorAvatar(id)
    return outcome
  }

  /**
   * Ekor background untuk avatar saja.
   *
   * Avatar di-upload ke Cloudinary setelah profilnya ditarik, jadi kadang baru
   * ada beberapa saat setelah statusnya 'verified'. Tidak memberi pesan apa pun:
   * avatar yang belum muncul bukan kegagalan, dan tampilannya sudah punya
   * fallback ikon platform.
   */
  function pollCompetitorAvatar(socialAccountId: string) {
    const INTERVAL_MS = 8_000
    const MAX_ATTEMPTS = 40 // ~5 menit
    let attempts = 0

    const tick = async () => {
      attempts++
      const list = await fetchCompetitors()
      const fresh = list?.find(c => c.social_account_id === socialAccountId)
      if (!fresh) return                       // sudah dilepas — bukan urusan sini
      if (fresh.avatar_url) { patchCompetitor(socialAccountId, fresh); return }
      if (fresh.verification_status !== 'pending') patchCompetitor(socialAccountId, fresh)
      if (attempts < MAX_ATTEMPTS) setTimeout(tick, INTERVAL_MS)
    }

    setTimeout(tick, INTERVAL_MS)
  }

  async function removeCompetitor(socialAccountId: string) {
    const res = await fetch(`/api/brands/${brand.id}/competitors/${socialAccountId}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to remove competitor')
    setBrand(b => ({ ...b, competitors: b.competitors.filter(c => c.social_account_id !== socialAccountId) }))
  }

  async function updateBrandName(name: string) {
    const res = await fetch(`/api/brands/${brand.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new Error('Failed to update brand')
    setBrand(b => ({ ...b, name }))
  }

  async function deleteBrand() {
    const res = await fetch(`/api/brands/${brand.id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete brand')
  }

  return (
    <Ctx.Provider value={{
      brand, orgName, addAccount, disconnectAccount, addCompetitor,
      awaitCompetitorVerification, removeCompetitor,
      updateBrandName, deleteBrand,
      competitorNotice, clearCompetitorNotice: () => setCompetitorNotice(null),
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useBrandDetail() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useBrandDetail must be inside BrandDetailProvider')
  return ctx
}
