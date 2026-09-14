import type { QueryResult, QueryResultRow } from 'pg'
import kolDb from '@/lib/kolDb'
import { toIso } from './util'
import { getKolMeasured, type KolMeasured } from './kolMeasured'
import { getKolGold, type KolGold } from './kolGold'

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

/**
 * How much to trust a creator's engagement rate (BE-05).
 *
 * `measured` is a rate inside the plausible band, `suspect` one that is
 * arithmetically possible but implausibly high, and `null` means the roster has
 * no usable rate at all — never measured, stored as zero, or stored as a value
 * that cannot be an engagement rate.
 */
export type KolErQuality = 'measured' | 'suspect' | null

/**
 * Above this many percent an engagement rate is flagged `suspect` but still
 * returned and still filterable. 20% is a placeholder pending a Product
 * decision, which is why it is configuration rather than a literal in the SQL —
 * see NEED VERIFICATION in the BE-05 notes. Overridable without a deploy.
 */
export const ER_SUSPECT_MIN = (() => {
  const v = Number(process.env.KOL_ER_SUSPECT_MIN)
  return Number.isFinite(v) && v > 0 ? v : 20
})()

/**
 * The roster's engagement rate, with impossible values removed (BE-05).
 *
 * `kol_directory.engagement_rate` is stored in percentage points and is not
 * validated on write. Measured 2026-09-06 over the 7.720 active rows: 1.756
 * carry a value, 7 of them exceed 100% (up to 223,41% — more engagement than the
 * creator has followers, which cannot happen) and 6 are exactly 0.
 *
 * Both are excluded here for the same reason the rest of this module never
 * coalesces a null to zero: an unmeasurable figure must not read as a measured
 * one. A stored 0 is "nobody wrote a rate", not "this creator gets no
 * engagement" — nothing in the pipeline writes a true zero.
 *
 * This is a read-side expression only. Nothing in this module writes to
 * `kol_directory`, and the raw column is still returned as `erRaw` so the bad
 * values stay auditable instead of disappearing.
 *
 * Every read of the column goes through here — list, filter, sort, per-creator
 * card, sibling platforms, similar creators and the roster ranks — so a creator
 * can never be ranked against a population that includes values the same screen
 * refuses to display. Assumes the table is aliased `kd`, as it is everywhere in
 * this file.
 */
const ER_CLEAN = `CASE
           WHEN kd.engagement_rate > 0 AND kd.engagement_rate <= 100
           THEN kd.engagement_rate
         END`

/** Classifies a cleaned rate for the UI. Threshold lives in `ER_SUSPECT_MIN`. */
const erQualityOf = (erPct: number | null): KolErQuality =>
  erPct === null ? null : erPct > ER_SUSPECT_MIN ? 'suspect' : 'measured'

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
  /**
   * Percentage points, e.g. 0.98 means 0.98%. Null when never measured — which
   * now also covers the values the roster stores but cannot mean (see
   * `ER_CLEAN`). This is the field every filter and sort reads.
   */
  erPct: number | null
  /**
   * The column exactly as stored, including the 7 impossible values `erPct`
   * drops. Present so a bad figure can be traced back rather than silently
   * vanishing; no screen should filter or rank on it.
   */
  erRaw: number | null
  /** How much to trust `erPct`. Null whenever `erPct` is null. */
  erQuality: KolErQuality
  tier: string | null
  /**
   * Percentage change in followers since this account's PREVIOUS snapshot, from
   * `l2_gold.kol_profile_card.followers_growth`. The gap is whatever the scraper
   * produced — 10-13 days today, not a month — so never label it monthly or
   * 30-day. Null for creators scraped only once, which is most of the roster.
   */
  growthPct: number | null
  /**
   * Business Connected: `platform_user_id` and `oauth_token` both set. Replaces
   * the old `verified`, which carried the platform's blue tick. See `CONNECTED`.
   */
  connected: boolean
  status: KolDataStatus
  lastRefreshedAt: string | null
  /**
   * The three columns the source platform's directory carries that this one used
   * to leave out. They were left out because the roster row has no column for
   * them — which was true of EMV, authenticity, growth and brand fit, and is
   * still true. It was never true of the agency name: the agency tables name
   * 7.684 of the 7.720 creators.
   *
   * The rate card has now answered twice with different numbers, so date the
   * figure you read here. Measured 13 Sep 2026, after the roster sync ran:
   * `l1_silver.unified_rate_card` holds 8.856 priced deliverables and the join
   * below fills `rateFrom` for 6.959 of the 7.432 roster creators. It genuinely
   * did hold 0 rows on 8 Sep, which is why the rate filter shipped disabled;
   * that control is live again.
   *
   * `l2_gold.kol_profile_card.rate_card_min_fee` is still null for all 1.978
   * rows and is NOT consulted here. That is deliberate — one source per figure,
   * and the source is L1. See the note in `kolGold.ts`.
   *
   * Both are attached after paging rather than joined in (`attachRosterExtras`),
   * because a LATERAL join for either runs before `LIMIT` and costs seconds.
   */
  agency: string | null
  /**
   * The creator's real name, from `agency_kol_accounts.label` — filled for 7.684
   * of the 7.720 active rows and different from the handle for 3.463 of them.
   * Null when absent or when it merely repeats the username, the same rule
   * `getKolCreator` already applies. Attached by `attachRosterExtras`, which was
   * already reading this table for the agency name.
   */
  displayName: string | null
  /** Cheapest priced deliverable, in IDR. Null when the creator has no rate card. */
  rateFrom: number | null
  /** How many distinct deliverables carry a price. */
  rateCount: number
}

export interface KolDirectoryFacets {
  categories: { name: string; count: number }[]
  /**
   * Active creators carrying no category at all — 3.546 of 7.720. Counted so the
   * 46% of the roster that every category chip hides is visible as a number
   * rather than only as a gap between the chip counts and the roster total.
   */
  uncategorized: number
  platforms: { key: string; count: number }[]
  /**
   * Ordered largest tier first, with the follower band the KOL platform defines.
   * Scoped to the selected platform when one is passed (BE-02); roster-wide
   * otherwise.
   */
  tiers: { name: string; count: number; min: number; max: number | null }[]
  /**
   * Active creators that fall into no band — 526 roster-wide, made of 222 with
   * no `followers_count` and 304 below the smallest band's floor of 1.000.
   * Scoped alongside `tiers`.
   */
  untiered: number
  /** The whole active roster, for the "X of Y creators" line. */
  rosterTotal: number
}

/**
 * Brand Match for the creators on one page, when `?match=1` asked for it.
 *
 * Attached by the route rather than produced here, because matching needs the
 * workspace's Brand Profile out of the warehouse and this module only ever
 * talks to the KOL pool. Keeping the fetch and the scoring in separate modules
 * is what stops a directory query from quietly acquiring a second database.
 */
export interface KolDirectoryMatch {
  /**
   * False when the workspace has not saved a scoreable Brand Profile. `rows` is
   * then empty — not full of zeros. A creator nobody has stated a preference
   * about has no match score, and printing one would be the fake precision the
   * engine exists to remove.
   */
  scoreable: boolean
  brandName: string | null
  brandCategory: string | null
  updatedAt: string | null
  eligibility: import('./brandMatch/profile').EligibilityRules
  /** Creator id → the score and the reason for it. Absent id means unscored. */
  rows: Record<string, import('./brandMatch/explain').MatchExplanation>
  /**
   * Creator id → the MEASURED signals for that creator: authenticity, audience
   * quality, growth, average views, posting cadence.
   *
   * Present even when `scoreable` is false, because none of it depends on a
   * brand. It is what the cards and the quick-look panel read instead of the
   * figures `@/lib/discover/kolSample` used to generate for the same slots —
   * every field nullable, and null meaning not measured rather than zero.
   */
  measured: Record<string, import('./brandMatch/measured').MeasuredSignals>
}

/**
 * What Matters Most for the creators on this page, when `?matters=` asked.
 *
 * Every number here is computed server-side by `@/lib/discover/whatMatters`
 * against the KOL server. The client renders these; it must not re-derive them,
 * or the page and the engine would disagree about the same creator.
 */
export interface KolDirectoryWhatMatters {
  /** The criteria the caller selected, after unknown keys were dropped. */
  selected: import('./whatMatters/model').CriterionKey[]
  /** The canonical seven, so the UI keeps no second copy of the names. */
  criteria: { key: import('./whatMatters/model').CriterionKey; label: string }[]
  /**
   * Creator id → per-criterion scores plus the average over the selected ones.
   *
   * A criterion the database cannot answer is `null` — not measured, and NOT a
   * zero. It is dropped from the average's denominator rather than counted, and
   * the UI must draw it as unmeasured.
   */
  rows: Record<string, import('./whatMatters').WhatMattersResult>
}

export interface KolDirectoryPayload {
  rows: KolDirectoryRow[]
  total: number
  page: number
  pageSize: number
  facets?: KolDirectoryFacets
  match?: KolDirectoryMatch
  whatMatters?: KolDirectoryWhatMatters
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
  /**
   * Category names, matched by overlap rather than equality (BE-01): 1.183
   * creators carry more than one category (up to 5), so a creator tagged
   * Beauty *and* Lifestyle must answer to both chips. Several names union
   * together — asking for Beauty and Lifestyle means either, not both.
   *
   * The sentinel `UNCATEGORIZED` asks for the creators that carry none, and
   * combines with real names as another member of the union.
   */
  categories?: string[] | null
  /**
   * Tier names from `kol_tiers`, unioned. The sentinel `UNTIERED` asks for the
   * creators that fall into no band, mirroring `UNCATEGORIZED`.
   */
  tiers?: string[]
  minFollowers?: number | null
  /**
   * Upper bound on followers — the reference panel's `follMax`, which this
   * directory only ever had the lower half of.
   *
   * It is what makes "creators smaller than X" a question the database answers
   * rather than something the reader eyeballs: 2.247 of the roster sit under
   * 10K and 2.942 between 10K and 50K, so the ceiling separates real
   * populations. A creator whose follower count was never measured is excluded
   * when a ceiling is set, for the same reason a rate ceiling excludes the
   * unpriced: "below X" is not satisfied by "unknown".
   */
  maxFollowers?: number | null
  minErPct?: number | null
  /**
   * Ceiling on the creator's cheapest priced deliverable, in IDR — the source
   * platform's "Max. rate card" slider. Creators with no rate card at all are
   * excluded when this is set: the filter asks for a price under a number, and
   * "no price" is not one.
   */
  maxRate?: number | null
  /**
   * Inclusive bounds on `growthPct`, in percentage points.
   *
   * Null means no bound. 0 does not: a creator can sit exactly at 0.0000% and
   * several of the measured ones do, so these are nullable rather than using
   * the 0-means-any convention the follower and rate bounds use.
   */
  minGrowth?: number | null
  maxGrowth?: number | null
  connectedOnly?: boolean
  /**
   * Lower bounds on the two roster timestamps, for the Section Tabs (BE-04).
   * `createdAfter` is when the row appeared, `refreshedAfter` when its numbers
   * were last measured — different columns answering different questions, which
   * is why "Recently added" and "Recently updated" are not the same tab.
   */
  createdAfter?: Date | null
  refreshedAfter?: Date | null
  sort?: string | null
  dir?: string | null
  page?: number
  pageSize?: number
}

/** Asks for the creators carrying no category at all. See `categories`. */
export const UNCATEGORIZED = '__uncategorized'
/** Asks for the creators falling into no `kol_tiers` band. See `tiers`. */
export const UNTIERED = '__untiered'

/**
 * Sort keys are whitelisted and the direction is reduced to one of two literals:
 * both end up interpolated into the statement, never parameterised.
 */
const SORT_COLUMNS: Record<string, string> = {
  followers: 'followers',
  engagement: 'er_pct',
  // When the creator's numbers were last measured — not when the row appeared.
  recent: 'last_refreshed_at',
  // Alias of `recent`, not a second implementation: both resolve to the same
  // column. `recent` is the name the UI already sends and stays canonical;
  // `updated` exists because "Recently updated" is what the Section Tabs call
  // it, and a tab whose own name is rejected by the sort whitelist is a trap.
  updated: 'last_refreshed_at',
  // When the row appeared in the database. The Discovery landing's "Recently
  // added" shelf is this ordering: `recent` answers "who moved", which is a
  // different question and a different column.
  created: 'created_at',
  name: 'username',
  // Percentage change in followers since the account's previous snapshot. Rows
  // with no second snapshot sort last on either direction — NULLS LAST is
  // applied by the order builder, so "worst growth" never means "unmeasured".
  growth: 'growth_pct',
  /**
   * Brand Match score — and the only key here that is NOT a column.
   *
   * A match score is a function of (creator, brand profile) computed in Node
   * after the page is read; there is nothing in `kol_directory` to ORDER BY.
   * So this resolves to the follower ordering, which becomes the STABLE BASE
   * the page is selected and tie-broken by, and the route re-ranks that page
   * by score afterwards — see `MATCH_SORT` below.
   *
   * Mapped explicitly rather than left to `orderBy`'s unknown-key fallback:
   * the fallback lands on the same column, but silently, and a reader would
   * have no way to tell an intentional alias from a typo that stopped working.
   */
  match: 'followers',
}

/**
 * The sort key whose ordering is applied AFTER the query, over the page only.
 *
 * Page-scoped by construction, not by omission: scoring the whole roster would
 * mean computing ~7.4k scores per request per brand profile, and with category
 * absent for 3.430 creators most of them would tie at the same neutral value
 * anyway. The UI says "halaman ini" for exactly this reason.
 */
export const MATCH_SORT = 'match'

/**
 * Re-ranks ONE PAGE by Brand Match score. Pure, so it can be verified without a
 * database or a running route.
 *
 * Three properties it has to keep, and the reason each one is not negotiable:
 *
 *   unscored last   A creator with no score is not a creator who scored 0.
 *                   `null` sorts to the bottom in BOTH directions, so "lowest
 *                   match first" never means "unmeasured first" — the same rule
 *                   the SQL ordering applies with NULLS LAST.
 *   no fabrication  Nothing substitutes a number for a missing score. The
 *                   comparator reads `null` and orders around it; it never
 *                   coerces to 0, to 50, or to -1.
 *   deterministic   `Array.prototype.sort` has been required to be stable since
 *                   ES2019, so equal scores keep the incoming order — which is
 *                   the SQL ordering (followers DESC, then username ASC).
 *                   Thousands of creators tie at the neutral 50 on this roster,
 *                   so this is the common case, not the edge case.
 *
 * Returns a new array; the input is not mutated.
 */
export function rankByMatch<T>(
  rows: readonly T[],
  scoreOf: (row: T) => number | null,
  dir: string | null | undefined,
): T[] {
  const asc = dir === 'asc'
  return [...rows].sort((a, b) => {
    const x = scoreOf(a)
    const y = scoreOf(b)
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    return asc ? x - y : y - x
  })
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

/**
 * `searching` adds the relevance key produced by `RELEVANCE` below.
 *
 * It sits *after* `SCRAPED_FIRST` rather than in front of it, so the existing
 * invariant — provenance groups the list before anything else — is not changed
 * by this work. In practice relevance still decides the visible order: no row
 * is currently 'Live' and only 27 are 'Calculated', so 99,6% of the roster
 * shares one provenance group and is ordered by relevance inside it.
 */
function orderBy(key: string, dir: string, searching: boolean): string {
  const col = SORT_COLUMNS[key] ?? SORT_COLUMNS.followers
  const direction = dir === 'asc' ? 'ASC' : 'DESC'
  // NULLS LAST in both directions: a creator with no follower count or no
  // measured engagement belongs at the bottom of either ordering, not floated
  // to the top of the ascending one.
  const rest = col === 'username'
    ? `username ${direction}`
    : `${col} ${direction} NULLS LAST, username ASC`
  return `${SCRAPED_FIRST}${searching ? ', rel ASC' : ''}, ${rest}`
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

/**
 * Business Connected — the creator has actually linked the account through
 * OAuth, meaning `social_account.platform_user_id` AND `oauth_token` are both
 * present.
 *
 * This is deliberately NOT `kol_directory.verified_status`, which it replaces.
 * That column is the platform's blue tick and says nothing about whether the
 * creator has connected anything to us; `social_account.connected` looks like
 * the right column and is never filled. Defined here once because three queries
 * need the same answer and three copies of it would drift.
 *
 * It returns false for the whole roster today — no creator has been through the
 * connect flow yet. That is why the filter that reads it ships with the reason
 * written on it rather than as a control that silently returns nothing.
 */
const CONNECTED = `EXISTS (
           SELECT 1
             FROM public.kol_social_account ksa
             JOIN public.social_account sa ON sa.id = ksa.social_account_id
            WHERE ksa.kol_id = kd.id
              AND sa.platform_user_id IS NOT NULL
              AND sa.oauth_token IS NOT NULL
         )`

/**
 * What `?q=` matches (BE-03).
 *
 * Four things a person might type, not one. Before this, only `username` was
 * searched, so the 3.463 creators whose real name differs from their handle —
 * "Raffi Ahmad" for @raffinagita1717, "Cristiano Ronaldo" for @cristiano — could
 * not be found by the name anyone would actually type.
 *
 * Two rules shape the SQL:
 *
 *   * **Semi-joins, never joins.** `agency_kol_accounts` is 1:N against the
 *     roster, so joining it in would fan a creator into several rows and corrupt
 *     both `COUNT(*) OVER()` and the page window. `EXISTS` asks the same
 *     question and cannot duplicate a row.
 *   * **Nothing runs when `q` is absent.** The parameter guard is the first
 *     operand of the `OR`, so for the ordinary unfiltered list Postgres
 *     short-circuits before reaching either subquery. That matters here more
 *     than usual: `attachRosterExtras` exists precisely because a LATERAL
 *     against this table before `LIMIT` was measured at 4,2s over the roster.
 *
 * Categories are read from `b.categories`, the array the existing LATERAL in
 * `BASE` already built — no second join for them.
 */
const SEARCH_MATCH = `(
        b.username            ILIKE '%' || $1 || '%'
     OR b.username_normalized ILIKE '%' || $1 || '%'
     OR b.bio                 ILIKE '%' || $1 || '%'
     OR EXISTS (SELECT 1 FROM unnest(COALESCE(b.categories, '{}'::text[])) cn
                 WHERE cn ILIKE '%' || $1 || '%')
     OR EXISTS (SELECT 1 FROM public.agency_kol_accounts a
                 WHERE a.kol_account_id = b.id
                   AND a.label ILIKE '%' || $1 || '%')
      )`

/**
 * Which of the four fields matched, lowest first — the order the caller expects
 * results in. Evaluated only over rows that already survived `SEARCH_MATCH`, so
 * the two `EXISTS` here run against a handful of rows rather than the roster.
 *
 * `ILIKE $1` with no wildcards is an exact, case-insensitive match that still
 * honours the escaping in `escapeLike`, which a plain `=` would not.
 */
const RELEVANCE = `CASE
        WHEN $1::text IS NULL                                        THEN 0
        WHEN b.username ILIKE $1 OR b.username_normalized ILIKE $1   THEN 0
        WHEN b.username ILIKE $1 || '%'                              THEN 1
        WHEN EXISTS (SELECT 1 FROM public.agency_kol_accounts a
                      WHERE a.kol_account_id = b.id
                        AND a.label ILIKE '%' || $1 || '%')          THEN 2
        WHEN EXISTS (SELECT 1 FROM unnest(COALESCE(b.categories, '{}'::text[])) cn
                      WHERE cn ILIKE '%' || $1 || '%')               THEN 3
        ELSE 4
      END`

/** True for a creator carrying no category at all — the `UNCATEGORIZED` bucket. */
const NO_CATEGORY = `(b.categories IS NULL OR cardinality(b.categories) = 0)`

const BASE = `
  SELECT kd.id,
         kd.username,
         -- Case- and punctuation-folded handle, maintained by the KOL platform
         -- and already used here to pair a creator's Instagram and TikTok rows.
         -- Searched alongside username so "raffi.nagita" finds
         -- @raffinagita1717 without the caller having to guess the punctuation.
         kd.username_normalized,
         pl.key                                    AS platform,
         kd.profile_url,
         kd.avatar_url,
         kd.bio,
         kd.creator_city                           AS city,
         cats.names                                AS categories,
         kd.followers_count                        AS followers,
         -- BE-05: the filterable rate is the cleaned one, so minEr and
         -- sort=engagement below inherit the rule without naming it again.
         ${ER_CLEAN}::float                        AS er_pct,
         kd.engagement_rate::float                 AS er_raw,
         t.name                                    AS tier,
         ${CONNECTED}                              AS connected,
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
      -- Cast to text[]: kol_categories.name is character varying, so the
      -- aggregate comes back as varchar[] and "varchar[] && text[]" has no
      -- operator. The old equality predicate coerced silently; the overlap
      -- operator BE-01 needs does not, so the type is pinned here once rather
      -- than cast at each of the four places that read this array.
      SELECT ARRAY_AGG(kc.name ORDER BY kc.name)::text[] AS names
        FROM public.kol_categories kc
       WHERE kc.id = ANY (${CATEGORY_IDS})
    ) cats ON TRUE
    -- Follower growth, the only measured growth that exists: L1 computes
    -- (current - previous) / previous * 100 over consecutive profile snapshots
    -- and l2_gold.kol_profile_card carries it through untouched.
    --
    -- LATERAL ... LIMIT 1 rather than a plain join so the roster row stays one
    -- row even if a creator ever maps to more than one linked account, ordered
    -- by followers to pick the same account the detail page shows. Only
    -- followers_growth is read here: followers and tier stay on kol_directory,
    -- which is the agreed source of truth for both.
    LEFT JOIN LATERAL (
      SELECT c.followers_growth
        FROM public.kol_social_account ksa
        JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
       WHERE ksa.kol_id = kd.id
       ORDER BY c.followers_count DESC NULLS LAST
       LIMIT 1
    ) g ON TRUE
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
    // `a.label` rides along on the agency lookup rather than costing a query of
    // its own: same table, same rows, same DISTINCT ON. It is the creator's real
    // name, and BE-03 made it searchable — a result set that can be found by
    // name has to be able to show that name.
    db.query<{ kol_account_id: string; name: string | null; label: string | null }>(
      `SELECT DISTINCT ON (a.kol_account_id) a.kol_account_id, ag.name, a.label
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

  const byAgency = new Map(agencies.rows.map(r => [r.kol_account_id, r]))
  const byRate = new Map(rates.rows.map(r => [r.kol_id, r]))

  for (const row of rows) {
    const agency = byAgency.get(row.id)
    row.agency = agency?.name ?? null
    // Same rule `getKolCreator` uses: a label that only repeats the handle is
    // not a display name, and printing it would render "@budi budi".
    const label = agency?.label?.trim()
    row.displayName = label && label.toLowerCase() !== row.username.toLowerCase()
      ? label
      : null
    const rate = byRate.get(row.id)
    row.rateFrom = rate?.min_fee ? Number(rate.min_fee) : null
    row.rateCount = rate?.n ?? 0
  }
}

/**
 * Runs the list statement, with JIT compilation switched off for the search
 * variant of it.
 *
 * Measured on the roster, 2026-09-06, for `?q=`:
 *
 *   jit on (default)   742ms   — of which 622ms is JIT: 366ms optimising,
 *                                217ms emitting, 35ms inlining
 *   jit off            101ms
 *
 * Nothing is scanned faster with JIT off. The statement genuinely executes in
 * ~100ms either way; the other 600ms is Postgres compiling it. It compiles
 * because the OR in `SEARCH_MATCH` makes the planner unable to estimate the
 * subplan's selectivity, so the cost estimate comes out near 2.000.000 — twenty
 * times `jit_above_cost` — and a plan that expensive is assumed to be worth
 * compiling. Here it never is: the query returns twelve rows.
 *
 * `SET LOCAL` inside a transaction, rather than a server setting: it lasts for
 * this statement only, cannot leak onto the next borrower of a pooled
 * connection, and needs nobody's permission. The unfiltered list never enters
 * this path, so the ordinary page is byte-for-byte the query it always was.
 *
 * Delete this once the trigram indexes land — with a sane selectivity estimate
 * the planner stops reaching for JIT on its own, and the wrapper stops earning
 * its complexity.
 */
async function runList<T extends QueryResultRow>(
  sql: string, params: unknown[], searching: boolean,
): Promise<QueryResult<T>> {
  const db = kolDb()
  if (!searching) return db.query<T>(sql, params)

  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL jit = off')
    const res = await client.query<T>(sql, params)
    await client.query('COMMIT')
    return res
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function listKolDirectory(query: KolDirectoryQuery): Promise<KolDirectoryPayload> {
  const pageSize = Math.min(Math.max(Math.trunc(query.pageSize ?? 20), 1), MAX_PAGE_SIZE)
  const page = Math.max(Math.trunc(query.page ?? 1), 1)
  const q = query.q?.trim() ? escapeLike(query.q.trim()) : null
  const order = orderBy(query.sort ?? 'followers', query.dir ?? 'desc', q !== null)

  // The two sentinels are pulled out of their lists and become their own
  // predicate, so "Beauty or uncategorised" is one union rather than two calls.
  const wantUncategorized = (query.categories ?? []).includes(UNCATEGORIZED)
  const catNames = (query.categories ?? []).filter(c => c && c !== UNCATEGORIZED)
  const categories = catNames.length ? catNames : null

  const wantUntiered = (query.tiers ?? []).includes(UNTIERED)
  const tierNames = (query.tiers ?? []).filter(t => t && t !== UNTIERED)
  const tiers = tierNames.length ? tierNames : null

  const { rows } = await runList<{
    id: string; username: string | null; platform: string | null
    profile_url: string | null; avatar_url: string | null; bio: string | null; city: string | null
    categories: string[] | null; followers: number | null
    er_pct: number | null; er_raw: number | null
    tier: string | null; growth_pct: number | null; connected: boolean
    status: KolDataStatus
    last_refreshed_at: Date | string | null; total_count: number
  }>(
    `
    WITH base AS (${BASE}),
    filtered AS (
      SELECT b.*, ${RELEVANCE} AS rel FROM base b
       WHERE ($1::text     IS NULL OR ${SEARCH_MATCH})
         AND ($2::text     IS NULL OR b.platform = $2)
         -- Category: overlap, plus the uncategorised bucket as another member
         -- of the same union. Equality would hide the 1.183 creators who carry
         -- more than one category from every chip but their first.
         AND (
              ($3::text[] IS NULL AND $12::boolean IS NOT TRUE)
           OR ($3::text[] IS NOT NULL AND b.categories && $3::text[])
           OR ($12::boolean IS TRUE AND ${NO_CATEGORY})
         )
         AND (
              ($4::text[] IS NULL AND $13::boolean IS NOT TRUE)
           OR ($4::text[] IS NOT NULL AND b.tier = ANY ($4))
           OR ($13::boolean IS TRUE AND b.tier IS NULL)
         )
         AND ($5::float8   IS NULL OR b.er_pct >= $5)
         AND ($6::boolean  IS NOT TRUE OR b.connected)
         AND ($9::bigint   IS NULL OR b.followers >= $9)
         AND ($16::bigint  IS NULL OR b.followers <= $16)
         -- Growth band. Both bounds inclusive, and a creator with no second
         -- snapshot fails either one: growth_pct IS NULL compares to nothing,
         -- so setting a band hides the ~99% of the roster it cannot answer for
         -- rather than guessing they sat still.
         AND ($17::float8  IS NULL OR b.growth_pct >= $17)
         AND ($18::float8  IS NULL OR b.growth_pct <= $18)
         AND ($10::uuid[]  IS NULL OR b.id = ANY ($10))
         -- Section Tabs (BE-04). Two different columns on purpose: when the row
         -- appeared, versus when its numbers were last measured.
         AND ($14::timestamptz IS NULL OR b.created_at >= $14)
         AND ($15::timestamptz IS NULL OR b.last_refreshed_at >= $15)
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
      categories,
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
      wantUncategorized,
      wantUntiered,
      query.createdAfter ?? null,
      query.refreshedAfter ?? null,
      query.maxFollowers ? Math.trunc(query.maxFollowers) : null,
      // Not truncated, and not passed through a truthiness check: growth is a
      // signed percentage where 0 is a real value, so `?? null` is the only
      // guard that keeps "no bound" and "exactly flat" apart.
      query.minGrowth ?? null,
      query.maxGrowth ?? null,
    ],
    q !== null,
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
      erRaw: r.er_raw,
      erQuality: erQualityOf(r.er_pct),
      tier: r.tier,
      growthPct: r.growth_pct,
      connected: r.connected,
      status: r.status,
      lastRefreshedAt: toIso(r.last_refreshed_at),
      // Filled by attachRosterExtras below; declared here so the row is never
      // half-built between the two statements.
      agency: null,
      displayName: null,
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
export async function listKolFacets(
  opts: { platform?: string | null } = {},
): Promise<KolDirectoryFacets> {
  /**
   * Tier counts narrow to the selected platform (BE-02); category and platform
   * counts deliberately do not.
   *
   * The asymmetry is the point. Tier was showing "Micro 2.942" while Instagram
   * was selected and only part of that band is on Instagram, so the number
   * disagreed with the grid underneath it. Category and platform counts are
   * unchanged because narrowing them was never asked for and doing it here would
   * quietly alter two filters this task does not cover.
   */
  const platform = opts.platform || null

  const [categories, uncategorized, platforms, tiers, untiered, roster] = await Promise.all([
    kolDb().query<{ name: string; count: number }>(`
      SELECT kc.name, COUNT(*)::int AS count
        FROM public.kol_directory kd
        JOIN public.kol_categories kc ON kc.id = ANY (${CATEGORY_IDS})
       WHERE ${ACTIVE}
       GROUP BY kc.name
       ORDER BY count DESC, kc.name`),
    kolDb().query<{ count: number }>(`
      SELECT COUNT(*)::int AS count
        FROM public.kol_directory kd
       WHERE ${ACTIVE}
         AND (kd.category_ids IS NULL OR cardinality(kd.category_ids) = 0)
         AND kd.category_id IS NULL`),
    kolDb().query<{ key: string; count: number }>(`
      SELECT pl.key, COUNT(*)::int AS count
        FROM public.kol_directory kd
        JOIN public.platforms pl ON pl.id = kd.platform_id
       WHERE ${ACTIVE}
       GROUP BY pl.key
       ORDER BY count DESC`),
    // Driven from `kol_tiers`, so a band with no creators in it still appears
    // with a count of 0 rather than vanishing — and every boundary comes from
    // the table, never from a number written here.
    kolDb().query<{ name: string; count: number; min: number; max: number | null }>(`
      SELECT t.name, COUNT(kd.id)::int AS count,
             t.min_followers AS min, t.max_followers AS max
        FROM public.kol_tiers t
        LEFT JOIN public.kol_directory kd
               ON kd.directory_status = 'active'
              AND kd.followers_count >= t.min_followers
              AND (t.max_followers IS NULL OR kd.followers_count <= t.max_followers)
              AND ($1::text IS NULL OR kd.platform_id = (
                    SELECT pl.id FROM public.platforms pl WHERE pl.key = $1))
       GROUP BY t.name, t.min_followers, t.max_followers
       ORDER BY t.min_followers DESC`, [platform]),
    // The creators no band claims. Two different causes — no follower count at
    // all, and a count below the smallest band's floor — counted together
    // because both answer the same question for the reader: who is missing from
    // every tier chip.
    kolDb().query<{ count: number }>(`
      SELECT COUNT(*)::int AS count
        FROM public.kol_directory kd
        LEFT JOIN public.kol_tiers t
               ON kd.followers_count >= t.min_followers
              AND (t.max_followers IS NULL OR kd.followers_count <= t.max_followers)
       WHERE ${ACTIVE}
         AND t.name IS NULL
         AND ($1::text IS NULL OR kd.platform_id = (
               SELECT pl.id FROM public.platforms pl WHERE pl.key = $1))`, [platform]),
    kolDb().query<{ count: number }>(`
      SELECT COUNT(*)::int AS count FROM public.kol_directory kd WHERE ${ACTIVE}`),
  ])

  return {
    categories: categories.rows,
    uncategorized: uncategorized.rows[0]?.count ?? 0,
    platforms: platforms.rows,
    tiers: tiers.rows,
    untiered: untiered.rows[0]?.count ?? 0,
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
  /** Business Connected — see `CONNECTED`. Replaces the old blue-tick flag. */
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
    er_pct: number | null; er_raw: number | null; tier: string | null
    growth_pct: number | null; connected: boolean
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
  const [rank, platforms, similar, measured, gold] = await Promise.all([
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
            WHERE ${ACTIVE} AND ${ER_CLEAN} > $2)::int
        END AS er_rank,
        (SELECT COUNT(*) FROM public.kol_directory kd
          WHERE ${ACTIVE} AND ${ER_CLEAN} IS NOT NULL)::int AS er_measured_total,
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
           WHERE ${ACTIVE} AND kc.name = $3 AND ${ER_CLEAN} > $2)::int
        END AS category_er_rank,
        (SELECT COUNT(*) FROM public.kol_directory kd
          JOIN public.kol_categories kc ON kc.id = ANY (${CATEGORY_IDS})
         WHERE ${ACTIVE} AND kc.name = $3 AND ${ER_CLEAN} IS NOT NULL)::int
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
      er_pct: number | null; connected: boolean
    }>(`
      SELECT kd.id, pl.key AS platform, kd.username, kd.profile_url,
             kd.followers_count AS followers, ${ER_CLEAN}::float AS er_pct,
             ${CONNECTED} AS connected
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
             kd.followers_count AS followers, ${ER_CLEAN}::float AS er_pct,
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
    getKolGold(id),
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
      erRaw: r.er_raw,
      erQuality: erQualityOf(r.er_pct),
      tier: r.tier,
      growthPct: r.growth_pct,
      connected: r.connected,
      status: r.status,
      lastRefreshedAt: toIso(r.last_refreshed_at),
      // Already in hand here: the agency comes from the join above and the
      // prices from `measured`, so neither needs `attachRosterExtras`.
      agency: r.agency,
      displayName: r.display_name && r.display_name.toLowerCase() !== (r.username ?? '').toLowerCase()
        ? r.display_name
        : null,
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

export interface RosterScrapeTarget extends RosterIdentity {
  profileUrl: string | null
  /**
   * `kol_social_account.social_account_id`, when the roster row already carries
   * one. Null only for an Excel import that was never scraped.
   */
  socialAccountId: string | null
}

/**
 * Everything `startKolScrape` needs to re-run a scrape against a creator who is
 * already in the roster.
 *
 * Refreshing a tracked creator is the same pipeline as adding one, pointed at
 * the row that exists. Both existing ids matter, and the second one is why this
 * function reads `kol_social_account` rather than just the directory row:
 * `startKolScrape` given a `kolDirectoryId` but no `socialAccountId` takes the
 * "imported but never linked" path and INSERTs a fresh `social_account` +
 * `kol_social_account` pair. For a creator who already has one, that is a
 * duplicate identity — and every follower and post table downstream keys off
 * `social_account_id`, so the refresh would write its results against an
 * account nothing else reads.
 */
export async function getRosterScrapeTarget(id: string): Promise<RosterScrapeTarget | null> {
  const { rows } = await kolDb().query<{
    id: string; username: string; platform: string | null
    profile_url: string | null; social_account_id: string | null
  }>(
    `SELECT kd.id, kd.username, pl.key AS platform, kd.profile_url,
            ksa.social_account_id
       FROM public.kol_directory kd
       LEFT JOIN public.platforms pl ON pl.id = kd.platform_id
       LEFT JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
      WHERE kd.id = $1
      LIMIT 1`,
    [id],
  )
  const r = rows[0]
  if (!r) return null
  return {
    id: r.id,
    username: r.username,
    platform: r.platform,
    profileUrl: r.profile_url,
    socialAccountId: r.social_account_id,
  }
}
