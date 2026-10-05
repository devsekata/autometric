import pool from '@/lib/db'

/**
 * What the warehouse actually measured about a tracked account.
 *
 * ── Why this module exists ─────────────────────────────────────────────────
 * `@/lib/discover/profile.ts` invented these. Follower count was
 * `avgViews × between(4,7)`, the tier was derived from that invention, and the
 * audience age, gender and location were picked out of fixed lists by hashing
 * the account id. Meanwhile `l0_raw.{ig,tt,fb}_profile_snapshots` had been
 * storing the real numbers the whole time — the sync writes a row per fetch, and
 * nothing downstream had ever read the follower or demographics columns.
 *
 * Every field here is nullable, and null means **not measured** — never 0, and
 * never a stand-in. An account with no follower snapshot and an account with
 * zero followers are different facts.
 *
 * ── The three platforms disagree about column names, not about meaning ─────
 *   Instagram  `followers_count`   TikTok `follower_count`   Facebook `fan_count`
 * They are unioned here so callers never branch on platform to read a follower
 * count. `fan_count` is Facebook's Page likes rather than followers; the Page
 * also carries `followers_count`, so that is preferred and `fan_count` is the
 * fallback.
 *
 * ── Demographics are owned-account-only, and that is structural ────────────
 * They come from the platform's insights API, which only answers for an account
 * you have an OAuth token for. Competitor accounts are scraped, and scraping
 * cannot return an audience breakdown — so a competitor will never have
 * demographics here no matter how long the pipeline runs. Measured 11 Sep 2026:
 * 16 of 42 owned accounts carry them, 0 of 7 competitors.
 *
 * ── A non-null column is not data ──────────────────────────────────────────
 * The `demographics_*` columns are frequently a stored Meta error payload:
 *
 *     {"error":{"code":3006,"message":"Not enough users", …}}
 *
 * Meta refuses the breakdown until an account has 100+ people in each bucket,
 * and the sync stores the refusal verbatim. Counting those as coverage is how
 * "15 accounts have demographics" becomes "17". `NOT (col ? 'error')` in the SQL
 * below is what separates a reading from a refusal.
 */

/** Audience shares for one dimension, as `label -> percentage of the known total`. */
export type Breakdown = { label: string; pct: number }[]

export interface AccountFacts {
  /** Real follower count from the newest profile snapshot. Null when never synced. */
  followers: number | null
  /** When that snapshot was taken, so a caller can say how stale the number is. */
  followersAt: string | null
  /** Platform verification. Only TikTok publishes it; null elsewhere. */
  verified: boolean | null
  /** Audience age bands, largest first. Empty when unmeasured. */
  age: Breakdown
  /** Audience gender split, largest first. Empty when unmeasured. */
  gender: Breakdown
  /** Audience cities, largest first. Empty when unmeasured. */
  city: Breakdown
  /** Audience countries, largest first. Empty when unmeasured. */
  country: Breakdown
}

/** An account with nothing measured. Used so callers never handle `undefined`. */
export const NO_FACTS: AccountFacts = {
  followers: null, followersAt: null, verified: null,
  age: [], gender: [], city: [], country: [],
}

/* ── parsing the platform payloads ────────────────────────────────────────── */

interface MetricItem {
  name?: string
  total_value?: { breakdowns?: { results?: { dimension_values?: string[]; value?: number }[] }[] }
}

/**
 * Pulls one metric's breakdown out of a Graph API demographics payload.
 *
 * The same shape `@/lib/instagram/queries.ts` already parses for the Instagram
 * dashboard — deliberately the same traversal, because two readers of one
 * payload that disagree about which metric to take would put two different
 * audience splits on two screens for the same account.
 *
 * `follower_demographics` is preferred over `engaged_audience_demographics`:
 * this module answers "who follows this account", and engaged-audience is a
 * different and smaller population. Falls back to the engaged set when the
 * follower set is absent, because a narrower real reading beats no reading.
 */
function parseBreakdown(raw: unknown): Breakdown {
  if (!raw || typeof raw !== 'object') return []
  const payload = raw as { data?: MetricItem[]; error?: unknown }
  // A stored API refusal, not an audience. See the note at the top.
  if (payload.error) return []

  const items = payload.data ?? []
  const pick = (name: string) => items.find(i => i.name === name)
  const item = pick('follower_demographics') ?? pick('engaged_audience_demographics') ?? items[0]
  const results = item?.total_value?.breakdowns?.[0]?.results ?? []

  const rows = results
    .map(r => ({ label: r.dimension_values?.[0] ?? '', value: Number(r.value ?? 0) }))
    .filter(r => r.label && Number.isFinite(r.value) && r.value > 0)

  const total = rows.reduce((n, r) => n + r.value, 0)
  if (total <= 0) return []

  // Shares of the measured total, so the reader sees a distribution rather than
  // raw counts whose denominator is invisible.
  return rows
    .map(r => ({ label: r.label, pct: Math.round((r.value / total) * 1000) / 10 }))
    .sort((a, b) => b.pct - a.pct)
}

/* ── the loader ───────────────────────────────────────────────────────────── */

interface SnapRow {
  social_account_id: string
  followers: string | null
  fetched_at: Date | null
  verified: boolean | null
  demographics_age: unknown
  demographics_gender: unknown
  demographics_city: unknown
  demographics_country: unknown
}

/**
 * The newest snapshot per account on each platform, unioned.
 *
 * `DISTINCT ON (social_account_id) … ORDER BY fetched_at DESC` per table rather
 * than one big union then a window: the three tables have different column
 * names and different row counts, and narrowing each to one row before the union
 * keeps the scan proportional to accounts rather than to the ~1.250 snapshot
 * rows they hold between them.
 *
 * Restricted to the ids asked for. Nothing here is org-scoped because a social
 * account is not owned by an org — `listDirectory` has already decided which
 * accounts this caller may see, and this only adds facts to that list.
 */
const SQL = `
  WITH ig AS (
    SELECT DISTINCT ON (social_account_id)
           social_account_id, followers_count::text AS followers, fetched_at,
           NULL::boolean AS verified,
           demographics_age, demographics_gender, demographics_city, demographics_country
      FROM l0_raw.ig_profile_snapshots
     WHERE social_account_id = ANY ($1::uuid[])
     ORDER BY social_account_id, fetched_at DESC
  ), tt AS (
    SELECT DISTINCT ON (social_account_id)
           social_account_id, follower_count::text AS followers, fetched_at,
           is_verified AS verified,
           demographics_age, demographics_gender, demographics_city, demographics_country
      FROM l0_raw.tt_profile_snapshots
     WHERE social_account_id = ANY ($1::uuid[])
     ORDER BY social_account_id, fetched_at DESC
  ), fb AS (
    SELECT DISTINCT ON (social_account_id)
           social_account_id,
           -- Page followers, not Page likes. fan_count is the like count and
           -- is the fallback only because older rows predate followers_count.
           COALESCE(followers_count, fan_count)::text AS followers, fetched_at,
           NULL::boolean AS verified,
           demographics_age, demographics_gender, demographics_city, demographics_country
      FROM l0_raw.fb_profile_snapshots
     WHERE social_account_id = ANY ($1::uuid[])
     ORDER BY social_account_id, fetched_at DESC
  )
  SELECT * FROM ig UNION ALL SELECT * FROM tt UNION ALL SELECT * FROM fb`

/**
 * Facts for a set of tracked accounts, keyed by social account id.
 *
 * An account with no snapshot row is simply absent from the map; callers use
 * `NO_FACTS` for it, which is all-null rather than all-zero.
 */
export async function accountFactsFor(ids: string[]): Promise<Map<string, AccountFacts>> {
  const out = new Map<string, AccountFacts>()
  const wanted = [...new Set(ids.filter(Boolean))]
  if (!wanted.length) return out

  const { rows } = await pool.query<SnapRow>(SQL, [wanted])

  for (const r of rows) {
    const followers = r.followers === null ? null : Number(r.followers)
    const facts: AccountFacts = {
      followers: followers !== null && Number.isFinite(followers) ? followers : null,
      followersAt: r.fetched_at ? r.fetched_at.toISOString() : null,
      verified: r.verified,
      age: parseBreakdown(r.demographics_age),
      gender: parseBreakdown(r.demographics_gender),
      city: parseBreakdown(r.demographics_city),
      country: parseBreakdown(r.demographics_country),
    }

    /*
     * One social account can hold rows in more than one of the three tables —
     * a Facebook Page and its linked Instagram account share an id in some
     * configurations. The richer row wins rather than the last one read, so the
     * result does not depend on the order the UNION happened to produce.
     */
    const kept = out.get(r.social_account_id)
    if (!kept) { out.set(r.social_account_id, facts); continue }
    const score = (f: AccountFacts) =>
      (f.followers !== null ? 4 : 0) + (f.age.length ? 2 : 0)
      + (f.gender.length ? 1 : 0) + (f.city.length ? 1 : 0)
    if (score(facts) > score(kept)) out.set(r.social_account_id, facts)
  }

  return out
}

/** The largest band, for a one-line "top age" style summary. Null when unmeasured. */
export const topOf = (b: Breakdown): string | null => b[0]?.label ?? null

/**
 * Female share of the measured gender split, 0–100. Null when unmeasured.
 *
 * Matches on the labels the platforms actually emit (`F`, `female`), and returns
 * null rather than 0 when the split exists but names neither — an unrecognised
 * vocabulary is a parsing gap, not an all-male audience.
 */
export function femaleShare(gender: Breakdown): number | null {
  if (!gender.length) return null
  const hit = gender.find(g => /^(f|female|wanita|perempuan)$/i.test(g.label.trim()))
  if (hit) return hit.pct
  const male = gender.find(g => /^(m|male|pria|laki-laki)$/i.test(g.label.trim()))
  return male ? Math.round((100 - male.pct) * 10) / 10 : null
}
