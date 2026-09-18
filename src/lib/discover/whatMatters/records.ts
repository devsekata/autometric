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
 *   content quality   l2_gold.post_metric: engagement_owned,
 *                       followers_at_post_date, er_followers, views,
 *                       likes_hidden, is_collaboration — aggregated per
 *                       account by `POST_QUALITY_SQL`
 *   brand safety      .authenticity_score + .follower_quality_score
 *                       + .is_verified + .paid_ratio
 *
 * Coverage is thin and the UI must say so rather than fill it: of 1.978 profile
 * cards, median_views 30, performance_stability 11, post_frequency_reliability
 * 49, audience_quality 27. `post_metric` covers 57 accounts (522 posts).
 */

/**
 * Content Quality's three raw numbers for the post_metric rows of one account
 * (`pm`). The same expressions as the reference's `SQL_CONTENT_QUALITY_CTE`,
 * and as `summarisePostQuality` in `./score`:
 *
 *   er_pct        additive ER over posts with er_followers
 *   median_views  median views over sampled posts with views > 0
 *   er_sd_pp      sample SD of per-post ER, percentage points
 *   er_posts      posts with an ER (the stability minimum counts these)
 */
const POST_QUALITY_SQL = `
  sum(pm.engagement_owned) FILTER (WHERE pm.er_followers IS NOT NULL)::numeric
    / NULLIF(sum(pm.followers_at_post_date)
               FILTER (WHERE pm.er_followers IS NOT NULL), 0)
    * 100                                                    AS er_pct,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY pm.views)
    FILTER (WHERE pm.likes_hidden IS NOT TRUE
              AND pm.is_collaboration IS NOT TRUE
              AND pm.views > 0)                              AS median_views,
  stddev_samp(pm.er_followers * 100)                         AS er_sd_pp,
  count(pm.er_followers)                                     AS er_posts`

export interface WhatMattersRecord {
  engagementRate: number | null
  audienceQuality: number | null
  authenticity: number | null
  followerQuality: number | null
  performanceStability: string | null
  postFrequencyReliability: string | null
  medianViews: number | null
  cqErPct: number | null
  cqMedianViews: number | null
  cqErSdPp: number | null
  cqErPosts: number | null
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
  /** Content Quality: per-account additive ER and median views, post_metric. */
  cqEr: number[]
  cqMedianViews: number[]
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
  const [er, views, cq] = await Promise.all([
    db.query<{ v: string }>(`
      SELECT engagement_rate AS v
        FROM public.kol_directory
       WHERE directory_status = 'active' AND engagement_rate IS NOT NULL`),
    db.query<{ v: string }>(`
      SELECT median_views AS v
        FROM l2_gold.kol_profile_card
       WHERE median_views IS NOT NULL`),
    // Every account in post_metric is one member of each population, so an
    // account on two platforms is two members — as it is two accounts.
    db.query<{ er_pct: string | null; median_views: string | null }>(`
      SELECT ${POST_QUALITY_SQL}
        FROM l2_gold.post_metric pm
       GROUP BY pm.social_account_id`),
  ])

  const value: WhatMattersPopulation = {
    er: er.rows.map(r => Number(r.v)).filter(Number.isFinite),
    medianViews: views.rows.map(r => Number(r.v)).filter(Number.isFinite),
    cqEr: cq.rows.map(r => num(r.er_pct)).filter((v): v is number => v !== null && Number.isFinite(v)),
    cqMedianViews: cq.rows.map(r => num(r.median_views))
      .filter((v): v is number => v !== null && Number.isFinite(v)),
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
    median_views: string | null
    cq_er_pct: string | null; cq_median_views: string | null
    cq_er_sd_pp: string | null; cq_er_posts: string | null
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
           cq.er_pct       AS cq_er_pct,
           cq.median_views AS cq_median_views,
           cq.er_sd_pp     AS cq_er_sd_pp,
           cq.er_posts     AS cq_er_posts,
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
      -- Content Quality, from this account's own posts. An aggregate always
      -- returns one row, so an account with no posts gets nulls, not zeros.
      LEFT JOIN LATERAL (
        SELECT ${POST_QUALITY_SQL}
          FROM l2_gold.post_metric pm
         WHERE pm.social_account_id = ksa.social_account_id
      ) cq ON TRUE
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
      cqErPct: num(r.cq_er_pct),
      cqMedianViews: num(r.cq_median_views),
      cqErSdPp: num(r.cq_er_sd_pp),
      cqErPosts: num(r.cq_er_posts),
      isVerified: r.is_verified,
      paidRatio: num(r.paid_ratio),
    })
  }

  return out
}
