/**
 * Kuota app-wide. Ubah nilai di sini untuk mengubah batas di seluruh aplikasi —
 * dipakai oleh API route (enforcement) dan UI (disable tombol / tampilkan sisa kuota).
 */

// Jumlah maksimum brand per organization.
export const MAX_BRANDS_PER_ORG = 3

// Jumlah maksimum competitor per platform, per brand. Dihitung terpisah tiap
// platform — satu brand boleh punya 2 competitor Instagram + 2 TikTok + 2 Facebook.
export const MAX_COMPETITORS_PER_PLATFORM = 2

export const BRAND_QUOTA_MESSAGE =
  `Brand limit reached — an organization can have at most ${MAX_BRANDS_PER_ORG} brands.`

export function competitorQuotaMessage(platformLabel: string): string {
  return `Competitor limit reached — a brand can track at most ${MAX_COMPETITORS_PER_PLATFORM} ${platformLabel} competitors.`
}
