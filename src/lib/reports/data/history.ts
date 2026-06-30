// Shared types + helpers for the Reports history grid. Records are now persisted
// per organization (see src/lib/reports/queries.ts) and loaded server-side; the
// `config` JSONB carries the template + colors used to render a live cover
// thumbnail (reusing COVER_TEMPLATES.background).
import { CoverColors, CoverMode } from '../cover/colors'

export interface ReportRecord {
  id: string
  /** Generated identifier name: brand_month-year_n */
  name: string
  title: string
  subtitle: string
  brandId: string
  templateId: string
  mode: CoverMode
  colors: CoverColors
  month: string
  year: number
  /** epoch ms of export */
  exportedAt: number
  sizeKb: number
  /** Cloudinary cover-preview URL; falls back to a live template render when absent. */
  coverImageUrl?: string
}

const DAY = 86_400_000

/** "2 days ago", "3 weeks ago", "today". */
export function relativeDate(ms: number): string {
  const diff = Date.now() - ms
  const days = Math.floor(diff / DAY)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks} week${weeks > 1 ? 's' : ''} ago`
  const months = Math.floor(days / 30)
  return `${months} month${months > 1 ? 's' : ''} ago`
}
