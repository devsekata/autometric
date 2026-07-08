import pool from '@/lib/db'
import type { DashPlatform } from '@/components/dashboard/data'

/**
 * Gold-layer data access for the Campaign Analysis dashboard, scoped to one org.
 * Per docs §5 Campaign:
 *  - Post selection grid   : l2_gold.v_campaign_posts (brand_id = umbrella)
 *  - Comment timeline       : l2_gold.post_comment_timeline (by days_since_post)
 *  - Cleaned word cloud     : l2_gold.post_wordcloud (word × frequency)
 * Per-post contribution is computed client-side from the selected posts.
 */

export type PlatformParam = 'all' | DashPlatform

export interface CampaignPostRow {
  id: string
  platform: DashPlatform
  pillar: string
  boosted: boolean
  caption: string
  date: string
  likes: number
  comments: number
  er: number
  hashtags: string[]
}

export interface CampaignAnalysis {
  timeline: { label: string; value: number }[]
  wordcloud: { word: string; weight: number }[]
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const fmtDate = (iso: string) => { const [, m, d] = iso.split('-'); return `${+d} ${MONTH_ABBR[+m - 1]}` }
const hashtagsOf = (caption: string | null): string[] => (caption?.match(/#[\p{L}\p{N}_]+/gu) ?? []).slice(0, 4)

/** Campaign posts pool for the selection grid (recent posts, per brand + platform). */
export async function getCampaignPosts(orgId: string, platform: PlatformParam, brandId: string | null): Promise<CampaignPostRow[]> {
  const { rows } = await pool.query<{
    post_id: string; platform: DashPlatform; content_pillar: string | null; is_boosted: boolean
    caption: string | null; post_date: string; likes: number; comments: number; er: number | null
  }>(
    `SELECT v.post_id, v.platform, v.content_pillar, COALESCE(v.is_boosted,false) is_boosted,
            v.caption, to_char(v.post_date, 'YYYY-MM-DD') post_date,
            COALESCE(v.likes,0)::int likes, COALESCE(v.comments,0)::int comments,
            v.engagement_rate::float er
       FROM l2_gold.v_campaign_posts v
       JOIN public.brands b ON b.id = v.brand_id
      WHERE b.organization_id = $1 AND ($2 = 'all' OR v.platform = $2)
        AND ($3::uuid IS NULL OR v.brand_id = $3)
      ORDER BY v.post_date DESC NULLS LAST
      LIMIT 48`,
    [orgId, platform, brandId],
  )
  return rows.map(r => ({
    id: r.post_id,
    platform: r.platform,
    pillar: r.content_pillar ?? 'Uncategorized',
    boosted: r.is_boosted,
    caption: (r.caption ?? '').replace(/\s+/g, ' ').trim() || '(tanpa caption)',
    date: fmtDate(r.post_date),
    likes: r.likes,
    comments: r.comments,
    er: +(r.er ?? 0).toFixed(1),
    hashtags: hashtagsOf(r.caption),
  }))
}

/** Comment timeline + word cloud aggregated over the selected posts. */
export async function getCampaignAnalysis(postIds: string[]): Promise<CampaignAnalysis> {
  if (!postIds.length) return { timeline: [], wordcloud: [] }
  const [tl, wc] = await Promise.all([
    pool.query<{ d: number; cnt: number }>(
      `SELECT t.days_since_post d, SUM(t.comment_count)::int cnt
         FROM l2_gold.post_comment_timeline t
        WHERE t.post_id = ANY($1)
        GROUP BY t.days_since_post
        ORDER BY t.days_since_post`,
      [postIds],
    ),
    pool.query<{ word: string; freq: number }>(
      `SELECT pw.word, SUM(pw.frequency)::int freq
         FROM l2_gold.post_wordcloud pw
        WHERE pw.post_id = ANY($1)
        GROUP BY pw.word
        ORDER BY freq DESC
        LIMIT 40`,
      [postIds],
    ),
  ])
  const timeline = tl.rows.map(r => ({ label: `D${r.d}`, value: r.cnt }))
  const maxF = Math.max(...wc.rows.map(r => r.freq), 1)
  const wordcloud = wc.rows.map(r => ({ word: r.word, weight: r.freq / maxF }))
  return { timeline, wordcloud }
}
