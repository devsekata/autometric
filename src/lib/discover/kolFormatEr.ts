import type { GoldFormatDay } from './kolGold'

/**
 * The format mix and per-format ER over `l2_gold.content_format_daily` rows.
 *
 * Pure, and kept out of `kolGold` (which imports the database pool) so the
 * Content tab can call it from the browser and a verify script can call the
 * very same function against live rows.
 *
 * ER per format is `sum(engagement) / sum(followersDenom)`, never the mean of
 * the daily `erFollowers`: a ratio is not additive, and the pipeline makes the
 * same choice for its monthly ER.
 *
 * Both sums run over the SAME days — only those whose `followersDenom` is
 * present and positive. `gold_post.py` still fills `engagement_sum` on a day
 * with no follower snapshot before it, so summing engagement over every day
 * against a denominator from only some of them inflated the ratio (the @iben_ma
 * audit, Sep 2026: `clips` read 3.21% against a valid 2.29%).
 * `npm run verify:profile-real` re-checks this against live rows.
 */
export interface FormatErRow {
  mediaType: string
  posts: number
  inSample: number
  /** Engagement over the days that carry a denominator; null when none do. */
  engagement: number | null
  denom: number | null
  views: number | null
  /** Fraction 0..1. Null when no day for this format had a follower snapshot. */
  er: number | null
}

/** Sums that keep null meaning "never measured" instead of collapsing it to 0. */
const addNullable = (a: number | null, b: number | null): number | null =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0)

export function formatErRows(formats: GoldFormatDay[]): FormatErRow[] {
  const by = new Map<string, Omit<FormatErRow, 'mediaType' | 'er'>>()
  for (const f of formats) {
    const cur = by.get(f.mediaType)
      ?? { posts: 0, inSample: 0, engagement: null, denom: null, views: null }
    cur.posts += f.postCount
    cur.inSample += f.postsInSample
    if (f.engagement !== null && f.followersDenom !== null && f.followersDenom > 0) {
      cur.engagement = addNullable(cur.engagement, f.engagement)
      cur.denom = addNullable(cur.denom, f.followersDenom)
    }
    cur.views = addNullable(cur.views, f.views)
    by.set(f.mediaType, cur)
  }
  return [...by.entries()]
    .map(([mediaType, v]) => ({
      mediaType,
      ...v,
      er: v.engagement !== null && v.denom !== null && v.denom > 0
        ? v.engagement / v.denom
        : null,
    }))
    .sort((a, b) => b.posts - a.posts)
}
