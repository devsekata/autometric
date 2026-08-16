import kolDb from '@/lib/kolDb'
import { toIso } from './util'

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
  q?: string | null
  platform?: string | null
  category?: string | null
  tiers?: string[]
  minFollowers?: number | null
  minErPct?: number | null
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
  recent: 'last_refreshed_at',
  name: 'username',
}
export const KOL_SORT_KEYS = Object.keys(SORT_COLUMNS)

function orderBy(key: string, dir: string): string {
  const col = SORT_COLUMNS[key] ?? SORT_COLUMNS.followers
  const direction = dir === 'asc' ? 'ASC' : 'DESC'
  // NULLS LAST in both directions: a creator with no follower count or no
  // measured engagement belongs at the bottom of either ordering, not floated
  // to the top of the ascending one.
  return col === 'username'
    ? `username ${direction}`
    : `${col} ${direction} NULLS LAST, username ASC`
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
         -- a recent refresh is Live, an older row that still carries a measured
         -- engagement rate is Calculated, and a row imported without metrics is
         -- Estimated. Nothing here is invented — it describes what the row has.
         CASE
           WHEN kd.last_refreshed_at >= now() - interval '7 days' THEN 'Live'
           WHEN kd.engagement_rate IS NOT NULL                    THEN 'Calculated'
           ELSE 'Estimated'
         END                                       AS status,
         kd.last_refreshed_at
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
    ],
  )

  return {
    rows: rows.map(r => ({
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
    })),
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
  rank: KolCreatorRank
  /** Always includes the creator's own row, so the caller can render one list. */
  platforms: KolCreatorPlatformRow[]
  similar: KolSimilarRow[]
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
  }>(`WITH base AS (${BASE}) SELECT * FROM base WHERE id = $1`, [id])

  const r = rows[0]
  if (!r) return null

  /**
   * Ranks and siblings in one round trip. Every count is taken over the active
   * roster so it agrees with the "X of Y creators" line on the directory.
   *
   * `>` not `>=`: a creator is not ranked ahead of themselves, so the count of
   * creators strictly above them, plus one, is their position.
   */
  const [rank, platforms, similar] = await Promise.all([
    db.query<{
      roster_total: number; followers_rank: number
      er_rank: number | null; er_measured_total: number
      category_total: number; category_followers_rank: number | null
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
        END AS category_followers_rank`,
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
  }
}
