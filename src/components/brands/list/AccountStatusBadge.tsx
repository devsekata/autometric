import { SocialAccount } from '@/lib/brands/types'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

/**
 * Status satu akun brand — TIGA keadaan, bukan dua.
 *
 * Akun bersumber CSV selalu `connected = false` (tidak punya token, dan itu yang
 * membuat scheduler melewatinya), jadi kalau hanya `connected` yang dibaca dia
 * tampil "Disconnected" merah seolah rusak. Padahal itu keadaan normal dan
 * memang disengaja: datanya masuk lewat unggahan manual, bukan OAuth.
 *
 * `data_source` yang membedakan keduanya — lihat migrations/040_csv-data-source.sql.
 */
export default function AccountStatusBadge({ account }: { account: SocialAccount }) {
  const style = account.connected
    ? { bg: 'bg-[#ecfdf5]', text: 'text-[#059669]', dot: 'bg-[#10b981]', label: 'Connected' }
    : account.data_source === 'csv'
      ? { bg: 'bg-[#fffbeb]', text: 'text-[#b45309]', dot: 'bg-[#f59e0b]', label: 'Manual Upload' }
      : { bg: 'bg-[#fef2f2]', text: 'text-[#dc2626]', dot: 'bg-[#ef4444]', label: 'Disconnected' }

  return (
    <span style={PJB}
      title={account.data_source === 'csv' && !account.connected
        ? 'Data diunggah manual (CSV/FPK) — bukan koneksi OAuth, jadi tidak perlu dihubungkan'
        : undefined}
      className={`inline-flex items-center gap-1.5 h-[20px] px-2 rounded-full text-[10.5px] font-semibold ${style.bg} ${style.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot} flex-shrink-0`} />
      {style.label}
    </span>
  )
}
