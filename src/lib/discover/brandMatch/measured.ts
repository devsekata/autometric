import type { ScoringRecord } from './score'

/**
 * The creator signals that are actually MEASURED, and nothing else.
 *
 * ── Why this module exists ─────────────────────────────────────────────────
 * `@/lib/discover/kolSample` used to answer these. It derives a creator's
 * reach, growth, audience quality, authenticity and brand fit deterministically
 * from their follower count and engagement rate — same creator, same numbers,
 * every time, and marked "modelled" wherever it was drawn. Deterministic is not
 * the same as measured: a figure computed from two other figures by a formula
 * nobody validated is a guess with a stable seed, and it was being shown beside
 * real measurements on the same card.
 *
 * Every field here is nullable, and null means **not measured** — never 0.
 * That distinction is the entire point of the module. An account with 0%
 * authenticity and an account nobody has analysed are different findings, and a
 * buyer who cannot tell them apart will reject the wrong creator.
 *
 * ── Where each one really comes from ───────────────────────────────────────
 *   authenticity     feature.{ig,tt}_audience_analysis.authenticity_score
 *   audienceQuality  feature.{ig,tt}_audience_analysis.audience_quality_score
 *   followerQuality  feature.{ig,tt}_audience_analysis.follower_quality_score
 *   avgViews         feature.ig_engagement_analysis.avg_views,
 *                      else l2_gold.kol_profile_card.avg_views
 *   viewsPerFollower feature.ig_engagement_analysis.view_to_follower_ratio
 *   growthPct        l2_gold.kol_profile_card.followers_growth
 *   postsPerMonth    post_frequency_monthly, gated on observation_days
 *
 * Coverage is small and that is the honest state of the database: 24 creators
 * of ~7.000 carry an audience analysis. The UI shows "not measured" for the
 * rest rather than filling the gap.
 *
 * Brand fit is deliberately NOT here. It is not a property of a creator at all
 * — it is a property of a creator and a brand together — and it now comes from
 * the Brand Match Engine against a saved Brand Profile. A creator-only
 * "brand fit" number was the clearest case of a figure that could not mean
 * anything, because nothing had been said about the brand.
 */
export interface MeasuredSignals {
  /** 0–100. Null when no audience analysis exists for this creator. */
  authenticity: number | null
  /** 0–100. Null when no audience analysis exists. */
  audienceQuality: number | null
  /** 0–100. Null when no audience analysis exists. */
  followerQuality: number | null
  /** Null when no engagement analysis and no profile card carries it. */
  avgViews: number | null
  /**
   * Views per follower. Null when unmeasured.
   *
   * Reported rather than an "estimated reach": reach is not a column anywhere on
   * this server, and `kolSample` produced one by multiplying followers by a
   * constant. This is the real ratio, and the reader can see it is a ratio.
   */
  viewsPerFollower: number | null
  /**
   * Follower growth since the PREVIOUS snapshot, in percentage points.
   *
   * Not monthly, and must never be labelled monthly: the gap is whatever the
   * scraper produced, 10–13 days at the time of writing. Most of the roster was
   * scraped once and carries null.
   */
  growthPct: number | null
  /**
   * Posts per month. Null below `CAL_MIN_OBS_DAYS` of observation as well as
   * when absent — a cadence extrapolated from a single observed day is
   * arithmetic, and the roster carries readings of 300/month from exactly that.
   */
  postsPerMonth: number | null
  /** The audience's largest known city and its share, when measured. */
  topCity: { key: string; pct: number } | null
  /** Share of the audience whose interests the pipeline could classify. */
  interestKnownPct: number | null

  /**
   * The audience breakdown, for the screens that used to draw a generated one.
   *
   * Gender comes from `feature.*_audience_analysis` or, failing that, from
   * `l2_gold.audience_demographics_daily` — the only `audience_type` that table
   * carries is 'gender'.
   *
   * There is **no age breakdown** and there is no field for one here.
   * `age_gender_breakdown` is NULL in every audience-analysis row and the
   * demographics table holds no age rows, so an age split cannot be read for
   * anybody on this server. The panel that used to show three age bands showed
   * three generated numbers.
   */
  femalePct: number | null
  malePct: number | null
  /** Largest known audience cities, share of the KNOWN-city portion. */
  cities: { key: string; pct: number }[]
  /** Audience interests by share of the KNOWN-interest portion, largest first. */
  interests: { key: string; pct: number }[]
  /** How many of the 12 tracked fields carry a value, 0–100. */
  completeness: number
}

/** Minimum observed days before a posting cadence means anything. */
const MIN_OBS_DAYS = 21

/**
 * Reads the measured half out of a scoring record.
 *
 * The record was built for the match engine and already carries every one of
 * these, fetched in the same six queries — so surfacing them costs nothing and,
 * more importantly, guarantees the number on the card is the number the score
 * was computed from. Two code paths reading the same column two ways is how a
 * card and a match explanation start disagreeing about the same creator.
 */
export function measuredSignals(k: ScoringRecord): MeasuredSignals {
  const tracked = [
    k.category, k.er, k.avgViews, k.vfr, k.femalePct, k.countryShare,
    k.cities?.[0]?.pct ?? null, k.interestKnownPct, k.audienceQuality,
    k.authenticity, k.followerQuality, k.postFrequencyMonthly,
  ]
  const filled = tracked.filter(v => v !== null && v !== undefined).length

  const city = k.cities?.[0]
  const interests = Object.entries(k.interests ?? {})
    .map(([key, pct]) => ({ key, pct }))
    .sort((a, b) => b.pct - a.pct)

  return {
    authenticity: k.authenticity,
    audienceQuality: k.audienceQuality,
    followerQuality: k.followerQuality,
    avgViews: k.avgViews,
    viewsPerFollower: k.vfr,
    growthPct: k.followersGrowth,
    postsPerMonth: k.postFrequencyMonthly !== null && k.observationDays !== null
      && k.observationDays >= MIN_OBS_DAYS ? k.postFrequencyMonthly : null,
    topCity: city && typeof city.pct === 'number' ? { key: city.key, pct: city.pct } : null,
    interestKnownPct: k.interestKnownPct,
    femalePct: k.femalePct,
    // Not derived as `100 - female`: the two are separate columns and the
    // audience pipeline does not guarantee they sum to 100, so inventing one
    // from the other would report a measurement nobody took.
    malePct: k.malePct,
    cities: (k.cities ?? [])
      .filter((c): c is { key: string; pct: number } => typeof c.pct === 'number'),
    interests,
    completeness: Math.round((filled / tracked.length) * 100),
  }
}
