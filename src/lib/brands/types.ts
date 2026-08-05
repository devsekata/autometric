export type Platform = 'instagram' | 'tiktok' | 'facebook' | 'youtube' | 'twitter'

export interface PlatformConfig {
  label: string
  short: string
  bg: string
  textColor: string
}

export const PLATFORM_CONFIG: Record<Platform, PlatformConfig> = {
  instagram: { label: 'Instagram',   short: 'IG', bg: 'linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)', textColor: 'white' },
  tiktok:    { label: 'TikTok',      short: 'TT', bg: '#010101',  textColor: 'white' },
  facebook:  { label: 'Facebook',    short: 'fb', bg: '#1877f2',  textColor: 'white' },
  youtube:   { label: 'YouTube',     short: 'YT', bg: '#ff0000',  textColor: 'white' },
  twitter:   { label: 'X (Twitter)', short: 'X',  bg: '#14171a',  textColor: 'white' },
}

export const PLATFORM_LIST: Platform[] = ['instagram', 'tiktok', 'facebook', 'youtube', 'twitter']

export const BRAND_COLORS = ['#1B8A80', '#7c5cbf', '#059669', '#d97706', '#e11d48', '#2563eb', '#db2777', '#0891b2']

export function getColorFromId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash)
  return BRAND_COLORS[Math.abs(hash) % BRAND_COLORS.length]
}

export interface SocialAccount {
  id: string
  platform: Platform
  username: string
  avatar_url: string | null
  profile_url: string | null
  connected: boolean
  connected_at: string | null
  /**
   * 'csv' = akun tanpa token, datanya diunggah manual. `connected` selalu false
   * untuk akun seperti ini, jadi tanpa kolom ini UI tidak bisa membedakannya
   * dari akun OAuth yang tokennya kedaluwarsa — dua hal yang sangat berbeda.
   */
  data_source?: 'api' | 'csv'
}

export interface CompetitorAccount {
  social_account_id: string
  platform: Platform
  username: string
  avatar_url: string | null
  profile_url: string | null
  is_new_account?: boolean
  /**
   * 'pending' = Apify masih memverifikasi akunnya benar-benar ada. Kalau ternyata
   * tidak ada, linknya dihapus — jadi tidak ada state 'invalid' yang perlu
   * ditampilkan, cuma spinner sementara.
   */
  verification_status?: 'pending' | 'verified'
}

export interface Brand {
  id: string
  organization_id: string
  name: string
  profile_url: string | null
  created_at: string
  accounts: SocialAccount[]
  competitors: CompetitorAccount[]
}
