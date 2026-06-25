// Dummy export history for the Reports landing page.
//
// There is no persistence yet — exports are client-side PPTX downloads — so this
// seeds the history grid with realistic placeholder records. Each row carries
// everything the card needs, including the template + colors used to render a
// live cover thumbnail (reusing COVER_TEMPLATES.background).
import { BRANDS } from '@/components/dashboard/data'
import { CoverColors, CoverMode } from '../cover/colors'

export interface ReportRecord {
  id: string
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
}

const DAY = 86_400_000
const now = Date.now()

// brandId → its default cover palette (mirrors ReportBuilder defaults)
function palette(brandId: string): CoverColors {
  const brand = BRANDS.find(b => b.id === brandId) ?? BRANDS[0]
  return { primary: brand.color, secondary: '#3d7e96', accent: '#e0a458' }
}

export const REPORT_HISTORY: ReportRecord[] = [
  {
    id: 'r1', title: 'Social Media Performance Report', subtitle: 'Monthly Analytics & Insights',
    brandId: 'b1', templateId: 'diagonal', mode: 'light', month: 'May', year: 2026,
    exportedAt: now - 2 * DAY, sizeKb: 842, colors: palette('b1'),
  },
  {
    id: 'r2', title: 'Q1 Campaign Recap', subtitle: 'Paid & Organic Breakdown',
    brandId: 'b2', templateId: 'gradient', mode: 'dark', month: 'April', year: 2026,
    exportedAt: now - 9 * DAY, sizeKb: 1124, colors: palette('b2'),
  },
  {
    id: 'r3', title: 'Audience Growth Review', subtitle: 'Follower & Reach Trends',
    brandId: 'b3', templateId: 'editorial', mode: 'light', month: 'April', year: 2026,
    exportedAt: now - 14 * DAY, sizeKb: 690, colors: palette('b3'),
  },
  {
    id: 'r4', title: 'Content Strategy Report', subtitle: 'Pillars & Best Performers',
    brandId: 'b4', templateId: 'sidebar', mode: 'light', month: 'March', year: 2026,
    exportedAt: now - 21 * DAY, sizeKb: 933, colors: palette('b4'),
  },
  {
    id: 'r5', title: 'Social Media Performance Report', subtitle: 'Monthly Analytics & Insights',
    brandId: 'b1', templateId: 'minimal', mode: 'light', month: 'March', year: 2026,
    exportedAt: now - 33 * DAY, sizeKb: 758, colors: palette('b1'),
  },
  {
    id: 'r6', title: 'TikTok Deep Dive', subtitle: 'Short-form Video Performance',
    brandId: 'b2', templateId: 'blocks', mode: 'dark', month: 'February', year: 2026,
    exportedAt: now - 47 * DAY, sizeKb: 1015, colors: palette('b2'),
  },
]

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
