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

export const BRAND_COLORS = ['#3d7e96', '#7c5cbf', '#059669', '#d97706', '#e11d48', '#2563eb', '#db2777', '#0891b2']

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
}

export interface CompetitorAccount {
  social_account_id: string
  platform: Platform
  username: string
  avatar_url: string | null
  profile_url: string | null
}

export interface Brand {
  id: string
  organization_id: string
  name: string
  created_at: string
  accounts: SocialAccount[]
  competitors: CompetitorAccount[]
}
