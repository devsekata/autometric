import kolDb from '@/lib/kolDb'

/**
 * The inputs What Matters scores, read from the KOL server and nothing else.
 *
 * ── One database ───────────────────────────────────────────────────────────
 * `@/lib/kolDb` throughout. Never `@/lib/db`: `l1_silver`, `l2_gold` and
 * `feature` exist on BOTH servers under the same names, so a query sent to the
 * warehouse pool would return different numbers without erroring once. The pool
 * is what decides which database a query lands in, not the table name.
 *
 * ── Where each criterion's inputs come from ────────────────────────────────
 *   engagement        public.kol_directory.engagement_rate
 *   audience quality  l2_gold.kol_profile_card.audience_quality_score
 *                       + .authenticity_score
 *   consistency       l2_gold.kol_profile_card.performance_stability
 *                       + .post_frequency_reliability
 *   community         audience_quality_score + engagement_rate
 *   reach             l2_gold.kol_profile_card.median_views
 *   content quality   engagement_rate + .format_dominant
 *                       + .content_topic + .content_topic_source
 *   brand safety      .authenticity_score + .follower_quality_score
 *                       + .is_verified + .paid_ratio
 *
 * Coverage is thin and the UI must say so rather than fill it: of 1.978 profile
 * cards, median_views 30, performance_stability 11, post_frequency_reliability
 * 49, audience_quality 27, format_dominant 49, content_topic 42.
 */

export interface WhatMattersRecord {
  engagementRate: number | null
  audienceQuality: number | null
  authenticity: number | null
  followerQuality: number | null
  performanceStability: string | null
  postFrequencyReliability: string | null
  medianViews: number | null
  formatDominant: string | null
  contentTopic: string | null
  contentTopicSource: string | null
  isVerified: boolean | null
  paidRatio: number | null
}

/**
 * The measured populations the percentile criteria rank against.
 *
 * Taken over the WHOLE active roster, not over the page. A percentile computed
 * against twenty rows would move a creator's score when someone pressed Next,
 * and "top 10% for engagement" would mean a different thing on every page. Both
 * arrays are cheap — engagement rate is measured for ~1.700 creators and median
 * views for ~30 — and nulls are excluded rather than counted as zero.
 */
export interface WhatMattersPopulation {
  er: number[]
  medianViews: number[]
}

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

/** Cached briefly: the population moves when the pipeline runs, not per request. */
let popCache: { at: number; value: WhatMattersPopulation } | null = null
const POP_TTL_MS = 5 * 60 * 1000

export function resetPopulationCache(): void { popCache = null }

export async function whatMattersPopulation(): Promise<WhatMattersPopulation> {
  if (popCache && Date.now() - popCache.at < POP_TTL_MS) return popCache.value

  const db = kolDb()
  const [er, views] = await Promise.all([
    db.query<{ v: string }>(`
      SELECT engagement_rate AS v
        FROM public.kol_directory
       WHERE directory_status = 'active' AND engagement_rate IS NOT NULL`),
    db.query<{ v: string }>(`
      SELECT median_views AS v
        FROM l2_gold.kol_profile_card
       WHERE median_views IS NOT NULL`),
  ])

  const value: WhatMattersPopulation = {
    er: er.rows.map(r => Number(r.v)).filter(Number.isFinite),
    medianViews: views.rows.map(r => Number(r.v)).filter(Number.isFinite),
  }
  popCache = { at: Date.now(), value }
  return value
}

/**
 * One record per requested creator, keyed by `kol_directory.id`.
 *
 * A creator the roster does not have is absent from the map rather than present
 * with an empty record: absent and unmeasured are different facts.
 */
export async function whatMattersRecordsFor(
  ids: string[],
): Promise<Map<string, WhatMattersRecord>> {
  const out = new Map<string, WhatMattersRecord>()
  const wanted = [...new Set(ids.filter(Boolean))]
  if (!wanted.length) return out

  const db = kolDb()
  const { rows } = await db.query<{
    id: string; er: string | null
    aq: string | null; auth: string | null; fq: string | null
    stability: string | null; reliability: string | null
    median_views: string | null; format_dominant: string | null
    content_topic: string | null; content_topic_source: string | null
    is_verified: boolean | null; paid_ratio: string | null
  }>(`
    SELECT kd.id,
           kd.engagement_rate AS er,
           pc.audience_quality_score  AS aq,
           pc.authenticity_score      AS auth,
           -- Follower quality lives ONLY in feature.*_audience_analysis; it is
           -- not a column on the profile card, which is why it is joined
           -- separately rather than read from pc like the others.
           aa.follower_quality_score  AS fq,
           pc.performance_stability   AS stability,
           pc.post_frequency_reliability AS reliability,
           pc.median_views,
           pc.format_dominant,
           pc.content_topic,
           pc.content_topic_source,
           pc.is_verified,
           pc.paid_ratio
      FROM public.kol_directory kd
      LEFT JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
      -- One card per creator: the freshest snapshot of whichever linked account
      -- has one. DISTINCT ON keeps a creator with two platforms from becoming
      -- two rows and being scored twice.
      LEFT JOIN LATERAL (
        SELECT * FROM l2_gold.kol_profile_card c
         WHERE c.social_account_id = ksa.social_account_id
         ORDER BY c.profile_snapshot_date DESC NULLS LAST
         LIMIT 1
      ) pc ON TRUE
      -- Both platforms carry the same four columns under different table
      -- names, and a creator is on one or the other. UNION ALL rather than a
      -- join per platform keeps this one row regardless.
      LEFT JOIN LATERAL (
        SELECT follower_quality_score FROM (
          SELECT social_account_id, follower_quality_score
            FROM feature.ig_audience_analysis
           UNION ALL
          SELECT social_account_id, follower_quality_score
            FROM feature.tt_audience_analysis
        ) u
         WHERE u.social_account_id = ksa.social_account_id
         LIMIT 1
      ) aa ON TRUE
     WHERE kd.id = ANY ($1::uuid[])`, [wanted])

  for (const r of rows) {
    // A creator with two linked accounts yields two rows; the first one that
    // carries a card wins, and a later card-less row must not overwrite it.
    const existing = out.get(r.id)
    if (existing && existing.audienceQuality !== null) continue

    out.set(r.id, {
      engagementRate: num(r.er),
      audienceQuality: num(r.aq),
      authenticity: num(r.auth),
      followerQuality: num(r.fq),
      performanceStability: r.stability,
      postFrequencyReliability: r.reliability,
      medianViews: num(r.median_views),
      formatDominant: r.format_dominant,
      contentTopic: r.content_topic,
      contentTopicSource: r.content_topic_source,
      isVerified: r.is_verified,
      paidRatio: num(r.paid_ratio),
    })
  }

  return out
}
