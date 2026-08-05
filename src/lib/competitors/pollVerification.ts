import type { CompetitorAccount } from '@/lib/brands/types'

export type VerifyOutcome = 'verified' | 'not_found' | 'timeout'

/**
 * Batas menunggu di depan user: 2 menit, bukan 8 menit seperti cap satu Apify run.
 * Dasarnya hasil terukur — 7s (FB tidak ada), 15s (IG tidak ada), 49-59s (IG asli
 * dengan 41 post). Lewat 2 menit lebih baik dilepas ke sync harian daripada
 * menahan user di depan spinner.
 */
const DEADLINE_MS = 120_000
const INTERVAL_MS = 4_000

/**
 * Tunggu server memutuskan satu competitor: ada, tidak ada, atau kelamaan.
 *
 * Dipakai BERSAMA oleh modal Add Competitor dan wizard Create Brand supaya
 * keduanya berperilaku identik — itu inti masalahnya sebelum ini: wizard
 * menutup diri lalu memverifikasi di latar, sementara modal menunggu.
 *
 * Cara tahunya lewat menghilangnya baris, bukan lewat flag: kalau akunnya
 * terbukti tidak ada, server MELEPAS link competitor-nya (tidak ada status
 * 'invalid'), jadi lenyap dari daftar = jawaban 'not_found'.
 */
export async function pollVerification(
  brandId: string,
  socialAccountId: string,
  opts: {
    /** Dipanggil tiap kali baris terbaru terbaca — untuk sinkronkan state UI. */
    onFresh?: (comp: CompetitorAccount) => void
    deadlineMs?: number
  } = {},
): Promise<VerifyOutcome> {
  const deadline = Date.now() + (opts.deadlineMs ?? DEADLINE_MS)

  while (true) {
    await new Promise(r => setTimeout(r, INTERVAL_MS))

    let list: CompetitorAccount[] | null = null
    try {
      const res = await fetch(`/api/brands/${brandId}/competitors`)
      if (res.ok) list = (await res.json()).data as CompetitorAccount[]
    } catch {
      // Gangguan jaringan sesaat bukan jawaban — coba lagi sampai deadline.
    }

    if (list) {
      const fresh = list.find(c => c.social_account_id === socialAccountId)
      if (!fresh) return 'not_found'
      opts.onFresh?.(fresh)
      if (fresh.verification_status !== 'pending') return 'verified'
    }

    if (Date.now() > deadline) return 'timeout'
  }
}
