import kolDb from '@/lib/kolDb'
import { toIso } from './util'
import { getKolMeasured, type KolMeasured } from './kolMeasured'
import { getKolGold, type KolGold } from './kolGold'
import { ADD_KOL_STEP_KEYS, RUN_FAILURE_STEP, STALLED_AFTER_MS } from '@/lib/kolDirectory/addKolRunStatus'

/**
 * Query layer for the KOL Directory page.
 *
 * Reads `public.kol_directory` in the commercial KOL database (see
 * `@/lib/kolDb`), joined to its lookup tables: `platforms` for the platform key,
 * `kol_categories` for the niche labels, and `kol_tiers` for the follower tier —
 * the tier bands live in that table rather than being hardcoded here so the page
 * follows whatever the KOL platform defines.
 *
 * Filtering, sorting and paging all run in SQL. The roster is ~7.7k creators, so
 * unlike the account-sized Discover Directory it cannot be shipped to the client
 * and filtered there.
 */

export type KolDataStatus = 'Live' | 'Estimated' | 'Calculated'

export interface KolDirectoryRow {
  id: string
  /** The roster has no display-name column; the username is the only identity. */
  username: string
  /**
   * The creator's own name, from `l2_gold.kol_profile_card.display_name` — the
   * roster genuinely has no column for it. Null when the pipeline has no card
   * for this creator, or when the name merely repeats the handle (printing
   * "@budi budi" helps nobody).
   */
  displayName: string | null
  platform: string | null
  profileUrl: string | null
  avatarUrl: string | null
  /** Filled for ~12% of the roster; the creator page falls back to a note. */
  bio: string | null
  city: string | null
  categories: string[]
  followers: number | null
  /** Percentage points, e.g. 0.98 means 0.98%. Null when never measured. */
  erPct: number | null
  tier: string | null
  /**
   * Percentage change in followers since this account's PREVIOUS snapshot,
   * from `l2_gold.kol_profile_card.followers_growth`. The gap is whatever the
   * scraper produced (10-13 days today), so never label it monthly or 30-day.
   * Null for creators scraped only once, which is most of the roster.
   */
  growthPct: number | null
  /**
   * How many of the creator's harvested posts actually carried a view count —
   * the denominator behind `avgViews` and `medianViews`, and the basis the UI
   * prints beside them.
   *
   * NOT the number of posts analysed. Instagram only reports views for video,
   * so a creator who mostly posts photos has far fewer posts with views than
   * posts harvested, and averaging over the larger number would be treating
   * "never measured" as zero. Zero here means the pipeline looked and found no
   * post carrying a view count; null means it has not looked yet.
   */
  viewsAnalyzedCount: number | null
  /**
   * Mean views across the posts that carried one, from
   * `l2_gold.kol_profile_card.avg_views` — computed in
   * `feature.*_engagement_analysis` and carried through untouched.
   * Null when no harvested post has a view count.
   */
  avgViews: number | null
  /**
   * Median views over the same posts `avgViews` covers. Interpolated for an
   * even number of them, so it can carry a half — the column keeps two decimals
   * rather than rounding the answer away.
   *
   * Shown beside the mean rather than instead of it: one viral post drags the
   * mean a long way and barely moves the median, and the gap between the two is
   * itself the signal.
   */
  medianViews: number | null
  /**
   * V2F — views over followers, as a percentage. The follower count is the one
   * on each post's OWN date, summed across posts, not the creator's following
   * today; the same additive rule `erPct` already uses.
   *
   * Routinely exceeds 100: one video reaching well past a small account's
   * following is ordinary, not an error, so never clamp it for display.
   */
  v2fPct: number | null
  /**
   * L2V — likes over views, as a percentage. Equivalent to average likes over
   * average views. Posts with zero or unknown views are excluded from both
   * sides of the fraction rather than counted as zero.
   */
  l2vPct: number | null
  /**
   * Follower change since the previous snapshot as a percentage, and the
   * working-threshold label over it. Both from `l2_gold.kol_profile_card`:
   * computed in `l1_silver.sp_build_unified_profile`, labelled by
   * `metrics_thresholds.py`, never recomputed here.
   *
   * `growthClass` is null exactly when `growthPct` is. An account with one
   * snapshot has no growth yet, which is not the same as growing badly.
   */
  growthClass: string | null
  /** Followers gained per day between the two snapshots. Not a percentage. */
  dailyGrowth: number | null
  /**
   * Growth 30D. `projected30d` is the projected DELTA over thirty days
   * (`dailyGrowth * 30`), and `projectedFollowers30d` is that delta applied to
   * the CURRENT snapshot. For 100 -> 125 over 25 days: delta 30, followers 155.
   *
   * A projection, not observed thirty-day growth: real snapshot gaps are
   * 10-15 days, and this extrapolates the measured daily rate. It never
   * requires the snapshots to be exactly 30 days apart.
   *
   * Both may be negative, and neither is clamped: an account losing followers
   * is exactly what this is meant to surface.
   */
  projected30d: number | null
  projectedFollowers30d: number | null
  /**
   * Audience gender split with `unknown` EXCLUDED from the denominator, so the
   * two always add to 100 when present. `genderKnownPct` says how much of the
   * audience that split actually covers - on this roster unknown dominates,
   * so it is not decoration.
   */
  femalePct: number | null
  malePct: number | null
  genderKnownPct: number | null
  /** High/Medium/Low over `genderKnownPct`. Rates the DATA, not the creator. */
  genderReliability: string | null
  /**
   * Sponsored posts over posts whose sponsorship is KNOWN, percent.
   * `paidSignalCount` is that denominator: without it a 0% cannot be told
   * apart from "nothing was ever measured".
   */
  paidRatio: number | null
  paidSignalCount: number | null
  /**
   * Shares over engagement (likes + comments + shares), percent. Null on
   * Instagram, which never reports shares - null, not zero. Deliberately NOT
   * shares/views: that is the old prototype's definition, not this one.
   */
  shareRate: number | null
  /**
   * Post frequency, MONTHLY ONLY - the agreed unit - over the REAL span
   * between first and last post, never a fixed window.
   *
   * `postFrequencyDaily` is kept as the basis behind it (monthly is daily x 30)
   * but stays out of the table, filters and export: one agreed unit, so two
   * numbers cannot disagree on screen. There is deliberately no weekly or
   * yearly variant.
   */
  postFrequencyDaily: number | null
  postFrequencyMonthly: number | null
  postFrequencyCount: number | null
  observationDays: number | null
  /**
   * High/Medium/Low from span AND post count together. Null when there is no
   * valid post at all - null is "not yet judgeable", not "Low".
   */
  postFrequencyReliability: string | null
  /**
   * The ER that produced `monitoringPriority`, carried so the label can be
   * audited. Not a competing source of truth for ER.
   */
  monitoringErPct: number | null
  /** High/Medium/Low over ER. A null ER stays null - never Low. */
  monitoringPriority: string | null
  /**
   * Discovery filters, migration 039. All carried through from
   * `l2_gold.kol_profile_card` untouched.
   *
   * The two `*Source` fields are what keep inferred from passing as observed:
   * `contentTopicSource` is 'creator_category_fallback' when the topic came
   * from the roster category rather than from real posts, and
   * `audienceInterestSource` is 'content_inferred' when audience interest was
   * entirely unknown and the creator's own content topic stood in for it.
   * A UI that prints the value without the source would be misleading.
   */
  saveRate: number | null
  viralFrequency: number | null
  viralPostCount: number | null
  contentTopic: string | null
  contentTopicSource: string | null
  formatDominant: string | null
  audienceQualityScore: number | null
  audienceQualityTier: string | null
  /**
   * Share of followers that do not match the bulk-account pattern, from
   * `feature.{ig,tt}_audience_analysis.authenticity_score` by way of the profile
   * card — the same value the creator profile shows. Null for a creator whose
   * follower sample was never analysed, which is most of the roster; it is not
   * modelled or substituted (D067).
   */
  authenticityScore: number | null
  audienceInterestTop: string | null
  audienceInterestSource: string | null
  /** Standard deviation of historical ER in PERCENTAGE POINTS, and how many
   *  periods produced it. Fewer than three and `performanceStability` is null:
   *  two points always look steady. */
  erStddevPp: number | null
  erPeriods: number | null
  performanceStability: string | null
  /** Growth >= 5%. Null when growth is unmeasured - null is NOT false. */
  risingCreator: boolean | null
  /** Business Connected: platform_user_id AND oauth_token both set. */
  connected: boolean
  /** Platform badge (blue tick). Separate from `connected` -- never derived
   *  from it, and never used to mean it. */
  verified: boolean
  status: KolDataStatus
  lastRefreshedAt: string | null
  /**
   * The three columns the source platform's directory carries that this one used
   * to leave out. They were left out because the roster row has no column for
   * them — which was true of EMV, authenticity, growth and brand fit, and is
   * still true. It was never true of these two: the agency tables name 7,684 of
   * the 7,718 creators, and `l1_silver.unified_rate_card` prices 7,230 of them.
   *
   * Both are attached after paging rather than joined in (`attachRosterExtras`),
   * because a LATERAL join for either runs before `LIMIT` and costs seconds.
   */
  agency: string | null
  /** Cheapest priced deliverable, in IDR. Null when the creator has no rate card. */
  rateFrom: number | null
  /** How many distinct deliverables carry a price. */
  rateCount: number
  /** Whether the requesting agency has this creator in My Creators; set by the route. */
  inMyCreators?: boolean
  /**
   * My Creators only (`scope=mine`): the agency's Monitored (true) / Paused
   * (false) state from `agency_kol_accounts.monitoring_enabled`; null when the
   * creator is not in the agency's My Creators. Set by the route.
   */
  monitoringEnabled?: boolean | null
  /**
   * My Creators only (`scope=mine`): Ready / Profiling / Failed for this
   * creator, from the same `PROFILING_STATUS` expression the D092 filter runs —
   * attached after paging by `attachRosterExtras`, never joined in.
   *
   * Absent on every other surface, and null when the creator answers none of
   * the three: no Add KOL run of its own and no L2 profile card yet, which is
   * most of the roster. Null draws no badge rather than a reassuring one.
   */
  profilingStatus?: ProfilingStatusFilter | null
}

export interface KolDirectoryFacets {
  categories: { name: string; count: number }[]
  platforms: { key: string; count: number }[]
  /** Ordered largest tier first, with the follower band the KOL platform defines. */
  tiers: { name: string; count: number; min: number; max: number | null }[]
  /** The whole active roster, for the "X of Y creators" line. */
  rosterTotal: number
  /** Agencies that actually list at least one active creator. */
  agencies: { name: string; count: number }[]
}

export interface KolDirectoryPayload {
  rows: KolDirectoryRow[]
  total: number
  page: number
  pageSize: number
  facets?: KolDirectoryFacets
}

export interface KolDirectoryQuery {
  /**
   * Fetch exactly these creators, ignoring paging.
   *
   * Compare needs the handful the user picked, which may sit on any page of a
   * 7.7k roster — filtering the list to find them again is not something the
   * caller can do. Every other filter still applies, so this narrows rather than
   * overrides; passing an empty array is treated as "no id filter" rather than
   * "no results", because an absent selection is not a selection of nothing.
   */
  ids?: string[] | null
  q?: string | null
  platform?: string | null
  category?: string | null
  tiers?: string[]
  minFollowers?: number | null
  minErPct?: number | null
  /**
   * Ceiling on the creator's cheapest priced deliverable, in IDR — the source
   * platform's "Max. rate card" slider. Creators with no rate card at all are
   * excluded when this is set: the filter asks for a price under a number, and
   * "no price" is not one.
   */
  maxRate?: number | null
  /** Percentage points. Null means no bound; 0 is a real bound, not "any". */
  minGrowth?: number | null
  maxGrowth?: number | null
  /**
   * Calculated-metric filters (migrations 037/038).
   *
   * Each drops rows whose metric is NULL while the filter is ON, and brings
   * them back the moment it is cleared - the rule `updatedWithinDays` already
   * follows. That is deliberate: "female audience >= 60%" cannot be answered
   * for a creator whose audience gender is unknown, and quietly counting them
   * as passing would be worse than leaving them out.
   */
  minFemalePct?: number | null
  minMalePct?: number | null
  maxPaidRatio?: number | null
  minPostFrequencyMonthly?: number | null
  minShareRate?: number | null
  /** Category filters. An absent or empty array means "no bound". */
  growthClass?: string[] | null
  postFrequencyReliability?: string[] | null
  monitoringPriority?: string[] | null
  /** Discovery filters, migration 039. Same NULL-drops-while-active rule. */
  minSaveRate?: number | null
  minViralFrequency?: number | null
  risingOnly?: boolean
  contentTopic?: string[] | null
  formatDominant?: string[] | null
  audienceQualityTier?: string[] | null
  performanceStability?: string[] | null
  audienceInterest?: string[] | null
  /** Audience location. `audienceGeoLevel` narrows which hierarchy level the
   *  key is matched against, so a city name cannot match a province row. */
  audienceGeoKey?: string | null
  audienceGeoLevel?: string | null
  connectedOnly?: boolean
  /**
   * Platform badge only. A SEPARATE axis from `connectedOnly` and never a
   * stand-in for it: measured 8 Sep, 572 creators carry a badge and 0 are
   * Connected, so folding either into the other would answer every query
   * wrongly. Both may be set; they then narrow together.
   */
  verifiedOnly?: boolean
  /**
   * Refreshed within this many days. The roster carries last_refreshed_at for
   * 7.497 of 7.721 active creators; the remaining 224 have never been refreshed
   * and are excluded whenever this filter is set, the same way an absent
   * follower count is excluded by follMin. 7 is the same boundary the status
   * chip already calls Live.
   */
  updatedWithinDays?: number | null
  /** Agency name, matched exactly against public.agencies.name. */
  agency?: string | null
  /**
   * My Creators: only creators this agency holds an active link to in
   * `agency_kol_accounts`. Matched on the id, never the name, and only ever set
   * by a route that has already checked the caller's membership of it.
   */
  agencyId?: string | null
  /**
   * My Creators profiling status (see `PROFILING_STATUS`). Only the route's
   * `scope=mine` branch passes it; null means no bound.
   */
  profilingStatus?: ProfilingStatusFilter | null
  /**
   * My Creators search (D085): `q` also matches the creator's
   * `l2_gold.kol_profile_card.display_name` — the name the card already shows,
   * never `agency_kol_accounts.label`, which is one agency's own label for the
   * relationship and differs between agencies. Only the route's `scope=mine`
   * branch sets it; every other search stays username-only.
   */
  searchDisplayName?: boolean
  sort?: string | null
  dir?: string | null
  page?: number
  pageSize?: number
}

/**
 * Sort keys are whitelisted and the direction is reduced to one of two literals:
 * both end up interpolated into the statement, never parameterised.
 */
const SORT_COLUMNS: Record<string, string> = {
  followers: 'followers',
  engagement: 'er_pct',
  // When the creator's numbers were last measured — not when the row appeared.
  recent: 'last_refreshed_at',
  // When the row appeared in the database. The Discovery landing's "Recently
  // added" shelf is this ordering: `recent` answers "who moved", which is a
  // different question and a different column.
  created: 'created_at',
  name: 'username',
  // Percentage change in followers since the account's previous snapshot.
  growth: 'growth_pct',
  // The three view rankings the source's DSORT carries. Ranking on the median
  // is not the same question as ranking on the mean — the mean finds accounts
  // with a viral hit, the median finds accounts that land consistently — so
  // both are offered rather than one standing in for the other.
  // L2V has no ranking here because the source has none either; it is a filter
  // there, and this port has no advanced-filter panel yet.
  avgviews: 'avg_views',
  medviews: 'median_views',
  v2f: 'v2f_pct',
  // Calculated metrics. Only the numeric ones are rankable - the three label
  // columns are categories, and ordering 'High' before 'Low' alphabetically
  // would be an accident dressed up as a ranking.
  paidratio: 'paid_ratio',
  sharerate: 'share_rate',
  postfreq: 'post_frequency_monthly',
  female: 'female_pct',
  male: 'male_pct',
  saverate: 'save_rate',
  viralfreq: 'viral_frequency',
}
export const KOL_SORT_KEYS = Object.keys(SORT_COLUMNS)

/**
 * The sort the user picked is the first key. Nothing outranks it.
 *
 * It used to be outranked. Provenance led every ordering —
 *
 *     CASE status WHEN 'Live' THEN 0 WHEN 'Calculated' THEN 1 ELSE 2 END ASC
 *
 * — on the reasoning that creators with real measurements behind them should
 * be shown first. With the distribution that reasoning produced (measured 8
 * Sep: Live 1, Calculated 27, Estimated 7.693) it meant 28 creators sat on top
 * of every list no matter what the user asked for, and the answer was wrong in
 * both directions at once: sorted by followers descending, bobbykertanegara
 * (948.683) came first and cristiano (679.264.838) second; sorted ascending,
 * the same row still came first, above sekata_ai on 200. A sort control that
 * cannot move the first row is not a sort control.
 *
 * `status` itself is untouched and still returned — the card and the table draw
 * it as the Live/Calculated/Estimated chip, and Discover reads it. It just no
 * longer decides the order. AUTOME_2 has no such rule either.
 *
 * TIE-BREAK ends on `id`, which is unique, because `username` is not: 7.721
 * active rows carry only 7.224 distinct usernames (a creator on two platforms
 * is two rows), so ordering that stopped at username left up to 497 rows in an
 * order the planner was free to change between queries. Two pages of the same
 * list could then repeat a creator and drop another. A unique last key makes
 * the ordering total, and paging stable.
 */
function orderBy(key: string, dir: string): string {
  const col = SORT_COLUMNS[key] ?? SORT_COLUMNS.followers
  const direction = dir === 'asc' ? 'ASC' : 'DESC'
  // NULLS LAST in both directions: a creator with no follower count or no
  // measured engagement belongs at the bottom of either ordering, not floated
  // to the top of the ascending one.
  // The username branch needs NULLS LAST spelled out too. Postgres defaults to
  // NULLS FIRST for DESC, so sorting by name descending used to open with the
  // rows whose username is null -- blank lines at the top of the list.
  return col === 'username'
    ? `username ${direction} NULLS LAST, id ASC`
    : `${col} ${direction} NULLS LAST, username ASC, id ASC`
}

const MAX_PAGE_SIZE = 60

/** `%` and `_` typed into the search box are literals, not LIKE wildcards. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, c => `\\${c}`)

/**
 * A name that just repeats the handle is not a display name — rendering it
 * would print "@budi budi" in the header. Same rule `identity.displayName`
 * already applies to the agency's label, kept in one place now that the roster
 * row carries a display name of its own.
 */
const cleanDisplayName = (name: string | null, username: string | null): string | null =>
  name && name.toLowerCase() !== (username ?? '').toLowerCase() ? name : null

/**
 * A creator's row is `active` unless the KOL platform has archived it; the page
 * only ever shows the active roster, so the predicate is shared by every query
 * here (list and facets) to keep the counts and the grid consistent.
 */
const ACTIVE = `kd.directory_status = 'active'`

/**
 * `category_ids` is the current column and `category_id` the single-value one it
 * replaced; ~half the roster still only has the latter, so both are read.
 */
const CATEGORY_IDS = `COALESCE(kd.category_ids, ARRAY[kd.category_id])`

/**
 * Engagement rate, measured first and rostered only as a fallback.
 *
 * `kol_directory.engagement_rate` is the weakest of the two sources available:
 * measured 8 Sep it holds 1.757 values whose maximum is 223,41% and of which 7
 * exceed 100% -- numbers an account-level engagement rate cannot take. The
 * `feature.*_engagement_analysis` tables hold the metric this project actually
 * computes: engagement over the follower count ON THE POST'S OWN DATE, summed
 * additively across a creator's posts, with collaboration and likes-hidden
 * posts excluded (see feature_engagement.py). Its 38 values span 0 to 16,15%.
 *
 * Preferring it costs no coverage: every one of those 38 creators is reachable
 * here, and 10 of them had no roster value at all, so the filter sees 1.767
 * creators where it used to see 1.757. The roster column stays for the other
 * 1.729 rather than being dropped, because a weak number the user can still
 * filter on beats no number.
 *
 * Ordered by follower count so a creator with several accounts answers with the
 * same account that supplies their avatar, bio and growth. Measured today every
 * creator has exactly one, so the ordering never actually decides anything --
 * it is there so that stops being true safely.
 */
const ER_LATERAL = `
    LEFT JOIN LATERAL (
      SELECT fe.engagement_rate
        FROM public.kol_social_account ksa
        JOIN (
          SELECT social_account_id, engagement_rate
            FROM feature.ig_engagement_analysis
          UNION ALL
          SELECT social_account_id, engagement_rate
            FROM feature.tt_engagement_analysis
        ) fe ON fe.social_account_id = ksa.social_account_id
        LEFT JOIN l2_gold.kol_profile_card c
               ON c.social_account_id = ksa.social_account_id
       WHERE ksa.kol_id = kd.id
         AND fe.engagement_rate IS NOT NULL
       ORDER BY c.followers_count DESC NULLS LAST
       LIMIT 1
    ) fer ON TRUE`

/** Measured metric first, roster column as fallback. See ER_LATERAL. */
const ER_PCT = 'COALESCE(fer.engagement_rate::float, kd.engagement_rate::float)'

/**
 * Engagement rate from the feature layer ONLY: the source of truth for the
 * creator profile and its ER ranking (audit 17 Sep 2026).
 *
 * The directory list keeps `ER_PCT` so its filter and sort do not lose the
 * ~1,700 creators that only have a roster value. The profile does not:
 * `kol_directory.engagement_rate` is a different definition (average of
 * per-post ratios over the current follower count, no shares), so showing it
 * there, or ranking a feature value against it, mixes two metrics. A creator
 * without a feature value reads "belum diukur" on the profile instead.
 */
const FEATURE_ER_PCT = 'fer.engagement_rate::float'

const BASE = `
  SELECT kd.id,
         kd.username,
         pl.key                                    AS platform,
         kd.profile_url,
         -- Identity from L2 first, roster as fallback. kol_profile_card is a
         -- strict superset here: measured 8 Sep, 1.045 creators have an avatar
         -- and 973 have a bio in L2 that the roster lacks, and ZERO have one in
         -- the roster that L2 lacks. COALESCE rather than a straight swap so a
         -- roster row that gets a value before the pipeline does never regresses.
         COALESCE(g.avatar_url, kd.avatar_url)     AS avatar_url,
         COALESCE(g.bio, kd.bio)                   AS bio,
         -- Aliased away from display_name on purpose: getKolCreator already
         -- selects agency_kol_accounts.label AS display_name alongside b.*,
         -- and two columns of the same name in one result set is a trap.
         g.display_name                            AS card_display_name,
         -- Verified -- the platform's blue tick, and NOT Connected. The two
         -- are separate facts and neither stands in for the other: a creator
         -- can carry a platform badge without ever linking the account, and
         -- measured 8 Sep every one of the 572 badged accounts is exactly
         -- that. Sourced from l2_gold.kol_profile_card.is_verified, which
         -- the gold asset fills from the platform payload (Instagram) and
         -- the harmonized TikTok column -- see decision #7 in
         -- gold_profile.py. Comes from the same card the avatar and bio do,
         -- so a creator with two accounts shows the badge of the larger one.
         COALESCE(g.is_verified, false)            AS verified,
         kd.creator_city                           AS city,
         cats.names                                AS categories,
         cats.keys                                 AS category_keys,
         kd.followers_count                        AS followers,
         ${ER_PCT}                                 AS er_pct,
         ${FEATURE_ER_PCT}                         AS feature_er_pct,
         t.name                                    AS tier,
         -- Connected -- the business definition, not the platform's blue tick.
         -- A creator is Connected when they have actually linked the account
         -- through OAuth: social_account.platform_user_id AND oauth_token are
         -- both present. kol_directory.verified_status (the old source) is the
         -- platform badge and says nothing about connection, and
         -- social_account.connected is a legacy column that is never filled.
         EXISTS (
           SELECT 1
             FROM public.kol_social_account ksa
             JOIN public.social_account sa ON sa.id = ksa.social_account_id
            WHERE ksa.kol_id = kd.id
              AND sa.platform_user_id IS NOT NULL
              AND sa.oauth_token IS NOT NULL
         )                                         AS connected,
         -- Provenance, using the same three labels the rest of Discover uses:
         -- a recent refresh is Live, an older row that was actually scraped
         -- (see migration 004 in scrapper-project — scrape_status is kept in
         -- sync with whether l0_raw actually holds follower data for this
         -- account, not with whatever the old per-platform pipelines happened
         -- to write) is Calculated, and a row with no completed scrape at all
         -- is Estimated. engagement_rate IS NOT NULL used to stand in for
         -- this and was wrong for ~9% of the roster — a null-but-measured
         -- TikTok row read as Estimated, and hundreds of profile-only
         -- Instagram rows read as Calculated with no post or follower behind
         -- them.
         CASE
           WHEN kd.last_refreshed_at >= now() - interval '7 days' THEN 'Live'
           WHEN kd.scrape_status = 'success'                      THEN 'Calculated'
           ELSE 'Estimated'
         END                                       AS status,
         g.followers_growth::float                 AS growth_pct,
         -- The four view metrics, straight from L2. The float casts are there
         -- for the same reason growth_pct needs one: node-pg hands numeric back
         -- as a string because it will not promise the value fits a JS number,
         -- and these all do. NULL survives the cast and stays NULL.
         g.views_analyzed_count                    AS views_analyzed_count,
         g.avg_views::float                        AS avg_views,
         g.median_views::float                     AS median_views,
         g.view_to_follower_ratio::float           AS v2f_pct,
         g.like_to_view_ratio::float               AS l2v_pct,
         -- Calculated metrics, migrations 037/038. Same float-cast reason as
         -- growth_pct above. The label columns are text and need no cast.
         g.growth_class                            AS growth_class,
         g.daily_growth::float                     AS daily_growth,
         g.projected_30d                           AS projected_30d,
         g.projected_followers_30d                 AS projected_followers_30d,
         g.female_pct::float                       AS female_pct,
         g.male_pct::float                         AS male_pct,
         g.gender_known_pct::float                 AS gender_known_pct,
         g.gender_reliability                      AS gender_reliability,
         g.paid_ratio::float                       AS paid_ratio,
         g.paid_signal_count                       AS paid_signal_count,
         g.share_rate::float                       AS share_rate,
         g.post_frequency_daily::float             AS post_frequency_daily,
         g.post_frequency_monthly::float           AS post_frequency_monthly,
         g.post_frequency_count                    AS post_frequency_count,
         g.observation_days                        AS observation_days,
         g.post_frequency_reliability              AS post_frequency_reliability,
         g.monitoring_er_pct::float                AS monitoring_er_pct,
         g.monitoring_priority                     AS monitoring_priority,
         -- Discovery filters, migration 039.
         g.save_rate::float                        AS save_rate,
         g.viral_frequency::float                  AS viral_frequency,
         g.viral_post_count                        AS viral_post_count,
         g.content_topic                           AS content_topic,
         g.content_topic_source                    AS content_topic_source,
         g.format_dominant                         AS format_dominant,
         g.audience_quality_score::float           AS audience_quality_score,
         g.audience_quality_tier                   AS audience_quality_tier,
         g.authenticity_score::float               AS authenticity_score,
         g.audience_interest_top                   AS audience_interest_top,
         g.audience_interest_source                AS audience_interest_source,
         g.er_stddev_pp::float                     AS er_stddev_pp,
         g.er_periods                              AS er_periods,
         g.performance_stability                   AS performance_stability,
         g.rising_creator                          AS rising_creator,
         kd.last_refreshed_at,
         -- Not mapped onto the row; inputs of the My Creators profiling-status
         -- filter (PROFILING_STATUS below).
         kd.scrape_status                          AS scrape_status,
         (g.card_id IS NOT NULL)                   AS has_profile_card,
         -- Not mapped onto the row; carried so the list can be ordered by when
         -- a creator was added, which is what the Discovery landing's "Recently
         -- added" shelf asks for. last_refreshed_at above answers a different
         -- question — when the numbers were last measured.
         kd.created_at
    FROM public.kol_directory kd
    LEFT JOIN public.platforms pl ON pl.id = kd.platform_id
    -- Tier bands come from the lookup table, so a creator under the smallest
    -- band (or with no follower count at all) simply has no tier.
    LEFT JOIN public.kol_tiers t
           ON kd.followers_count >= t.min_followers
          AND (t.max_followers IS NULL OR kd.followers_count <= t.max_followers)
    LEFT JOIN LATERAL (
      SELECT ARRAY_AGG(kc.name ORDER BY kc.name) AS names,
             -- What the category filter matches on. name has 28 values that
             -- fragment 9 real taxonomies: picking "Dance" answers with 3
             -- creators when Entertainment holds 501, and "Foodies" with 66
             -- when Food holds 123. kol_categories.taxonomy_key is the grouping
             -- the platform actually means, and the sibling implementation
             -- (db.py in scrapper-project) already filters on it -- this side
             -- was the odd one out.
             --
             -- COALESCE to name because 6 of the 28 rows have no taxonomy_key
             -- yet; without it those categories, and the 20 creators carrying
             -- them, would stop being reachable by any chip at all.
             --
             -- names is untouched and still what the card and the CSV show,
             -- so the display stays as specific as it always was. Only the
             -- filter widens.
             ARRAY_AGG(DISTINCT COALESCE(kc.taxonomy_key, kc.name)) AS keys
        FROM public.kol_categories kc
       WHERE kc.id = ANY (${CATEGORY_IDS})
    ) cats ON TRUE
    -- Follower growth, the only measured one that exists: L1 computes
    -- (current - previous) / previous * 100 over consecutive profile
    -- snapshots and l2_gold.kol_profile_card carries it through untouched.
    -- LATERAL ... LIMIT 1 rather than a plain join so the roster row stays
    -- one row even if a creator ever maps to more than one linked account;
    -- ordered by followers to pick the same account the detail page shows.
    -- Growth plus the three identity columns L2 holds more of than the roster.
    -- followers and tier deliberately stay on kol_directory: that is the agreed
    -- source of truth for both, and reconciling them is a separate decision.
    LEFT JOIN LATERAL (
      SELECT c.id AS card_id,
             c.followers_growth, c.avatar_url, c.bio, c.display_name, c.is_verified,
             -- Avg/Median Views, V2F and L2V. Same card, same account, so they
             -- describe the same profile the avatar and growth already do —
             -- no second lateral, and no chance of two joins disagreeing about
             -- which of a creator's accounts answered.
             c.views_analyzed_count, c.avg_views, c.median_views,
             c.view_to_follower_ratio, c.like_to_view_ratio,
             -- Calculated metrics ride the SAME lateral, so they always
             -- describe the same account the avatar and growth already do.
             c.growth_class, c.daily_growth, c.projected_30d,
             c.projected_followers_30d,
             c.female_pct, c.male_pct, c.gender_known_pct, c.gender_reliability,
             c.paid_ratio, c.paid_signal_count, c.share_rate,
             c.post_frequency_daily, c.post_frequency_monthly,
             c.post_frequency_count, c.observation_days,
             c.post_frequency_reliability,
             c.monitoring_er_pct, c.monitoring_priority,
             c.save_rate, c.viral_frequency, c.viral_post_count,
             c.content_topic, c.content_topic_source, c.format_dominant,
             c.audience_quality_score, c.audience_quality_tier,
             -- Authenticity rides the same card as the audience-quality score
             -- it sits next to, so both describe one account (D067).
             c.authenticity_score,
             c.audience_interest_top, c.audience_interest_source,
             c.er_stddev_pp, c.er_periods, c.performance_stability,
             c.rising_creator
        FROM public.kol_social_account ksa
        JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
       WHERE ksa.kol_id = kd.id
       ORDER BY c.followers_count DESC NULLS LAST
       LIMIT 1
    ) g ON TRUE${ER_LATERAL}
   WHERE ${ACTIVE}`

/**
 * My Creators profiling status, derived — there is no stored column that can
 * answer it (`kol_directory.scrape_status` marks attempts, and the TikTok path
 * never writes it). Evaluated per row of `filtered` (alias `b`), in this order:
 *
 *   failed     the creator's newest Add KOL run failed — a failed step, a
 *              failed `run` row, or a step still `running` past the stall
 *              threshold — OR `scrape_status = 'failed'` with no L2 card
 *   profiling  the newest Add KOL run has started one of its steps and has
 *              neither failed nor finished every step
 *   ready      the creator has an `l2_gold.kol_profile_card`
 *   NULL       none of these (only "Any" shows them)
 *
 * The run rules are `getAddKolRunStatus`'s: same step lists, same `run` step,
 * same stall threshold, passed in as $37-$40 from `addKolRunStatus.ts`. The
 * newest run is the one owning the newest log row across both tables.
 */
const PROFILING_STATUS = `(
  SELECT CASE
           WHEN run.failed THEN 'failed'
           WHEN b.scrape_status = 'failed' AND NOT b.has_profile_card THEN 'failed'
           WHEN run.started AND NOT run.complete THEN 'profiling'
           WHEN b.has_profile_card THEN 'ready'
         END
    FROM (
      SELECT COALESCE(bool_or(
               (r.step = ANY (x.steps) OR r.step = $40)
               AND (r.status = 'failed'
                    OR (r.status = 'running'
                        AND r.started_at < now() - make_interval(secs => $37::float8 / 1000)))
             ), false) AS failed,
             COUNT(r.step) FILTER (WHERE r.step = ANY (x.steps)) > 0 AS started,
             COUNT(DISTINCT r.step) FILTER (WHERE r.step = ANY (x.steps) AND r.status = 'success')
               = cardinality(x.steps) AS complete
        FROM (SELECT CASE WHEN b.platform = 'tiktok' THEN $39::text[] ELSE $38::text[] END AS steps) x
        LEFT JOIN (
          SELECT l.step, l.status, l.started_at
            FROM (
              SELECT run_id, step, status, started_at FROM public.add_kol_scrape_log WHERE kol_directory_id = b.id
              UNION ALL
              SELECT run_id, step, status, started_at FROM public.add_kol_pipeline_log WHERE kol_directory_id = b.id
            ) l
           WHERE l.run_id = (
             SELECT n.run_id FROM (
               SELECT run_id, started_at FROM public.add_kol_scrape_log WHERE kol_directory_id = b.id
               UNION ALL
               SELECT run_id, started_at FROM public.add_kol_pipeline_log WHERE kol_directory_id = b.id
             ) n
             ORDER BY n.started_at DESC
             LIMIT 1)
        ) r ON TRUE
       GROUP BY x.steps
    ) run
)`

export const PROFILING_STATUSES = ['ready', 'profiling', 'failed'] as const
export type ProfilingStatusFilter = (typeof PROFILING_STATUSES)[number]

/**
 * The four values `PROFILING_STATUS` reads, in the order its placeholders take
 * them ($37-$40 in the list statement). Kept as one list so a statement that
 * binds them somewhere else cannot get the order wrong.
 */
const RUN_RULE_PARAMS = [
  STALLED_AFTER_MS,
  [...ADD_KOL_STEP_KEYS.instagram],
  [...ADD_KOL_STEP_KEYS.tiktok],
  RUN_FAILURE_STEP,
]

/**
 * `PROFILING_STATUS` with its four run-rule placeholders moved to `$first` and
 * the three after it. The expression above stays the one definition of the
 * rules; this moves placeholders and nothing else, because Postgres numbers
 * parameters per statement: the list query binds these at 37-40, and a
 * statement that only asks about one page of ids binds them much earlier.
 *
 * Padding the short statement out to forty parameters instead does not work —
 * an unreferenced `$1` fails to parse ("could not determine data type of
 * parameter $1").
 */
const profilingStatusAt = (first: number) =>
  PROFILING_STATUS.replace(/\$(37|38|39|40)\b/g, (_m, n: string) => `$${first + Number(n) - 37}`)

/**
 * The same status for an explicit set of creators: same expression, asked only
 * about the ids that survived paging.
 *
 * `b` supplies exactly the columns the expression reads off the row — `id`,
 * `platform` (which step list applies), `scrape_status` and whether the creator
 * has an L2 profile card. `has_profile_card` is the EXISTS form of the list
 * query's `g.card_id IS NOT NULL`: same two tables, same join, so the badge and
 * the D092 filter can never disagree about who is `ready`.
 */
const PROFILING_STATUS_BY_ID = `
  SELECT b.id, ${profilingStatusAt(2)} AS profiling_status
    FROM (
      SELECT kd.id,
             pl.key AS platform,
             kd.scrape_status,
             EXISTS (
               SELECT 1
                 FROM public.kol_social_account ksa
                 JOIN l2_gold.kol_profile_card c
                   ON c.social_account_id = ksa.social_account_id
                WHERE ksa.kol_id = kd.id
             ) AS has_profile_card
        FROM public.kol_directory kd
        LEFT JOIN public.platforms pl ON pl.id = kd.platform_id
       WHERE kd.id = ANY($1::uuid[])
    ) b`

/**
 * Fills in `agency`, `rateFrom` and `rateCount` for one page of roster rows.
 *
 * Two extra round trips instead of two joins, and that is the point. Written as
 * LATERAL joins against `kol_directory` both of these run before the `LIMIT`,
 * so the planner evaluates them for the whole active roster: measured at 4.2s
 * for the agency lookup and 2.7s for the rate card, against 15-23ms each when
 * they are asked only about the twelve ids that survived paging.
 *
 * Mutates in place and returns nothing: the caller has already built the row
 * objects, and rebuilding them to attach two fields would be the more confusing
 * of the two shapes.
 *
 * `profilingStatus` rides along for My Creators only (D052), and for the same
 * reason the other two do: `PROFILING_STATUS` is a correlated subquery, so in
 * the list statement's target list the planner would run it for every row of
 * `filtered` — all 7.4k of them — before `LIMIT` ever trims the page.
 */
async function attachRosterExtras(
  rows: KolDirectoryRow[],
  opts: { profilingStatus?: boolean } = {},
): Promise<void> {
  const ids = rows.map(r => r.id)
  if (!ids.length) return

  const db = kolDb()
  const [agencies, rates, profiling] = await Promise.all([
    db.query<{ kol_account_id: string; name: string | null }>(
      `SELECT DISTINCT ON (a.kol_account_id) a.kol_account_id, ag.name
         FROM public.agency_kol_accounts a
         JOIN public.agencies ag ON ag.id = a.agency_id AND ag.deleted_at IS NULL
        WHERE a.kol_account_id = ANY($1::uuid[])
        ORDER BY a.kol_account_id, a.created_at DESC NULLS LAST`,
      [ids],
    ),
    db.query<{ kol_id: string; min_fee: string | null; n: number }>(
      `SELECT ksa.kol_id,
              MIN(u.fee)::bigint             AS min_fee,
              COUNT(DISTINCT u.post_type)::int AS n
         FROM public.kol_social_account ksa
         JOIN l1_silver.unified_rate_card u ON u.social_account_id = ksa.social_account_id
        WHERE ksa.kol_id = ANY($1::uuid[]) AND u.fee IS NOT NULL
        GROUP BY ksa.kol_id`,
      [ids],
    ),
    opts.profilingStatus
      ? db.query<{ id: string; profiling_status: ProfilingStatusFilter | null }>(
          PROFILING_STATUS_BY_ID, [ids, ...RUN_RULE_PARAMS],
        )
      : null,
  ])

  const byAgency = new Map(agencies.rows.map(r => [r.kol_account_id, r.name]))
  const byRate = new Map(rates.rows.map(r => [r.kol_id, r]))
  // Absent (not null) on every other surface: the Creator Database does not ask
  // the question, and a null there would read as "asked, and none of the three".
  const byProfiling = profiling
    ? new Map(profiling.rows.map(r => [r.id, r.profiling_status]))
    : null

  for (const row of rows) {
    row.agency = byAgency.get(row.id) ?? null
    const rate = byRate.get(row.id)
    row.rateFrom = rate?.min_fee ? Number(rate.min_fee) : null
    row.rateCount = rate?.n ?? 0
    if (byProfiling) row.profilingStatus = byProfiling.get(row.id) ?? null
  }
}

export async function listKolDirectory(query: KolDirectoryQuery): Promise<KolDirectoryPayload> {
  const order = orderBy(query.sort ?? 'followers', query.dir ?? 'desc')
  const pageSize = Math.min(Math.max(Math.trunc(query.pageSize ?? 20), 1), MAX_PAGE_SIZE)
  const page = Math.max(Math.trunc(query.page ?? 1), 1)
  const q = query.q?.trim() ? escapeLike(query.q.trim()) : null
  const tiers = query.tiers?.length ? query.tiers : null

  const { rows } = await kolDb().query<{
    id: string; username: string | null; platform: string | null
    profile_url: string | null; avatar_url: string | null; bio: string | null; city: string | null
    card_display_name: string | null
    categories: string[] | null; followers: number | null; er_pct: number | null
    tier: string | null; growth_pct: number | null; connected: boolean
    views_analyzed_count: number | null; avg_views: number | null
    median_views: number | null; v2f_pct: number | null; l2v_pct: number | null
    growth_class: string | null; daily_growth: number | null
    projected_30d: number | null; projected_followers_30d: number | null
    female_pct: number | null; male_pct: number | null
    gender_known_pct: number | null; gender_reliability: string | null
    paid_ratio: number | null; paid_signal_count: number | null
    share_rate: number | null
    post_frequency_daily: number | null; post_frequency_monthly: number | null
    post_frequency_count: number | null; observation_days: number | null
    post_frequency_reliability: string | null
    monitoring_er_pct: number | null; monitoring_priority: string | null
    save_rate: number | null; viral_frequency: number | null
    viral_post_count: number | null
    content_topic: string | null; content_topic_source: string | null
    format_dominant: string | null
    audience_quality_score: number | null; audience_quality_tier: string | null
    authenticity_score: number | null
    audience_interest_top: string | null; audience_interest_source: string | null
    er_stddev_pp: number | null; er_periods: number | null
    performance_stability: string | null; rising_creator: boolean | null
    verified: boolean; status: KolDataStatus
    last_refreshed_at: Date | string | null; total_count: number
  }>(
    `
    WITH base AS (${BASE}),
    filtered AS (
      SELECT * FROM base b
       WHERE ($1::text     IS NULL OR b.username ILIKE '%' || $1 || '%'
              -- My Creators also searches the profile-card name (D085).
              -- EXISTS rather than the lateral's column, which would make the
              -- card lookup run for every creator before the filter applies. A
              -- creator without a card simply has no name to match.
              OR ($41::boolean IS TRUE AND EXISTS (
                   SELECT 1
                     FROM public.kol_social_account ksa
                     JOIN l2_gold.kol_profile_card c
                       ON c.social_account_id = ksa.social_account_id
                    WHERE ksa.kol_id = b.id
                      AND c.display_name ILIKE '%' || $1 || '%')))
         AND ($2::text     IS NULL OR b.platform = $2)
         -- Taxonomy key first; the sub-name is still accepted so a link
         -- saved before the chips became keys keeps answering. Safe by
         -- construction: every name maps to its own key, so the rows a name
         -- matches are a subset of the rows its key matches -- a chip's count
         -- and its result stay exactly equal, and only a value that is no
         -- longer a chip (Dance, Foodies, Travel) gains anything from the
         -- second arm.
         AND ($3::text     IS NULL OR $3 = ANY (b.category_keys)
                                   OR $3 = ANY (b.categories))
         AND ($4::text[]   IS NULL OR b.tier = ANY ($4))
         AND ($5::float8   IS NULL OR b.er_pct >= $5)
         AND ($6::boolean  IS NOT TRUE OR b.connected)
         AND ($14::boolean IS NOT TRUE OR b.verified)
         -- Last updated. NULL last_refreshed_at never satisfies a "within N
         -- days" question, so those rows drop out while the filter is on and
         -- come back the moment it is cleared.
         AND ($15::int     IS NULL
              OR b.last_refreshed_at >= now() - ($15::int * INTERVAL '1 day'))
         -- Agency. EXISTS, not a join: a creator listed by two agencies is one
         -- creator, and a join here would print them twice and inflate the
         -- count. Mirrors the pattern the Connected clause already uses.
         AND ($16::text    IS NULL OR EXISTS (
               SELECT 1
                 FROM public.agency_kol_accounts a
                 JOIN public.agencies ag ON ag.id = a.agency_id
                                        AND ag.deleted_at IS NULL
                WHERE a.kol_account_id = b.id AND ag.name = $16))
         -- My Creators. Same EXISTS shape as the agency-name filter, keyed on
         -- the agency id and limited to links that are still active.
         AND ($35::uuid    IS NULL OR EXISTS (
               SELECT 1
                 FROM public.agency_kol_accounts a
                WHERE a.kol_account_id = b.id
                  AND a.agency_id = $35
                  AND a.is_active IS TRUE))
         AND ($9::bigint   IS NULL OR b.followers >= $9)
         AND ($10::uuid[]  IS NULL OR b.id = ANY ($10))
         -- Rate card ceiling. EXISTS rather than a join so a creator with three
         -- priced deliverables stays one row; measured at 19ms over the roster.
         AND ($12::float8  IS NULL OR b.growth_pct >= $12)
         AND ($13::float8  IS NULL OR b.growth_pct <= $13)
         AND ($11::bigint IS NULL OR EXISTS (
               SELECT 1
                 FROM public.kol_social_account ksa
                 JOIN l1_silver.unified_rate_card u
                   ON u.social_account_id = ksa.social_account_id
                WHERE ksa.kol_id = b.id AND u.fee IS NOT NULL AND u.fee <= $11))
         -- Calculated-metric filters (037/038). Each is inert while its
         -- parameter is NULL, so a creator missing the metric only disappears
         -- when someone actually asks a question that metric has to answer.
         AND ($17::float8 IS NULL OR b.female_pct  >= $17)
         AND ($18::float8 IS NULL OR b.male_pct    >= $18)
         -- Paid ratio is a CEILING: "show me creators who are not mostly ads".
         AND ($19::float8 IS NULL OR b.paid_ratio  <= $19)
         AND ($20::float8 IS NULL OR b.post_frequency_monthly >= $20)
         AND ($21::float8 IS NULL OR b.share_rate  >= $21)
         -- Category filters. Empty array is normalised to NULL before binding,
         -- so an untouched multi-select never filters anything out.
         AND ($22::text[] IS NULL OR b.growth_class = ANY ($22))
         AND ($23::text[] IS NULL OR b.post_frequency_reliability = ANY ($23))
         AND ($24::text[] IS NULL OR b.monitoring_priority = ANY ($24))
         -- Discovery filters, migration 039.
         AND ($25::float8 IS NULL OR b.save_rate       >= $25)
         AND ($26::float8 IS NULL OR b.viral_frequency >= $26)
         -- Rising: TRUE only. A null growth is not a failed one, so it stays
         -- out while the toggle is on and returns the moment it is cleared.
         AND ($27::boolean IS NOT TRUE OR b.rising_creator IS TRUE)
         AND ($28::text[] IS NULL OR b.content_topic         = ANY ($28))
         AND ($29::text[] IS NULL OR b.format_dominant       = ANY ($29))
         AND ($30::text[] IS NULL OR b.audience_quality_tier = ANY ($30))
         AND ($31::text[] IS NULL OR b.performance_stability = ANY ($31))
         AND ($32::text[] IS NULL OR b.audience_interest_top = ANY ($32))
         -- Audience location. EXISTS against the daily table rather than a
         -- card column: a creator has many locations, and flattening them to
         -- one would answer a different question. The level is matched too,
         -- so "Bali" as a province never collides with a city of the same
         -- spelling -- the mix-up migration 039 set out to fix.
         AND ($33::text IS NULL OR EXISTS (
               SELECT 1
                 FROM public.kol_social_account ksa
                 JOIN l2_gold.audience_geo_daily gd
                   ON gd.social_account_id = ksa.social_account_id
                WHERE ksa.kol_id = b.id
                  AND gd.geo_key = $33
                  AND ($34::text IS NULL OR gd.geo_level = $34)))
         -- My Creators profiling status, before paging so the total and
         -- every page count only matching creators.
         AND ($36::text IS NULL OR ${PROFILING_STATUS} = $36)
    )
    SELECT *, COUNT(*) OVER()::int AS total_count
      FROM filtered
     ORDER BY ${order}
     LIMIT $7 OFFSET $8`,
    [
      q,
      query.platform || null,
      query.category || null,
      tiers,
      query.minErPct ?? null,
      query.connectedOnly === true,
      pageSize,
      (page - 1) * pageSize,
      query.minFollowers ? Math.trunc(query.minFollowers) : null,
      query.ids?.length ? query.ids : null,
      query.maxRate != null && Number.isFinite(query.maxRate)
        ? Math.trunc(query.maxRate)
        : null,
      // Growth bounds are not truncated and 0 is meaningful: a creator can sit
      // exactly at 0.0000%, and eight of them do.
      query.minGrowth ?? null,
      query.maxGrowth ?? null,
      query.verifiedOnly === true,
      query.updatedWithinDays != null && Number.isFinite(query.updatedWithinDays)
        ? Math.trunc(query.updatedWithinDays)
        : null,
      query.agency || null,
      // Numeric bounds are not truncated and 0 is meaningful throughout:
      // 0% paid and 0% share are real answers, not "unset".
      query.minFemalePct ?? null,
      query.minMalePct ?? null,
      query.maxPaidRatio ?? null,
      query.minPostFrequencyMonthly ?? null,
      query.minShareRate ?? null,
      // `?.length ? ... : null` and not `?? null`: an empty array would
      // otherwise match nothing at all and silently empty the directory.
      query.growthClass?.length ? query.growthClass : null,
      query.postFrequencyReliability?.length ? query.postFrequencyReliability : null,
      query.monitoringPriority?.length ? query.monitoringPriority : null,
      query.minSaveRate ?? null,
      query.minViralFrequency ?? null,
      query.risingOnly === true,
      query.contentTopic?.length ? query.contentTopic : null,
      query.formatDominant?.length ? query.formatDominant : null,
      query.audienceQualityTier?.length ? query.audienceQualityTier : null,
      query.performanceStability?.length ? query.performanceStability : null,
      query.audienceInterest?.length ? query.audienceInterest : null,
      query.audienceGeoKey || null,
      query.audienceGeoLevel || null,
      query.agencyId || null,
      query.profilingStatus || null,
      STALLED_AFTER_MS,
      [...ADD_KOL_STEP_KEYS.instagram],
      [...ADD_KOL_STEP_KEYS.tiktok],
      RUN_FAILURE_STEP,
      query.searchDisplayName === true,
    ],
  )

  const mapped: KolDirectoryRow[] = rows.map(r => ({
      id: r.id,
      username: r.username ?? '—',
      displayName: cleanDisplayName(r.card_display_name, r.username),
      platform: r.platform,
      profileUrl: r.profile_url,
      avatarUrl: r.avatar_url,
      bio: r.bio,
      city: r.city,
      categories: r.categories ?? [],
      followers: r.followers,
      erPct: r.er_pct,
      tier: r.tier,
      growthPct: r.growth_pct,
      // Straight through, null included. A creator the pipeline has no view
      // data for shows nothing rather than a zero — the rule erPct follows.
      viewsAnalyzedCount: r.views_analyzed_count,
      avgViews: r.avg_views,
      medianViews: r.median_views,
      v2fPct: r.v2f_pct,
      l2vPct: r.l2v_pct,
      // Straight through, null included — the same rule the four view metrics
      // above already follow. Nothing is recomputed on this side.
      growthClass: r.growth_class,
      dailyGrowth: r.daily_growth,
      projected30d: r.projected_30d,
      projectedFollowers30d: r.projected_followers_30d,
      femalePct: r.female_pct,
      malePct: r.male_pct,
      genderKnownPct: r.gender_known_pct,
      genderReliability: r.gender_reliability,
      paidRatio: r.paid_ratio,
      paidSignalCount: r.paid_signal_count,
      shareRate: r.share_rate,
      postFrequencyDaily: r.post_frequency_daily,
      postFrequencyMonthly: r.post_frequency_monthly,
      postFrequencyCount: r.post_frequency_count,
      observationDays: r.observation_days,
      postFrequencyReliability: r.post_frequency_reliability,
      monitoringErPct: r.monitoring_er_pct,
      monitoringPriority: r.monitoring_priority,
      saveRate: r.save_rate,
      viralFrequency: r.viral_frequency,
      viralPostCount: r.viral_post_count,
      contentTopic: r.content_topic,
      contentTopicSource: r.content_topic_source,
      formatDominant: r.format_dominant,
      audienceQualityScore: r.audience_quality_score,
      audienceQualityTier: r.audience_quality_tier,
      authenticityScore: r.authenticity_score,
      audienceInterestTop: r.audience_interest_top,
      audienceInterestSource: r.audience_interest_source,
      erStddevPp: r.er_stddev_pp,
      erPeriods: r.er_periods,
      performanceStability: r.performance_stability,
      risingCreator: r.rising_creator,
      connected: r.connected,
      verified: r.verified,
      status: r.status,
      lastRefreshedAt: toIso(r.last_refreshed_at),
      // Filled by attachRosterExtras below; declared here so the row is never
      // half-built between the two statements.
      agency: null,
      rateFrom: null,
      rateCount: 0,
  }))

  // The status is a My Creators question (D052/D092), and `agencyId` is what
  // the route sets for `scope=mine` — the same switch the filter already reads.
  await attachRosterExtras(mapped, { profilingStatus: Boolean(query.agencyId) })

  return {
    rows: mapped,
    // COUNT(*) OVER() gives the filtered total in the same round trip, but only
    // on rows that came back — an out-of-range page returns none.
    total: rows[0]?.total_count ?? 0,
    page,
    pageSize,
  }
}

/**
 * Filter options with their counts, over the whole active roster rather than the
 * current result set: a category that would empty the grid is still worth
 * showing with its real count, and re-deriving these on every keystroke would
 * make the option list jump around while someone types.
 */
export async function listKolFacets(
  opts: {
    /**
     * My Creators (D087): categories come only from creators this agency holds
     * an active `agency_kol_accounts` link to — the same predicate the list
     * uses for `scope=mine`. Only the category facet is scoped; the others and
     * the Creator Database (no agency) are unchanged.
     */
    agencyId?: string | null
  } = {},
): Promise<KolDirectoryFacets> {
  const mineOnly = opts.agencyId
    ? `
         AND EXISTS (SELECT 1
                       FROM public.agency_kol_accounts a
                      WHERE a.kol_account_id = kd.id
                        AND a.agency_id = $1
                        AND a.is_active IS TRUE)`
    : ''
  const [categories, platforms, tiers, roster, agencies] = await Promise.all([
    kolDb().query<{ name: string; count: number }>(`
      -- The chip value must be the value the filter matches, or the count on
      -- the chip and the length of the result stop agreeing. Same expression
      -- as cats.keys in BASE. COUNT(DISTINCT) because several names collapse
      -- into one key and a creator tagged both "Food" and "Foodies" is one
      -- creator, not two.
      SELECT COALESCE(kc.taxonomy_key, kc.name) AS name,
             COUNT(DISTINCT kd.id)::int         AS count
        FROM public.kol_directory kd
        JOIN public.kol_categories kc ON kc.id = ANY (${CATEGORY_IDS})
       WHERE ${ACTIVE}${mineOnly}
       GROUP BY COALESCE(kc.taxonomy_key, kc.name)
       ORDER BY count DESC, 1`, opts.agencyId ? [opts.agencyId] : undefined),
    kolDb().query<{ key: string; count: number }>(`
      SELECT pl.key, COUNT(*)::int AS count
        FROM public.kol_directory kd
        JOIN public.platforms pl ON pl.id = kd.platform_id
       WHERE ${ACTIVE}
       GROUP BY pl.key
       ORDER BY count DESC`),
    kolDb().query<{ name: string; count: number; min: number; max: number | null }>(`
      SELECT t.name, COUNT(kd.id)::int AS count,
             t.min_followers AS min, t.max_followers AS max
        FROM public.kol_tiers t
        LEFT JOIN public.kol_directory kd
               ON kd.directory_status = 'active'
              AND kd.followers_count >= t.min_followers
              AND (t.max_followers IS NULL OR kd.followers_count <= t.max_followers)
       GROUP BY t.name, t.min_followers, t.max_followers
       ORDER BY t.min_followers DESC`),
    kolDb().query<{ count: number }>(`
      SELECT COUNT(*)::int AS count FROM public.kol_directory kd WHERE ${ACTIVE}`),
    // Agencies with at least one active creator. COUNT(DISTINCT) because one
    // creator can be listed by an agency more than once, and the chip has to
    // agree with what the filter returns.
    kolDb().query<{ name: string; count: number }>(`
      SELECT ag.name, COUNT(DISTINCT kd.id)::int AS count
        FROM public.kol_directory kd
        JOIN public.agency_kol_accounts a ON a.kol_account_id = kd.id
        JOIN public.agencies ag ON ag.id = a.agency_id AND ag.deleted_at IS NULL
       WHERE ${ACTIVE} AND ag.name IS NOT NULL
       GROUP BY ag.name
       ORDER BY count DESC, ag.name`),
  ])

  return {
    categories: categories.rows,
    agencies: agencies.rows,
    platforms: platforms.rows,
    tiers: tiers.rows,
    rosterTotal: roster.rows[0]?.count ?? 0,
  }
}

/* ── one creator ──────────────────────────────────────────────────────────── */

/**
 * Where a creator sits inside the roster.
 *
 * The roster carries no history, so "is this creator any good" cannot be
 * answered from their own row alone — 245K followers means nothing without
 * knowing what the rest of the roster looks like. Rank against the roster is
 * the one comparative signal the data can actually support, so it is computed
 * rather than estimated: position by followers over the whole active roster,
 * position by engagement rate among the creators whose rate has been measured,
 * and position by followers inside the creator's own category.
 */
/**
 * Identity the roster table itself does not carry, but the agency tables do.
 *
 * `agency_kol_accounts.label` is the creator's display name — "Raffi Ahmad" for
 * @raffinagita1717 — filled for 7.684 of the 7.718 active rows, and different
 * from the handle for about half of them. It is the only real name anywhere in
 * this database, so the header uses it and falls back to the handle.
 */
export interface KolCreatorIdentity {
  /** Null when absent, or when it merely repeats the username. */
  displayName: string | null
  /** Every creator in this roster belongs to one agency. */
  agency: string | null
}

export interface KolCreatorRank {
  rosterTotal: number
  followersRank: number
  /** 0–100, higher is better: the share of the roster this creator is above. */
  followersPercentile: number
  /** Null when this creator has no measured engagement rate. */
  erRank: number | null
  erPercentile: number | null
  /** How many creators have a measured rate at all — the ER rank's denominator. */
  erMeasuredTotal: number
  /** The creator's first category, and their standing inside it. */
  categoryName: string | null
  categoryTotal: number
  categoryFollowersRank: number | null
  /**
   * Standing by engagement rate *inside the category* — what "top 8% in
   * category" actually means, computed rather than asserted. Null when the
   * creator has no category or no measured rate.
   */
  categoryErRank: number | null
  categoryErTotal: number
  categoryErPercentile: number | null
}

/** A sibling account of the same creator on another platform, when one exists. */
export interface KolCreatorPlatformRow {
  id: string
  platform: string | null
  username: string
  profileUrl: string | null
  followers: number | null
  erPct: number | null
  connected: boolean
}

/** A neighbour in the roster — same category where there is one, nearest in size. */
export interface KolSimilarRow {
  id: string
  username: string
  platform: string | null
  avatarUrl: string | null
  followers: number | null
  erPct: number | null
  tier: string | null
}

export interface KolCreatorPayload {
  creator: KolDirectoryRow
  identity: KolCreatorIdentity
  rank: KolCreatorRank
  /** Always includes the creator's own row, so the caller can render one list. */
  platforms: KolCreatorPlatformRow[]
  similar: KolSimilarRow[]
  /**
   * What the warehouse has actually measured for this creator (see
   * `@/lib/discover/kolMeasured`). Null when it has measured nothing, which is
   * the common case — 23 of 7,718 roster rows have posts, though 7,230 have a
   * price. The workspace samples whatever this leaves unfilled.
   */
  measured: KolMeasured | null
  /**
   * What the L2 Gold layer holds for this creator (see `@/lib/discover/kolGold`):
   * the pipeline's own profile card, its daily and monthly rollups, and the
   * inferred audience. Null when L2 has nothing for any account they own.
   *
   * Wider coverage than `measured` — 1.976 accounts carry a profile card
   * against the 23 creators with harvested posts — but each field inside is
   * independently absent, so callers check the field they need rather than the
   * object.
   */
  gold: KolGold | null
}

/**
 * Returns null rather than throwing when the id is unknown or archived, so the
 * route can answer 404 instead of 500.
 */
export async function getKolCreator(id: string): Promise<KolCreatorPayload | null> {
  const db = kolDb()

  const { rows } = await db.query<{
    id: string; username: string | null; platform: string | null
    profile_url: string | null; avatar_url: string | null; bio: string | null
    city: string | null; categories: string[] | null; followers: number | null
    er_pct: number | null; feature_er_pct: number | null
    tier: string | null; growth_pct: number | null; connected: boolean
    views_analyzed_count: number | null; avg_views: number | null
    median_views: number | null; v2f_pct: number | null; l2v_pct: number | null
    growth_class: string | null; daily_growth: number | null
    projected_30d: number | null; projected_followers_30d: number | null
    female_pct: number | null; male_pct: number | null
    gender_known_pct: number | null; gender_reliability: string | null
    paid_ratio: number | null; paid_signal_count: number | null
    share_rate: number | null
    post_frequency_daily: number | null; post_frequency_monthly: number | null
    post_frequency_count: number | null; observation_days: number | null
    post_frequency_reliability: string | null
    monitoring_er_pct: number | null; monitoring_priority: string | null
    save_rate: number | null; viral_frequency: number | null
    viral_post_count: number | null
    content_topic: string | null; content_topic_source: string | null
    format_dominant: string | null
    audience_quality_score: number | null; audience_quality_tier: string | null
    authenticity_score: number | null
    audience_interest_top: string | null; audience_interest_source: string | null
    er_stddev_pp: number | null; er_periods: number | null
    performance_stability: string | null; rising_creator: boolean | null
    verified: boolean
    status: KolDataStatus; last_refreshed_at: Date | string | null
    card_display_name: string | null
    display_name: string | null; agency: string | null
  }>(`
    WITH base AS (${BASE})
    SELECT b.*, aka.label AS display_name, ag.name AS agency
      FROM base b
      -- One row per creator in practice; DISTINCT ON guards the join anyway so a
      -- duplicate agency link could never fan the creator out into two rows.
      LEFT JOIN LATERAL (
        SELECT a.label, a.agency_id
          FROM public.agency_kol_accounts a
         WHERE a.kol_account_id = b.id
         ORDER BY a.created_at DESC NULLS LAST
         LIMIT 1
      ) aka ON TRUE
      LEFT JOIN public.agencies ag ON ag.id = aka.agency_id AND ag.deleted_at IS NULL
     WHERE b.id = $1`, [id])

  const r = rows[0]
  if (!r) return null

  /**
   * Ranks and siblings in one round trip. Every count is taken over the active
   * roster so it agrees with the "X of Y creators" line on the directory.
   *
   * `>` not `>=`: a creator is not ranked ahead of themselves, so the count of
   * creators strictly above them, plus one, is their position.
   */
  const [rank, platforms, similar, measured, gold] = await Promise.all([
    db.query<{
      roster_total: number; followers_rank: number
      er_rank: number | null; er_measured_total: number
      category_total: number; category_followers_rank: number | null
      category_er_rank: number | null; category_er_total: number
    }>(`
      -- ER population: the SAME feature value the profile shows (FEATURE_ER_PCT,
      -- picked per creator by ER_LATERAL), so a feature ER is never ranked
      -- against roster ERs.
      WITH fe AS (
        SELECT kd.id, kd.category_ids, kd.category_id,
               ${FEATURE_ER_PCT} AS er
          FROM public.kol_directory kd${ER_LATERAL}
         WHERE ${ACTIVE}
           AND fer.engagement_rate IS NOT NULL
      )
      SELECT
        (SELECT COUNT(*) FROM public.kol_directory kd WHERE ${ACTIVE})::int AS roster_total,
        (SELECT COUNT(*) + 1 FROM public.kol_directory kd
          WHERE ${ACTIVE} AND kd.followers_count > $1)::int AS followers_rank,
        CASE WHEN $2::float8 IS NULL THEN NULL ELSE
          (SELECT COUNT(*) + 1 FROM fe WHERE fe.er > $2)::int
        END AS er_rank,
        (SELECT COUNT(*) FROM fe)::int AS er_measured_total,
        -- Category standing only means something when the creator has one; the
        -- 46% of the roster with no category get nulls here, not a fake rank.
        (SELECT COUNT(*) FROM public.kol_directory kd
          JOIN public.kol_categories kc ON kc.id = ANY (${CATEGORY_IDS})
         WHERE ${ACTIVE} AND kc.name = $3)::int AS category_total,
        CASE WHEN $3::text IS NULL THEN NULL ELSE
          (SELECT COUNT(*) + 1 FROM public.kol_directory kd
            JOIN public.kol_categories kc ON kc.id = ANY (${CATEGORY_IDS})
           WHERE ${ACTIVE} AND kc.name = $3 AND kd.followers_count > $1)::int
        END AS category_followers_rank,
        -- "Top N% in category" is a claim about engagement inside the niche, so
        -- it is ranked against the category's measured rows, not the roster's.
        CASE WHEN $3::text IS NULL OR $2::float8 IS NULL THEN NULL ELSE
          (SELECT COUNT(*) + 1 FROM fe kd
            JOIN public.kol_categories kc ON kc.id = ANY (${CATEGORY_IDS})
           WHERE kc.name = $3 AND kd.er > $2)::int
        END AS category_er_rank,
        (SELECT COUNT(*) FROM fe kd
          JOIN public.kol_categories kc ON kc.id = ANY (${CATEGORY_IDS})
         WHERE kc.name = $3)::int
          AS category_er_total`,
      // The creator's own id is deliberately absent: every count here is over
      // the roster, and an unused parameter leaves Postgres unable to infer a
      // type for it ("could not determine data type of parameter $1").
      [r.followers ?? 0, r.feature_er_pct, r.categories?.[0] ?? null],
    ),
    /**
     * The same person on another platform is a separate row keyed by the same
     * normalised username — 277 creators in the roster have both. Matched on
     * that column rather than on `username` so a case or dot difference between
     * the Instagram and TikTok handle still pairs up.
     */
    db.query<{
      id: string; platform: string | null; username: string
      profile_url: string | null; followers: number | null
      er_pct: number | null; connected: boolean; verified: boolean
    }>(`
      SELECT kd.id, pl.key AS platform, kd.username, kd.profile_url,
             kd.followers_count AS followers, ${FEATURE_ER_PCT} AS er_pct,
             EXISTS (
               SELECT 1
                 FROM public.kol_social_account ksa
                 JOIN public.social_account sa ON sa.id = ksa.social_account_id
                WHERE ksa.kol_id = kd.id
                  AND sa.platform_user_id IS NOT NULL
                  AND sa.oauth_token IS NOT NULL
             ) AS connected
        FROM public.kol_directory kd
        LEFT JOIN public.platforms pl ON pl.id = kd.platform_id${ER_LATERAL}
       WHERE ${ACTIVE}
         AND kd.username_normalized = (
           SELECT username_normalized FROM public.kol_directory WHERE id = $1)
       ORDER BY kd.followers_count DESC NULLS LAST`,
      [id],
    ),
    /**
     * "Creator lain yang mirip" — genuinely comparable, not sampled: the same
     * category where the creator has one, ordered by how close their follower
     * count is. For the 46% of the roster with no category the filter drops away
     * and size alone decides, which is still a real answer to "siapa lagi yang
     * sekelas dia".
     */
    db.query<{
      id: string; username: string; platform: string | null; avatar_url: string | null
      followers: number | null; er_pct: number | null; tier: string | null
    }>(`
      SELECT kd.id, kd.username, pl.key AS platform, kd.avatar_url,
             kd.followers_count AS followers, ${FEATURE_ER_PCT} AS er_pct,
             t.name AS tier
        FROM public.kol_directory kd
        LEFT JOIN public.platforms pl ON pl.id = kd.platform_id
        LEFT JOIN public.kol_tiers t
               ON kd.followers_count >= t.min_followers
              AND (t.max_followers IS NULL OR kd.followers_count <= t.max_followers)${ER_LATERAL}
       WHERE ${ACTIVE}
         AND kd.id <> $1
         AND ($2::text IS NULL OR EXISTS (
               SELECT 1 FROM public.kol_categories kc
                WHERE kc.id = ANY (${CATEGORY_IDS}) AND kc.name = $2))
       ORDER BY ABS(COALESCE(kd.followers_count, 0) - $3) ASC
       LIMIT 4`,
      [id, r.categories?.[0] ?? null, r.followers ?? 0],
    ),

    // Posts and prices ride along in the same round trip. It is three more
    // queries against the same pool, and the workspace cannot decide what to
    // mark as an estimate until it knows which of them came back empty.
    getKolMeasured(id),
    getKolGold(id),
  ])

  const k = rank.rows[0]
  const pct = (position: number, total: number) =>
    total <= 1 ? 100 : Math.round(((total - position) / (total - 1)) * 1000) / 10

  return {
    creator: {
      id: r.id,
      username: r.username ?? '—',
      displayName: cleanDisplayName(r.card_display_name, r.username),
      platform: r.platform,
      profileUrl: r.profile_url,
      avatarUrl: r.avatar_url,
      bio: r.bio,
      city: r.city,
      categories: r.categories ?? [],
      followers: r.followers,
      // Profile ER is the feature value only (FEATURE_ER_PCT); the list keeps
      // the roster fallback.
      erPct: r.feature_er_pct,
      tier: r.tier,
      growthPct: r.growth_pct,
      // Straight through, null included. A creator the pipeline has no view
      // data for shows nothing rather than a zero — the rule erPct follows.
      viewsAnalyzedCount: r.views_analyzed_count,
      avgViews: r.avg_views,
      medianViews: r.median_views,
      v2fPct: r.v2f_pct,
      l2vPct: r.l2v_pct,
      // Straight through, null included — the same rule the four view metrics
      // above already follow. Nothing is recomputed on this side.
      growthClass: r.growth_class,
      dailyGrowth: r.daily_growth,
      projected30d: r.projected_30d,
      projectedFollowers30d: r.projected_followers_30d,
      femalePct: r.female_pct,
      malePct: r.male_pct,
      genderKnownPct: r.gender_known_pct,
      genderReliability: r.gender_reliability,
      paidRatio: r.paid_ratio,
      paidSignalCount: r.paid_signal_count,
      shareRate: r.share_rate,
      postFrequencyDaily: r.post_frequency_daily,
      postFrequencyMonthly: r.post_frequency_monthly,
      postFrequencyCount: r.post_frequency_count,
      observationDays: r.observation_days,
      postFrequencyReliability: r.post_frequency_reliability,
      monitoringErPct: r.monitoring_er_pct,
      monitoringPriority: r.monitoring_priority,
      saveRate: r.save_rate,
      viralFrequency: r.viral_frequency,
      viralPostCount: r.viral_post_count,
      contentTopic: r.content_topic,
      contentTopicSource: r.content_topic_source,
      formatDominant: r.format_dominant,
      audienceQualityScore: r.audience_quality_score,
      audienceQualityTier: r.audience_quality_tier,
      authenticityScore: r.authenticity_score,
      audienceInterestTop: r.audience_interest_top,
      audienceInterestSource: r.audience_interest_source,
      erStddevPp: r.er_stddev_pp,
      erPeriods: r.er_periods,
      performanceStability: r.performance_stability,
      risingCreator: r.rising_creator,
      connected: r.connected,
      verified: r.verified,
      status: r.status,
      lastRefreshedAt: toIso(r.last_refreshed_at),
      // Already in hand here: the agency comes from the join above and the
      // prices from `measured`, so neither needs `attachRosterExtras`.
      agency: r.agency,
      rateFrom: measured?.rates.length
        ? Math.min(...measured.rates.map(x => x.fee))
        : null,
      rateCount: measured?.rates.length ?? 0,
    },
    identity: {
      // A label that just repeats the handle is not a display name; treating it
      // as one would print "@budi budi" in the header.
      displayName: r.display_name && r.display_name.toLowerCase() !== (r.username ?? '').toLowerCase()
        ? r.display_name
        : null,
      agency: r.agency,
    },
    rank: {
      rosterTotal: k.roster_total,
      followersRank: k.followers_rank,
      followersPercentile: pct(k.followers_rank, k.roster_total),
      erRank: k.er_rank,
      erPercentile: k.er_rank === null ? null : pct(k.er_rank, k.er_measured_total),
      erMeasuredTotal: k.er_measured_total,
      categoryName: r.categories?.[0] ?? null,
      categoryTotal: k.category_total,
      categoryFollowersRank: k.category_followers_rank,
      categoryErRank: k.category_er_rank,
      categoryErTotal: k.category_er_total,
      categoryErPercentile: k.category_er_rank === null
        ? null : pct(k.category_er_rank, k.category_er_total),
    },
    platforms: platforms.rows.map(p => ({
      id: p.id,
      platform: p.platform,
      username: p.username,
      profileUrl: p.profile_url,
      followers: p.followers,
      erPct: p.er_pct,
      connected: p.connected,
      verified: p.verified,
    })),
    similar: similar.rows.map(s => ({
      id: s.id,
      username: s.username,
      platform: s.platform,
      avatarUrl: s.avatar_url,
      followers: s.followers,
      erPct: s.er_pct,
      tier: s.tier,
    })),
    measured,
    gold,
  }
}

/* ── identity, for pricing ────────────────────────────────────────────────── */

export interface RosterIdentity {
  id: string
  username: string
  /** Null when the roster row has no platform, which makes it un-orderable. */
  platform: string | null
}

/**
 * The minimum a roster creator needs to become an order line: who they are and
 * which platform, so the deliverable can be checked against it.
 *
 * Exists because `buildQuotation` must not take the client's word for either.
 * The cart posts ids; the username and platform written onto the order come from
 * here, in one query for the whole cart rather than one per line.
 *
 * A creator who has left the roster simply does not come back, and the line that
 * named them is rejected — which is the right answer for a new order. Orders
 * already placed keep the name and platform copied onto them at the time.
 */
export async function getRosterIdentities(ids: string[]): Promise<Map<string, RosterIdentity>> {
  const unique = [...new Set(ids)].filter(Boolean)
  const out = new Map<string, RosterIdentity>()
  if (!unique.length) return out

  const { rows } = await kolDb().query<{ id: string; username: string; platform: string | null }>(
    `SELECT kd.id, kd.username, pl.key AS platform
       FROM public.kol_directory kd
       LEFT JOIN public.platforms pl ON pl.id = kd.platform_id
      WHERE kd.id = ANY($1::uuid[])`,
    [unique],
  )
  for (const r of rows) {
    out.set(r.id, { id: r.id, username: r.username, platform: r.platform })
  }
  return out
}
