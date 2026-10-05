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
 *   engagement        Feature ER: feature.ig_engagement_analysis /
 *                       feature.tt_engagement_analysis .engagement_rate, the
 *                       table of the creator's own platform
 *   audience quality  l2_gold.kol_profile_card.audience_quality_score
 *                       + .authenticity_score
 *   consistency       l2_gold.kol_profile_card.performance_stability
 *                       + .post_frequency_reliability
 *   community         audience_quality_score + Feature ER
 *   reach             l2_gold.kol_profile_card.median_views
 *   content quality   Feature ER for its engagement part; l2_gold.post_metric
 *                       for views and per-post ER spread (views,
 *                       likes_hidden, is_collaboration, er_followers) —
 *                       aggregated per account by `POST_QUALITY_SQL`
 *
 * ── Engagement rate is Feature ER, and nothing else ────────────────────────
 * Every ER Brand Match ranks on is `feature.*_engagement_analysis.engagement_rate`.
 * `kol_directory.engagement_rate` is not read, not even as a fallback: it is a
 * different formula (average of the actor's latest posts over today's
 * followers) with no traceable source for TikTok. A creator without a Feature ER
 * has no engagement reading — null, never 0 and never the roster's number.
 *
 * ── ER one platform at a time; views mixed ─────────────────────────────────
 * A `kol_directory` row is one account on one platform, and its engagement rate
 * is ranked only against that platform's: Instagram against Instagram, TikTok
 * against TikTok. The two platforms' ERs are not comparable (median ER is
 * several times higher on Instagram), so a mixed population would push every
 * TikTok creator down and every Instagram creator up. Views are not split: High
 * Reach and Content Quality's views rank against one Instagram + TikTok
 * population, as they always have.
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

/**
 * Feature ER with its platform, one row per account (each table is UNIQUE on
 * social_account_id). The platform is the table's, so a join on it can only
 * ever pick the ER of the platform asked for.
 */
const FEATURE_ER_SQL = `(
  SELECT 'instagram'::text AS platform, social_account_id, engagement_rate
    FROM feature.ig_engagement_analysis
  UNION ALL
  SELECT 'tiktok'::text, social_account_id, engagement_rate
    FROM feature.tt_engagement_analysis
)`

export interface WhatMattersRecord {
  /** `platforms.key` of the creator's row; picks the population it is ranked in. */
  platform: string | null
  /** Feature ER of the creator's own platform. Null when there is none. */
  engagementRate: number | null
  audienceQuality: number | null
  authenticity: number | null
  performanceStability: string | null
  postFrequencyReliability: string | null
  medianViews: number | null
  cqErPct: number | null
  cqMedianViews: number | null
  cqErSdPp: number | null
  cqErPosts: number | null
}

/**
 * The measured populations the percentile criteria rank against.
 *
 * Taken over the WHOLE roster, not over the page — ER within one platform, views
 * across both. A percentile computed against twenty rows would move a creator's
 * score when someone pressed Next, and "top 10% for engagement" would mean a
 * different thing on every page. The arrays are small — Feature ER exists for
 * ~30 Instagram and ~10 TikTok accounts, median views for ~30 — and nulls are
 * excluded rather than counted as zero.
 */
export interface WhatMattersPopulation {
  er: number[]
  medianViews: number[]
  /** Content Quality: Feature ER (as `er`), and per-account median views from post_metric. */
  cqEr: number[]
  cqMedianViews: number[]
}

/**
 * One population per platform, keyed by `platforms.key`, plus `NO_PLATFORM`.
 * Only the ER arrays (`er`, `cqEr`) differ between them; the views arrays are
 * the same mixed Instagram + TikTok population in every entry.
 */
export type WhatMattersPopulations = Record<string, WhatMattersPopulation>

/**
 * The population for a row whose platform has no Feature ER population (or no
 * platform at all): no ER to rank against — such a row has no Feature ER
 * either — but the same mixed views as everyone else.
 */
export const NO_PLATFORM = ''

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

/** Cached briefly: the population moves when the pipeline runs, not per request. */
let popCache: { at: number; value: WhatMattersPopulations } | null = null
const POP_TTL_MS = 5 * 60 * 1000

export function resetPopulationCache(): void { popCache = null }

/**
 * The populations, per platform. Engagement (and Content Quality's engagement
 * part) rank against the Feature ER of active-roster accounts on the SAME
 * platform. Reach and Content Quality's views rank against ONE mixed population
 * of every profile card and post_metric account, Instagram and TikTok together,
 * exactly as before the Feature ER decision — which is about ER only.
 */
export async function whatMattersPopulation(): Promise<WhatMattersPopulations> {
  if (popCache && Date.now() - popCache.at < POP_TTL_MS) return popCache.value

  const db = kolDb()
  const [er, views, cq] = await Promise.all([
    // One member per account: DISTINCT, so an account two roster rows point at
    // is still counted once.
    db.query<{ platform: string; v: string }>(`
      SELECT DISTINCT fe.platform, fe.social_account_id, fe.engagement_rate AS v
        FROM public.kol_directory kd
        JOIN public.platforms pl ON pl.id = kd.platform_id
        JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
        JOIN ${FEATURE_ER_SQL} fe
          ON fe.social_account_id = ksa.social_account_id AND fe.platform = pl.key
       WHERE kd.directory_status = 'active' AND fe.engagement_rate IS NOT NULL`),
    db.query<{ v: string }>(`
      SELECT median_views AS v
        FROM l2_gold.kol_profile_card
       WHERE median_views IS NOT NULL`),
    // Every account in post_metric is one member of each population, so an
    // account on two platforms is two members — as it is two accounts.
    db.query<{ median_views: string | null }>(`
      SELECT ${POST_QUALITY_SQL}
        FROM l2_gold.post_metric pm
       GROUP BY pm.social_account_id`),
  ])

  const finite = (v: number | null): v is number => v !== null && Number.isFinite(v)
  const medianViews = views.rows.map(r => num(r.v)).filter(finite)
  const cqMedianViews = cq.rows.map(r => num(r.median_views)).filter(finite)

  const erBy: Record<string, number[]> = { [NO_PLATFORM]: [] }
  for (const r of er.rows) {
    const v = num(r.v)
    if (finite(v)) (erBy[r.platform] ??= []).push(v)
  }

  const value: WhatMattersPopulations = {}
  for (const [platform, erValues] of Object.entries(erBy)) {
    // Content Quality's engagement part ranks on the same Feature ER; views are
    // shared by every platform.
    value[platform] = { er: erValues, cqEr: erValues, medianViews, cqMedianViews }
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
    id: string; platform: string | null; er: string | null
    aq: string | null; auth: string | null
    stability: string | null; reliability: string | null
    median_views: string | null
    cq_median_views: string | null
    cq_er_sd_pp: string | null; cq_er_posts: string | null
  }>(`
    SELECT kd.id,
           pl.key AS platform,
           -- Feature ER of the row's own platform. No fallback to
           -- kol_directory.engagement_rate: none means null.
           fe.engagement_rate AS er,
           pc.audience_quality_score  AS aq,
           pc.authenticity_score      AS auth,
           pc.performance_stability   AS stability,
           pc.post_frequency_reliability AS reliability,
           pc.median_views,
           cq.median_views AS cq_median_views,
           cq.er_sd_pp     AS cq_er_sd_pp,
           cq.er_posts     AS cq_er_posts
      FROM public.kol_directory kd
      LEFT JOIN public.platforms pl ON pl.id = kd.platform_id
      LEFT JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
      LEFT JOIN ${FEATURE_ER_SQL} fe
             ON fe.social_account_id = ksa.social_account_id AND fe.platform = pl.key
      -- One card per creator: the freshest snapshot of whichever linked account
      -- has one. DISTINCT ON keeps a creator with two platforms from becoming
      -- two rows and being scored twice.
      LEFT JOIN LATERAL (
        SELECT * FROM l2_gold.kol_profile_card c
         WHERE c.social_account_id = ksa.social_account_id
         ORDER BY c.profile_snapshot_date DESC NULLS LAST
         LIMIT 1
      ) pc ON TRUE
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
      platform: r.platform,
      engagementRate: num(r.er),
      audienceQuality: num(r.aq),
      authenticity: num(r.auth),
      performanceStability: r.stability,
      postFrequencyReliability: r.reliability,
      medianViews: num(r.median_views),
      // Content Quality's engagement part is the same Feature ER.
      cqErPct: num(r.er),
      cqMedianViews: num(r.cq_median_views),
      cqErSdPp: num(r.cq_er_sd_pp),
      cqErPosts: num(r.cq_er_posts),
    })
  }

  return out
}
