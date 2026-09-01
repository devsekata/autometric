import kolDb from '@/lib/kolDb'
import { toIso } from './util'

/**
 * What the warehouse's L2 Gold layer holds for a roster creator.
 *
 * `@/lib/discover/kolMeasured` reads L1 Silver — the per-post rows and the rate
 * card. This module reads the layer above it: `l2_gold`, where the Dagster
 * pipeline writes figures that are already aggregated to the grain a screen
 * wants, so the page does not aggregate them again on every request.
 *
 *   * `l2_gold.kol_profile_card`            1.976 rows — one card per account
 *   * `l2_gold.kol_metric_daily`              280 rows — per account per day
 *   * `l2_gold.kol_metric_monthly`             68 rows — per account per month
 *   * `l2_gold.audience_demographics_daily`    69 rows — gender today, age later
 *   * `l2_gold.audience_geo_daily`            181 rows — country and city
 *   * `l2_gold.audience_interest_daily`       214 rows — interest keys
 *   * `l2_gold.post_metric`                    477 rows — one row per post
 *   * `l2_gold.content_format_daily`           300 rows — per account, day, format
 *
 * Reached the same way L1 is: from `public.kol_directory` through
 * `public.kol_social_account`, which maps a roster row to the accounts it owns.
 * A creator can hold both an Instagram and a TikTok account, so every query here
 * fans in and carries `platform` so the caller can tell them apart.
 *
 * ── Nulls are never coalesced to zero ────────────────────────────────────────
 * Same rule as `kolMeasured`, and it matters more here because L2 is sparser
 * than it looks. Measured against the tables as they stand:
 *
 *   `reach_sum`, `er_reach_daily`, `reposts_sum`, `followers_growth`  NULL in
 *   every row of `kol_metric_daily` and `kol_metric_monthly` — they need the
 *   Insights API, which the harvest does not have. `er_followers_daily` is
 *   present in 26% of rows, `likes_sum`/`comments_sum` in 85%.
 *
 *   `rate_card*` columns are NULL in every row of `kol_profile_card`. Prices
 *   still come from `l1_silver.unified_rate_card` via `kolMeasured` — this
 *   module deliberately does not read them, so there is one source for a price
 *   rather than two that can disagree.
 *
 * A zero would read as "measured, and it was nothing". These stay null and the
 * UI omits the tile.
 *
 * ── The last two tables came online on 1 Sep 2026 ───────────────────────────
 * `l2_gold.post_metric` and `l2_gold.content_format_daily` used to hold zero rows
 * and were skipped for that reason. The scraper repo's `gold_post.py` asset now
 * fills them inside the same `transform_chain_job` the other rollups ride, so
 * they are read here on the same terms as the rest: 30 creators have rows today,
 * the same 30 that carry `kol_metric_daily`.
 *
 * They reconcile against `kol_metric_daily` by construction, which is what makes
 * them safe to show beside it — summing `content_format_daily` across formats for
 * an account-day reproduces the daily row exactly, and `post_metric` does too
 * once the two sample flags are filtered. The pipeline re-checks that on every
 * materialize. Neither is aggregated again here.
 */

/** One day of a creator's measured performance, one row per platform. */
export interface GoldDailyPoint {
  /** `YYYY-MM-DD`. The date the content was PUBLISHED, not the day it was scraped. */
  date: string
  platform: string
  postCount: number
  likes: number | null
  comments: number | null
  views: number | null
  engagement: number | null
  /** Fraction 0..1, not a percentage. Null for the 74% of days without a follower snapshot. */
  erFollowers: number | null
}

/** One month, aggregated by the pipeline rather than by this query. */
export interface GoldMonthlyPoint {
  /** `YYYY-MM`, taken from the pipeline's own `month_year` column. */
  month: string
  platform: string
  /** Days in the month on which the creator published at least once. */
  activeDays: number
  postCount: number
  likes: number | null
  comments: number | null
  views: number | null
  engagement: number | null
  /** Recomputed monthly by the pipeline — never an average of the daily ER. */
  erFollowers: number | null
  /** Follower count on the last day of the month that carried a snapshot. */
  followersEom: number | null
}

/** The pipeline's own profile snapshot, one per account the creator owns. */
export interface GoldProfileCard {
  platform: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  profileUrl: string | null
  bio: string | null
  website: string | null
  isVerified: boolean | null
  isPrivate: boolean | null
  followers: number | null
  following: number | null
  mediaCount: number | null
  tier: string | null
  /** When the pipeline took this snapshot — the honest "last refreshed". */
  snapshotDate: string | null
}

/** A slice of the audience, already shaped for `Donut` and `Bars`. */
export interface GoldAudienceSlice {
  label: string
  /** Share of this creator's audience, 0..100, rounded to one decimal. */
  pct: number
  /** The raw count behind `pct`, so a tooltip can show it. */
  n: number
}

export interface GoldAudience {
  /** From `audience_type = 'gender'`. Empty when the creator has no inference. */
  gender: GoldAudienceSlice[]
  /**
   * From `audience_type = 'age'`. **Empty for every creator today** — the
   * demographics table currently holds only gender rows. Kept because the
   * column that separates them already exists, so age needs no schema change.
   */
  age: GoldAudienceSlice[]
  /** From `audience_geo_daily` where `geo_level = 'country'`. */
  countries: GoldAudienceSlice[]
  /** From `audience_geo_daily` where `geo_level = 'city'`. */
  cities: GoldAudienceSlice[]
  interests: GoldAudienceSlice[]
  /**
   * How much of the audience the inference could actually classify, per
   * dimension, 0..100. The slices above are shares of the classified part, so
   * without this a chart reading "78% business" hides that only 22% of the
   * audience was classified at all. The UI prints it next to the chart.
   */
  coverage: { gender: number | null; age: number | null; geo: number | null; interests: number | null }
  /**
   * The pipeline's own confidence LABEL, not a number — the column is
   * `character varying` and carries exactly `inferred_high`, `inferred_medium`
   * or `inferred_low`. The dominant label across the rows behind these figures
   * is taken (`MODE()`), because averaging a word is not a thing.
   *
   * Every value starts with `inferred_` for a reason: these are derived from
   * the follower sample, never reported by the platform. The UI says so.
   */
  confidence: string | null
  /** The day the inference was computed. */
  asOf: string | null
}

/**
 * One published post, carrying the pipeline's own rank and ER rather than ones
 * this page derives. The grain of `l2_gold.post_metric`.
 *
 * `likesHidden` and `isCollaboration` are the two sample rules, kept as fields
 * because the pipeline writes EVERY post and expects the reader to filter. They
 * are also why `erFollowers` can be null on a row whose likes are present: a
 * collaboration's likes are real but partly someone else's audience, so a ratio
 * against THIS account's followers would be wrong rather than merely incomplete.
 */
export interface GoldPost {
  platform: string
  contentId: string
  /** Full instant of publication. */
  postedAt: string | null
  /** `YYYY-MM-DD`, the publication day in WIB — the day the rollups group by. */
  postDate: string | null
  mediaType: string | null
  isSponsored: boolean | null
  permalink: string | null
  likesHidden: boolean | null
  isCollaboration: boolean | null
  likes: number | null
  comments: number | null
  /** TikTok only on the harvest as it stands; null on Instagram means unknown. */
  shares: number | null
  saves: number | null
  views: number | null
  /** Like + Comment + Share. Saves are deliberately not part of engagement. */
  engagement: number | null
  engagementPublic: number | null
  followersAtPostDate: number | null
  /** Fraction 0..1, not a percentage. Null for 71% of posts — see above. */
  erFollowers: number | null
  /** Rank by ER within the account, from the feature layer. Null when unranked. */
  rankInAccount: number | null
  /** Already a JSON array of strings in the column; empty when the post had none. */
  hashtags: string[]
}

/**
 * One (day × format) cell of `l2_gold.content_format_daily` — `kol_metric_daily`
 * with `media_type` added, and identical formulas, so the two can be compared.
 *
 * `mediaType` is the platform's own word (`clips`, `carousel_container`, `feed`,
 * `VIDEO`, `CAROUSEL`), plus `unknown` for the posts whose format never came
 * through. Not normalised into shared labels: that mapping is a product decision
 * that has not been made, and inventing it here would bake it into the data.
 */
export interface GoldFormatDay {
  /** `YYYY-MM-DD`, publication day in WIB. */
  date: string
  platform: string
  mediaType: string
  postCount: number
  /** Posts that passed both sample rules; the `*Sum` fields cover only these. */
  postsInSample: number
  likes: number | null
  comments: number | null
  views: number | null
  engagement: number | null
  /**
   * The ER denominator, kept because ER is a ratio and ratios do not add. A
   * multi-day ER must be `sum(engagement) / sum(followersDenom)`, never a mean
   * of `erFollowers`.
   */
  followersDenom: number | null
  erFollowers: number | null
}

export interface KolGold {
  /** One card per account the creator owns; empty when L2 has none. */
  cards: GoldProfileCard[]
  /** Oldest first, so a chart can plot it without sorting again. */
  daily: GoldDailyPoint[]
  /** Oldest first. */
  monthly: GoldMonthlyPoint[]
  /** Null when no audience inference exists for any of the creator's accounts. */
  audience: GoldAudience | null
  /** Newest first, capped — see the query. Empty for a creator with no posts. */
  posts: GoldPost[]
  /** Oldest first, one row per format per day. */
  formats: GoldFormatDay[]
}

/**
 * A `date` column as the calendar day the pipeline meant, `YYYY-MM-DD`.
 *
 * NOT `toIso(...).slice(0, 10)`. node-pg parses a `date` into a Date at LOCAL
 * midnight, so converting it to UTC first walks it back a day for every zone
 * east of Greenwich: `metric_date = 2026-07-13` came out of that as
 * `"2026-07-12"` in Asia/Jakarta. The local parts are the ones that carry the
 * meaning here, because the pipeline stored a day, not an instant.
 */
function toDateOnly(v: Date | string | null | undefined): string | null {
  if (!v) return null
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    const p = (n: number) => String(n).padStart(2, '0')
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`
  }
  // Already `YYYY-MM-DD…` from the driver; take the day part as-is.
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : toDateOnly(new Date(v))
}

/** `bigint` and `numeric` both arrive as strings from node-pg; null stays null. */
const num = (v: string | number | null): number | null =>
  v === null || v === undefined ? null : Number(v)

/**
 * A `jsonb` array of tags as a plain `string[]`.
 *
 * node-pg parses `jsonb` for us, so this is a shape guard rather than a parse:
 * the column is nullable and nothing stops a future writer putting an object
 * there, and a `.map` over that would throw inside a page render.
 */
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/** `count(*)::int` already arrives as a number; everything else may not. */
const int = (v: string | number | null): number =>
  v === null || v === undefined ? 0 : Number(v)

/**
 * The inference's own bucket for "could not classify this follower". It is not
 * a demographic and must never be charted as one: on the roster as it stands it
 * is the LARGEST bucket almost everywhere — 61% of gender, 90% of country, 78%
 * of interest. Left in, every chart would announce that the biggest slice of
 * this creator's audience is `unknown`, which says nothing about the audience
 * and everything about the inference.
 *
 * So it is split out: the slices are shares of the CLASSIFIED audience, and how
 * much was unclassified travels beside them as `coverage` for the UI to state
 * plainly.
 */
const UNCLASSIFIED = 'unknown'

/**
 * Turns counted rows into shares of the classified audience, plus the coverage
 * that share is based on.
 *
 * The counts are per-account, and a creator holding two accounts contributes two
 * sets, so the total is taken across whatever came back rather than assumed to
 * be one account's follower count.
 */
function toSlices(
  rows: { key: string | null; n: string | number | null }[],
): { slices: GoldAudienceSlice[]; classified: number; total: number } {
  const clean = rows
    .map(r => ({ label: (r.key ?? '').trim(), n: int(r.n) }))
    .filter(r => r.label !== '' && r.n > 0)
  const total = clean.reduce((a, r) => a + r.n, 0)
  const known = clean.filter(r => r.label.toLowerCase() !== UNCLASSIFIED)
  const classified = known.reduce((a, r) => a + r.n, 0)
  if (!classified) return { slices: [], classified: 0, total }
  return {
    slices: known
      .map(r => ({ label: r.label, n: r.n, pct: Math.round((r.n / classified) * 1000) / 10 }))
      .sort((a, b) => b.pct - a.pct),
    classified,
    total,
  }
}

/**
 * Returns null when L2 holds nothing at all for this creator, which is the
 * signal for the workspace to keep showing what it showed before — the sampled
 * shape from `@/lib/discover/kolSample`, or the L1 figures from `kolMeasured`.
 *
 * L2 covers far more of the roster than L1 does: 1.976 accounts have a profile
 * card against the 23 creators with harvested posts. So for most creators this
 * returns a card and nothing else, and the caller must handle each field being
 * independently absent rather than treating the object as all-or-nothing.
 */
export async function getKolGold(kolId: string): Promise<KolGold | null> {
  const db = kolDb()

  const [cards, daily, monthly, gender, age, geo, interest, posts, formats] =
    await Promise.all([
    db.query<{
      platform: string | null; username: string | null; display_name: string | null
      avatar_url: string | null; profile_url: string | null; bio: string | null
      website: string | null; is_verified: boolean | null; is_private: boolean | null
      followers_count: string | null; following_count: string | null
      media_count: string | null; tier: string | null
      profile_snapshot_date: Date | string | null
    }>(
      `SELECT c.platform, c.username, c.display_name, c.avatar_url, c.profile_url,
              c.bio, c.website, c.is_verified, c.is_private,
              c.followers_count, c.following_count, c.media_count, c.tier,
              c.profile_snapshot_date
         FROM public.kol_social_account ksa
         JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
        WHERE ksa.kol_id = $1
        ORDER BY c.followers_count DESC NULLS LAST`,
      [kolId],
    ),

    // Capped at a year. The chart shows a window, and an uncapped scan would
    // grow without bound as the pipeline keeps appending days.
    db.query<{
      metric_date: Date | string; platform: string | null; post_count: string | null
      likes_sum: string | null; comments_sum: string | null; views_sum: string | null
      engagement_sum: string | null; er_followers_daily: string | null
    }>(
      `SELECT d.metric_date, d.platform, d.post_count,
              d.likes_sum, d.comments_sum, d.views_sum,
              d.engagement_sum, d.er_followers_daily
         FROM public.kol_social_account ksa
         JOIN l2_gold.kol_metric_daily d ON d.social_account_id = ksa.social_account_id
        WHERE ksa.kol_id = $1
          AND d.metric_date >= (CURRENT_DATE - INTERVAL '365 days')
        ORDER BY d.metric_date ASC`,
      [kolId],
    ),

    db.query<{
      month_year: string | null; platform: string | null
      active_days: string | null; post_count: string | null
      likes_sum: string | null; comments_sum: string | null; views_sum: string | null
      engagement_sum: string | null; er_followers_monthly: string | null
      followers_eom: string | null
    }>(
      `SELECT m.month_year, m.platform, m.active_days, m.post_count,
              m.likes_sum, m.comments_sum, m.views_sum,
              m.engagement_sum, m.er_followers_monthly, m.followers_eom
         FROM public.kol_social_account ksa
         JOIN l2_gold.kol_metric_monthly m ON m.social_account_id = ksa.social_account_id
        WHERE ksa.kol_id = $1
        ORDER BY m.month_start ASC`,
      [kolId],
    ),

    // Gender and age share one table, separated by `audience_type` — the
    // pipeline writes them as one demographics fact, not two. Only the newest
    // day is read: these are daily snapshots of the same inference, so summing
    // across days would count the same follower once per day.
    db.query<{ key: string | null; n: string | null; confidence: string | null; at: Date | string | null }>(
      `SELECT a.dimension_key AS key, SUM(a.audience_count) AS n,
              MODE() WITHIN GROUP (ORDER BY a.confidence) AS confidence,
              MAX(a.audience_date) AS at
         FROM public.kol_social_account ksa
         JOIN l2_gold.audience_demographics_daily a
           ON a.social_account_id = ksa.social_account_id
        WHERE ksa.kol_id = $1
          AND a.audience_type = 'gender'
          AND a.audience_date = (
                SELECT MAX(x.audience_date)
                  FROM l2_gold.audience_demographics_daily x
                 WHERE x.social_account_id = a.social_account_id
                   AND x.audience_type = 'gender')
        GROUP BY a.dimension_key`,
      [kolId],
    ),

    // Same table, `audience_type = 'age'`. Returns nothing today; wired now so
    // the chart appears on its own once the pipeline starts writing age rows.
    db.query<{ key: string | null; n: string | null }>(
      `SELECT a.dimension_key AS key, SUM(a.audience_count) AS n
         FROM public.kol_social_account ksa
         JOIN l2_gold.audience_demographics_daily a
           ON a.social_account_id = ksa.social_account_id
        WHERE ksa.kol_id = $1
          AND a.audience_type = 'age'
          AND a.audience_date = (
                SELECT MAX(x.audience_date)
                  FROM l2_gold.audience_demographics_daily x
                 WHERE x.social_account_id = a.social_account_id
                   AND x.audience_type = 'age')
        GROUP BY a.dimension_key`,
      [kolId],
    ),

    db.query<{ geo_level: string | null; key: string | null; n: string | null }>(
      `SELECT g.geo_level, g.geo_key AS key, SUM(g.audience_count) AS n
         FROM public.kol_social_account ksa
         JOIN l2_gold.audience_geo_daily g ON g.social_account_id = ksa.social_account_id
        WHERE ksa.kol_id = $1
          AND g.audience_date = (
                SELECT MAX(x.audience_date)
                  FROM l2_gold.audience_geo_daily x
                 WHERE x.social_account_id = g.social_account_id)
        GROUP BY g.geo_level, g.geo_key`,
      [kolId],
    ),

    db.query<{ key: string | null; n: string | null }>(
      `SELECT i.interest_key AS key, SUM(i.audience_count) AS n
         FROM public.kol_social_account ksa
         JOIN l2_gold.audience_interest_daily i
           ON i.social_account_id = ksa.social_account_id
        WHERE ksa.kol_id = $1
          AND i.audience_date = (
                SELECT MAX(x.audience_date)
                  FROM l2_gold.audience_interest_daily x
                 WHERE x.social_account_id = i.social_account_id)
        GROUP BY i.interest_key`,
      [kolId],
    ),

    // Capped by COUNT, not by date, and that is the difference from the daily
    // rollup above. This is a list of posts, not a time series: the busiest
    // creator on the roster carries 200 rows, and a 365-day window would drop
    // 18 posts that a "top posts" table still wants. Newest first so the cap
    // takes the recent end when a creator eventually outgrows it.
    //
    // Ordering for display (top ER / newest / most viewed) happens in the
    // component, over these rows — the same way the sampled grid already sorts.
    db.query<{
      platform: string | null; content_id: string; posted_at: Date | string | null
      post_date: Date | string | null; media_type: string | null
      is_sponsored: boolean | null; permalink: string | null
      likes_hidden: boolean | null; is_collaboration: boolean | null
      likes: string | null; comments: string | null; shares: string | null
      saves: string | null; views: string | null
      engagement_owned: string | null; engagement_public: string | null
      followers_at_post_date: string | null; er_followers: string | null
      rank_in_account: number | null; top_hashtags: unknown
    }>(
      `SELECT p.platform, p.content_id, p.posted_at, p.post_date, p.media_type,
              p.is_sponsored, p.permalink, p.likes_hidden, p.is_collaboration,
              p.likes, p.comments, p.shares, p.saves, p.views,
              p.engagement_owned, p.engagement_public,
              p.followers_at_post_date, p.er_followers,
              p.rank_in_account, p.top_hashtags
         FROM public.kol_social_account ksa
         JOIN l2_gold.post_metric p ON p.social_account_id = ksa.social_account_id
        WHERE ksa.kol_id = $1
        ORDER BY p.posted_at DESC NULLS LAST
        LIMIT 200`,
      [kolId],
    ),

    // NOT windowed, unlike `kol_metric_daily` above, and the difference is
    // deliberate: this feeds a format MIX, not a time series.
    //
    // It used to carry the same 365-day cap, on the reasoning that the two
    // tables should agree. Measured against the data, that cap only lost rows:
    // 16 rows across 6 accounts fall outside the window and never reached the
    // screen. Worse, both this card and the Top Posts table live on the same
    // Content tab, and `post_metric` below is capped by COUNT rather than by
    // date — so `irwansyah_15` showed "10 post" in the table beside a format
    // breakdown built from 8. Two totals for one creator on one tab.
    //
    // The card renders shares across the whole period, so the window bought the
    // reader nothing while silently dropping the oldest content. Both queries
    // now describe the same corpus. The daily and monthly series above keep
    // their window — those really are charts over time.
    db.query<{
      metric_date: Date | string; platform: string | null; media_type: string
      post_count: string | null; posts_in_sample: string | null
      likes_sum: string | null; comments_sum: string | null; views_sum: string | null
      engagement_sum: string | null; followers_denom_sum: string | null
      er_followers_daily: string | null
    }>(
      `SELECT f.metric_date, f.platform, f.media_type,
              f.post_count, f.posts_in_sample,
              f.likes_sum, f.comments_sum, f.views_sum,
              f.engagement_sum, f.followers_denom_sum, f.er_followers_daily
         FROM public.kol_social_account ksa
         JOIN l2_gold.content_format_daily f
           ON f.social_account_id = ksa.social_account_id
        WHERE ksa.kol_id = $1
        ORDER BY f.metric_date ASC`,
      [kolId],
    ),
  ])

  const hasAudience =
    gender.rows.length > 0 || age.rows.length > 0 ||
    geo.rows.length > 0 || interest.rows.length > 0

  if (
    !cards.rows.length && !daily.rows.length && !monthly.rows.length &&
    !posts.rows.length && !formats.rows.length && !hasAudience
  ) {
    return null
  }

  // The dominant label across the gender rows. They agree in practice, but the
  // most common one is taken rather than the first so the pick is not
  // row-order-dependent.
  const labelCount = new Map<string, number>()
  for (const r of gender.rows) {
    const l = (r.confidence ?? '').trim()
    if (l) labelCount.set(l, (labelCount.get(l) ?? 0) + 1)
  }
  const confidence = [...labelCount.entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const asOf = gender.rows
    .map(r => toDateOnly(r.at))
    .filter((v): v is string => v !== null)
    .sort()
    .pop() ?? null

  /** Percentage of a dimension that carried a real label, null when it had no rows. */
  const pctOf = (t: { classified: number; total: number }) =>
    t.total ? Math.round((t.classified / t.total) * 1000) / 10 : null

  function buildAudience() {
    const g = toSlices(gender.rows)
    const a = toSlices(age.rows)
    const country = toSlices(geo.rows.filter(r => r.geo_level === 'country'))
    const city = toSlices(geo.rows.filter(r => r.geo_level === 'city'))
    const i = toSlices(interest.rows)
    return {
      gender: g.slices,
      age: a.slices,
      countries: country.slices,
      cities: city.slices,
      interests: i.slices,
      coverage: {
        gender: pctOf(g),
        age: pctOf(a),
        // Country is the geo dimension with real coverage; city is a subset of it.
        geo: pctOf(country),
        interests: pctOf(i),
      },
      confidence,
      asOf,
    }
  }

  return {
    cards: cards.rows.map(r => ({
      platform: r.platform ?? 'unknown',
      username: r.username,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      profileUrl: r.profile_url,
      bio: r.bio,
      website: r.website,
      isVerified: r.is_verified,
      isPrivate: r.is_private,
      followers: num(r.followers_count),
      following: num(r.following_count),
      mediaCount: num(r.media_count),
      tier: r.tier,
      snapshotDate: toDateOnly(r.profile_snapshot_date),
    })),

    daily: daily.rows.map(r => ({
      date: toDateOnly(r.metric_date) ?? '',
      platform: r.platform ?? 'unknown',
      postCount: int(r.post_count),
      likes: num(r.likes_sum),
      comments: num(r.comments_sum),
      views: num(r.views_sum),
      engagement: num(r.engagement_sum),
      erFollowers: num(r.er_followers_daily),
    })),

    monthly: monthly.rows.map(r => ({
      month: r.month_year ?? '',
      platform: r.platform ?? 'unknown',
      activeDays: int(r.active_days),
      postCount: int(r.post_count),
      likes: num(r.likes_sum),
      comments: num(r.comments_sum),
      views: num(r.views_sum),
      engagement: num(r.engagement_sum),
      erFollowers: num(r.er_followers_monthly),
      followersEom: num(r.followers_eom),
    })),

    posts: posts.rows.map(r => ({
      platform: r.platform ?? 'unknown',
      contentId: r.content_id,
      postedAt: toIso(r.posted_at),
      postDate: toDateOnly(r.post_date),
      mediaType: r.media_type,
      isSponsored: r.is_sponsored,
      permalink: r.permalink,
      likesHidden: r.likes_hidden,
      isCollaboration: r.is_collaboration,
      likes: num(r.likes),
      comments: num(r.comments),
      shares: num(r.shares),
      saves: num(r.saves),
      views: num(r.views),
      engagement: num(r.engagement_owned),
      engagementPublic: num(r.engagement_public),
      followersAtPostDate: num(r.followers_at_post_date),
      erFollowers: num(r.er_followers),
      rankInAccount: r.rank_in_account,
      hashtags: strList(r.top_hashtags),
    })),

    formats: formats.rows.map(r => ({
      date: toDateOnly(r.metric_date) ?? '',
      platform: r.platform ?? 'unknown',
      mediaType: r.media_type,
      postCount: int(r.post_count),
      postsInSample: int(r.posts_in_sample),
      likes: num(r.likes_sum),
      comments: num(r.comments_sum),
      views: num(r.views_sum),
      engagement: num(r.engagement_sum),
      followersDenom: num(r.followers_denom_sum),
      erFollowers: num(r.er_followers_daily),
    })),

    audience: hasAudience ? buildAudience() : null,
  }
}
