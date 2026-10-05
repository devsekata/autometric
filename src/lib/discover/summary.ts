import pool from '@/lib/db'
import { BASE_CTE } from './content'

/**
 * Aggregates over the same brand+competitor corpus Discovery Content browses.
 *
 * One query set feeds the module's four analytical pages (Campaigns, Audience,
 * Reports, Settings) so they can never disagree with the grid or with each
 * other. Reusing BASE_CTE is deliberate: the union, the org scoping and the
 * format normalisation are defined once in content.ts.
 *
 * Scope note — the source platform's versions of these pages were built on
 * commercial KOL metrics (EMV, ROI, CPE, rate cards, agency margins). autometric
 * stores none of those: it is a social performance warehouse, not a marketplace.
 * They are therefore replaced by the performance dimensions the data really has
 * (reach/views/engagement, format, pillar, platform, campaign tagging) rather
 * than invented or defaulted to zero.
 */

export interface NamedCount {
  label: string
  posts: number
  views: number
  likes: number
  comments: number
  erPct: number
}

export interface DiscoverSummaryPayload {
  totals: { posts: number; views: number; likes: number; comments: number; shares: number; erPct: number }
  byPlatform: NamedCount[]
  byPillar: NamedCount[]
  byFormat: NamedCount[]
  bySource: NamedCount[]
  /** Campaign-tagged (is_campaign / is_boosted) vs the rest — brand posts only. */
  campaignSplit: NamedCount[]
  /** Monthly posting + views activity, oldest first. */
  timeline: { month: string; posts: number; views: number }[]
  topAuthors: NamedCount[]
  topPosts: {
    key: string; author: string; caption: string; platform: string
    format: string; views: number; likes: number; erPct: number; source: string
  }[]
}

const AGG = `
  COUNT(*)::int                          AS posts,
  COALESCE(SUM(views), 0)::bigint        AS views,
  COALESCE(SUM(likes), 0)::bigint        AS likes,
  COALESCE(SUM(comments), 0)::bigint     AS comments,
  COALESCE(AVG(er_pct), 0)::float        AS er_pct`

interface AggRow {
  label: string | null
  posts: number
  views: string
  likes: string
  comments: string
  er_pct: number
}

const toNamed = (rows: AggRow[]): NamedCount[] => rows.map(r => ({
  label: r.label ?? '—',
  posts: Number(r.posts ?? 0),
  views: Number(r.views ?? 0),
  likes: Number(r.likes ?? 0),
  comments: Number(r.comments ?? 0),
  erPct: Number(r.er_pct ?? 0),
}))

export async function getDiscoverSummary(
  orgId: string,
  brandId: string | null = null,
): Promise<DiscoverSummaryPayload> {
  const p = [orgId, brandId]

  const [totals, platform, pillar, format, source, campaign, timeline, authors, top] =
    await Promise.all([
      pool.query<{
        posts: number; views: string; likes: string; comments: string
        shares: string; er_pct: number
      }>(
        `${BASE_CTE}
         SELECT COUNT(*)::int posts,
                COALESCE(SUM(views),0)::bigint    views,
                COALESCE(SUM(likes),0)::bigint    likes,
                COALESCE(SUM(comments),0)::bigint comments,
                COALESCE(SUM(shares),0)::bigint   shares,
                COALESCE(AVG(er_pct),0)::float    er_pct
           FROM base`, p),

      pool.query<AggRow>(
        `${BASE_CTE} SELECT platform AS label, ${AGG} FROM base GROUP BY platform ORDER BY views DESC`, p),

      pool.query<AggRow>(
        `${BASE_CTE} SELECT pillar AS label, ${AGG} FROM base
          WHERE pillar IS NOT NULL GROUP BY pillar ORDER BY views DESC`, p),

      pool.query<AggRow>(
        `${BASE_CTE} SELECT format AS label, ${AGG} FROM base GROUP BY format ORDER BY views DESC`, p),

      pool.query<AggRow>(
        `${BASE_CTE} SELECT source AS label, ${AGG} FROM base GROUP BY source ORDER BY views DESC`, p),

      // Campaign tagging only exists on brand posts; competitor rows carry no
      // such flag, so they are excluded rather than silently counted as organic.
      pool.query<AggRow>(
        `${BASE_CTE}
         SELECT CASE WHEN sponsored THEN 'Campaign / Boosted' ELSE 'Organic' END AS label, ${AGG}
           FROM base WHERE source = 'brand' GROUP BY 1 ORDER BY views DESC`, p),

      pool.query<{ month: string; posts: number; views: string }>(
        `${BASE_CTE}
         SELECT to_char(date_trunc('month', post_date), 'YYYY-MM') AS month,
                COUNT(*)::int posts, COALESCE(SUM(views),0)::bigint views
           FROM base WHERE post_date IS NOT NULL
          GROUP BY 1 ORDER BY 1`, p),

      pool.query<AggRow>(
        `${BASE_CTE} SELECT author AS label, ${AGG} FROM base
          GROUP BY author ORDER BY views DESC LIMIT 10`, p),

      pool.query<{
        source: string; row_id: string; author: string; caption: string
        platform: string; format: string; views: string; likes: string; er_pct: number
      }>(
        `${BASE_CTE}
         SELECT source, row_id, author, caption, platform, format, views, likes, er_pct
           FROM base ORDER BY views DESC LIMIT 10`, p),
    ])

  const t = totals.rows[0]
  return {
    totals: {
      posts: Number(t?.posts ?? 0),
      views: Number(t?.views ?? 0),
      likes: Number(t?.likes ?? 0),
      comments: Number(t?.comments ?? 0),
      shares: Number(t?.shares ?? 0),
      erPct: Number(t?.er_pct ?? 0),
    },
    byPlatform: toNamed(platform.rows),
    byPillar: toNamed(pillar.rows),
    byFormat: toNamed(format.rows),
    bySource: toNamed(source.rows).map(r => ({
      ...r, label: r.label === 'brand' ? 'Brand kamu' : 'Kompetitor',
    })),
    campaignSplit: toNamed(campaign.rows),
    timeline: timeline.rows.map(r => ({
      month: r.month, posts: Number(r.posts ?? 0), views: Number(r.views ?? 0),
    })),
    topAuthors: toNamed(authors.rows),
    topPosts: top.rows.map(r => ({
      key: `${r.source}:${r.row_id}`,
      author: r.author ?? '—',
      caption: r.caption ?? '',
      platform: r.platform,
      format: r.format,
      views: Number(r.views ?? 0),
      likes: Number(r.likes ?? 0),
      erPct: Number(r.er_pct ?? 0),
      source: r.source,
    })),
  }
}
