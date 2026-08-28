import kolDb from '@/lib/kolDb'
import { toIso } from './util'
import { getKolMeasured, type KolMeasured } from './kolMeasured'

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
}

export interface KolDirectoryFacets {
  categories: { name: string; count: number }[]
  platforms: { key: string; count: number }[]
  /** Ordered largest tier first, with the follower band the KOL platform defines. */
  tiers: { name: string; count: number; min: number; max: number | null }[]
  /** The whole active roster, for the "X of Y creators" line. */
  rosterTotal: number
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
  verifiedOnly?: boolean
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
}
export const KOL_SORT_KEYS = Object.keys(SORT_COLUMNS)

/**
 * Scraped creators first, page by page — every list is grouped by provenance
 * before anything else. `status` is 'Live' (refreshed within 7 days),
 * 'Calculated' (an older row that still carries a measured engagement rate)
 * or 'Estimated' (never scraped — the `kol_directory` row has no measurement
 * behind it at all). Live and Calculated both mean "this creator has real
 * data", so they sort ahead of Estimated together; Live leads Calculated
 * because it is the fresher of the two.
 */
const SCRAPED_FIRST = `CASE status WHEN 'Live' THEN 0 WHEN 'Calculated' THEN 1 ELSE 2 END ASC`

function orderBy(key: string, dir: string): string {
  const col = SORT_COLUMNS[key] ?? SORT_COLUMNS.followers
  const direction = dir === 'asc' ? 'ASC' : 'DESC'
  // NULLS LAST in both directions: a creator with no follower count or no
  // measured engagement belongs at the bottom of either ordering, not floated
  // to the top of the ascending one.
  const rest = col === 'username'
    ? `username ${direction}`
    : `${col} ${direction} NULLS LAST, username ASC`
  return `${SCRAPED_FIRST}, ${rest}`
}

const MAX_PAGE_SIZE = 60

/** `%` and `_` typed into the search box are literals, not LIKE wildcards. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, c => `\\${c}`)

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

const BASE = `
  SELECT kd.id,
         kd.username,
         pl.key                                    AS platform,
         kd.profile_url,
         kd.avatar_url,
         kd.bio,
         kd.creator_city                           AS city,
         cats.names                                AS categories,
         kd.followers_count                        AS followers,
         kd.engagement_rate::float                 AS er_pct,
         t.name                                    AS tier,
         (LOWER(COALESCE(kd.verified_status, '')) IN ('verified', 'true', 'yes')) AS verified,
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
         kd.last_refreshed_at,
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
      SELECT ARRAY_AGG(kc.name ORDER BY kc.name) AS names
        FROM public.kol_categories kc
       WHERE kc.id = ANY (${CATEGORY_IDS})
    ) cats ON TRUE
   WHERE ${ACTIVE}`

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
 */
async function attachRosterExtras(rows: KolDirectoryRow[]): Promise<void> {
  const ids = rows.map(r => r.id)
  if (!ids.length) return

  const db = kolDb()
  const [agencies, rates] = await Promise.all([
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
  ])

  const byAgency = new Map(agencies.rows.map(r => [r.kol_account_id, r.name]))
  const byRate = new Map(rates.rows.map(r => [r.kol_id, r]))

  for (const row of rows) {
    row.agency = byAgency.get(row.id) ?? null
    const rate = byRate.get(row.id)
    row.rateFrom = rate?.min_fee ? Number(rate.min_fee) : null
    row.rateCount = rate?.n ?? 0
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
    categories: string[] | null; followers: number | null; er_pct: number | null
    tier: string | null; verified: boolean; status: KolDataStatus
    last_refreshed_at: Date | string | null; total_count: number
  }>(
    `
    WITH base AS (${BASE}),
    filtered AS (
      SELECT * FROM base b
       WHERE ($1::text     IS NULL OR b.username ILIKE '%' || $1 || '%')
         AND ($2::text     IS NULL OR b.platform = $2)
         AND ($3::text     IS NULL OR $3 = ANY (b.categories))
         AND ($4::text[]   IS NULL OR b.tier = ANY ($4))
         AND ($5::float8   IS NULL OR b.er_pct >= $5)
         AND ($6::boolean  IS NOT TRUE OR b.verified)
         AND ($9::bigint   IS NULL OR b.followers >= $9)
         AND ($10::uuid[]  IS NULL OR b.id = ANY ($10))
         -- Rate card ceiling. EXISTS rather than a join so a creator with three
         -- priced deliverables stays one row; measured at 19ms over the roster.
         AND ($11::bigint IS NULL OR EXISTS (
               SELECT 1
                 FROM public.kol_social_account ksa
                 JOIN l1_silver.unified_rate_card u
                   ON u.social_account_id = ksa.social_account_id
                WHERE ksa.kol_id = b.id AND u.fee IS NOT NULL AND u.fee <= $11))
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
      query.verifiedOnly === true,
      pageSize,
      (page - 1) * pageSize,
      query.minFollowers ? Math.trunc(query.minFollowers) : null,
      query.ids?.length ? query.ids : null,
      query.maxRate != null && Number.isFinite(query.maxRate)
        ? Math.trunc(query.maxRate)
        : null,
    ],
  )

  const mapped: KolDirectoryRow[] = rows.map(r => ({
      id: r.id,
      username: r.username ?? '—',
      platform: r.platform,
      profileUrl: r.profile_url,
      avatarUrl: r.avatar_url,
      bio: r.bio,
      city: r.city,
      categories: r.categories ?? [],
      followers: r.followers,
      erPct: r.er_pct,
      tier: r.tier,
      verified: r.verified,
      status: r.status,
      lastRefreshedAt: toIso(r.last_refreshed_at),
      // Filled by attachRosterExtras below; declared here so the row is never
      // half-built between the two statements.
      agency: null,
      rateFrom: null,
      rateCount: 0,
  }))

  await attachRosterExtras(mapped)

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
export async function listKolFacets(): Promise<KolDirectoryFacets> {
  const [categories, platforms, tiers, roster] = await Promise.all([
    kolDb().query<{ name: string; count: number }>(`
      SELECT kc.name, COUNT(*)::int AS count
        FROM public.kol_directory kd
        JOIN public.kol_categories kc ON kc.id = ANY (${CATEGORY_IDS})
       WHERE ${ACTIVE}
       GROUP BY kc.name
       ORDER BY count DESC, kc.name`),
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
  ])

  return {
    categories: categories.rows,
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
  verified: boolean
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
    er_pct: number | null; tier: string | null; verified: boolean
    status: KolDataStatus; last_refreshed_at: Date | string | null
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
  const [rank, platforms, similar, measured] = await Promise.all([
    db.query<{
      roster_total: number; followers_rank: number
      er_rank: number | null; er_measured_total: number
      category_total: number; category_followers_rank: number | null
      category_er_rank: number | null; category_er_total: number
    }>(`
      SELECT
        (SELECT COUNT(*) FROM public.kol_directory kd WHERE ${ACTIVE})::int AS roster_total,
        (SELECT COUNT(*) + 1 FROM public.kol_directory kd
          WHERE ${ACTIVE} AND kd.followers_count > $1)::int AS followers_rank,
        CASE WHEN $2::float8 IS NULL THEN NULL ELSE
          (SELECT COUNT(*) + 1 FROM public.kol_directory kd
            WHERE ${ACTIVE} AND kd.engagement_rate > $2)::int
        END AS er_rank,
        (SELECT COUNT(*) FROM public.kol_directory kd
          WHERE ${ACTIVE} AND kd.engagement_rate IS NOT NULL)::int AS er_measured_total,
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
          (SELECT COUNT(*) + 1 FROM public.kol_directory kd
            JOIN public.kol_categories kc ON kc.id = ANY (${CATEGORY_IDS})
           WHERE ${ACTIVE} AND kc.name = $3 AND kd.engagement_rate > $2)::int
        END AS category_er_rank,
        (SELECT COUNT(*) FROM public.kol_directory kd
          JOIN public.kol_categories kc ON kc.id = ANY (${CATEGORY_IDS})
         WHERE ${ACTIVE} AND kc.name = $3 AND kd.engagement_rate IS NOT NULL)::int
          AS category_er_total`,
      // The creator's own id is deliberately absent: every count here is over
      // the roster, and an unused parameter leaves Postgres unable to infer a
      // type for it ("could not determine data type of parameter $1").
      [r.followers ?? 0, r.er_pct, r.categories?.[0] ?? null],
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
      er_pct: number | null; verified: boolean
    }>(`
      SELECT kd.id, pl.key AS platform, kd.username, kd.profile_url,
             kd.followers_count AS followers, kd.engagement_rate::float AS er_pct,
             (LOWER(COALESCE(kd.verified_status, '')) IN ('verified', 'true', 'yes')) AS verified
        FROM public.kol_directory kd
        LEFT JOIN public.platforms pl ON pl.id = kd.platform_id
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
             kd.followers_count AS followers, kd.engagement_rate::float AS er_pct,
             t.name AS tier
        FROM public.kol_directory kd
        LEFT JOIN public.platforms pl ON pl.id = kd.platform_id
        LEFT JOIN public.kol_tiers t
               ON kd.followers_count >= t.min_followers
              AND (t.max_followers IS NULL OR kd.followers_count <= t.max_followers)
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
  ])

  const k = rank.rows[0]
  const pct = (position: number, total: number) =>
    total <= 1 ? 100 : Math.round(((total - position) / (total - 1)) * 1000) / 10

  return {
    creator: {
      id: r.id,
      username: r.username ?? '—',
      platform: r.platform,
      profileUrl: r.profile_url,
      avatarUrl: r.avatar_url,
      bio: r.bio,
      city: r.city,
      categories: r.categories ?? [],
      followers: r.followers,
      erPct: r.er_pct,
      tier: r.tier,
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
