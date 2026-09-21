import kolDb from '@/lib/kolDb'
import { INTEREST_KEYS } from '@/lib/discover/brandMatch/model'

/**
 * Brand Match — the Brand Profile's Target Audience, scored against the
 * creator's measured audience.
 *
 *     brand_profile.{gender_majority, target_age_min/max, target_country,
 *                    target_city, audience_interests}
 *       → share of the creator's audience that fits → 0..100 per criterion
 *
 * ── Source of truth: the existing Audience Analysis, nothing else ──────────
 * Every number is read from the L2 tables the audience pipeline
 * (scrapper-project `audience_feature` → `audience_gold`) already writes from
 * follower-level evidence, with the same "newest audience_date per account"
 * rule `kolGold.ts` uses for the creator page:
 *
 *   Gender   l2_gold.audience_demographics_daily  audience_type = 'gender'
 *   Age      l2_gold.audience_demographics_daily  audience_type = 'age'
 *   City     l2_gold.audience_geo_daily            geo_level = 'city'
 *   Country  l2_gold.audience_geo_daily            geo_level = 'country' (ISO-2)
 *   Interest l2_gold.audience_interest_daily       interest_key
 *
 * No creator column (creator_gender, creator_city, bio, category) is read, no
 * audience value is stored anywhere new, and interests are the existing
 * `interest_key` vocabulary (`INTEREST_KEYS`) — no segment of our own.
 *
 * ── Selected = the requirement is filled in ───────────────────────────────
 * A criterion enters Brand Match only when its Brand Profile field says
 * something: gender Female/Male/Balanced ('Any' says nothing), an age bound,
 * a country, a city, at least one interest. An empty field is not selected
 * and never touches the denominator.
 *
 * ── Score = share of the known audience that fits ─────────────────────────
 * Each score is the percentage of followers whose value is KNOWN and matches
 * the requirement — the same denominator the production `female_pct` /
 * `male_pct` use (unknown excluded from the ratio, reported beside it).
 * `unknown` never counts as a match.
 *
 * Fewer than `AUDIENCE_MIN_KNOWN` known followers, or no audience rows at all,
 * gives `null`: the criterion leaves the denominator (the What Matters rule for
 * an unmeasured criterion) instead of scoring 0 or a 100 read off one person.
 * The floor is the same 5 the scrapper-side `audience_classification.MIN_KNOWN`
 * uses before calling any audience value dominant.
 */

export const AUDIENCE_CRITERIA = [
  'audience_gender', 'audience_age', 'audience_country', 'audience_city', 'audience_interest',
] as const
export type AudienceCriterionKey = (typeof AUDIENCE_CRITERIA)[number]

export const AUDIENCE_CRITERIA_LABELS: Record<AudienceCriterionKey, string> = {
  audience_gender: 'Audience Gender',
  audience_age: 'Audience Age',
  audience_country: 'Audience Country',
  audience_city: 'Audience City',
  audience_interest: 'Audience Interest',
}

/** Below this many known followers a criterion is unmeasured, not a score. */
export const AUDIENCE_MIN_KNOWN = 5

/** The Brand Profile's Target Audience fields, as `getBrandProfile` returns them. */
export interface AudienceRequirements {
  genderMajority: string | null
  targetAgeMin: number | null
  targetAgeMax: number | null
  targetCountry: string | null
  targetCity: string | null
  audienceInterests: readonly string[]
}

export const NO_AUDIENCE_REQUIREMENTS: AudienceRequirements = {
  genderMajority: 'Any', targetAgeMin: null, targetAgeMax: null,
  targetCountry: null, targetCity: null, audienceInterests: [],
}

/** Counts per key as L2 stores them, `unknown` included. */
export type Distribution = Record<string, number>

export interface AudienceRecord {
  gender: Distribution
  age: Distribution
  city: Distribution
  country: Distribution
  interest: Distribution
}

export type AudienceScores = Partial<Record<AudienceCriterionKey, number | null>>

const blank = (s: string | null | undefined) => !s || !s.trim()

/** Interests the profile asked for, restricted to the keys L2 actually holds. */
function wantedInterests(req: AudienceRequirements): string[] {
  const valid = new Set<string>(INTEREST_KEYS)
  return [...new Set(req.audienceInterests.map(i => String(i).trim().toLowerCase()))].filter(i => valid.has(i))
}

/** Which audience criteria this profile selects, in fixed order. */
export function selectedAudienceCriteria(req: AudienceRequirements | null | undefined): AudienceCriterionKey[] {
  if (!req) return []
  const on: Record<AudienceCriterionKey, boolean> = {
    audience_gender: ['Female', 'Male', 'Balanced'].includes(req.genderMajority ?? ''),
    audience_age: req.targetAgeMin !== null || req.targetAgeMax !== null,
    audience_country: !blank(req.targetCountry),
    audience_city: !blank(req.targetCity),
    audience_interest: wantedInterests(req).length > 0,
  }
  return AUDIENCE_CRITERIA.filter(k => on[k])
}

/* ── pure scorers ─────────────────────────────────────────────────────────── */

const isUnknown = (k: string) => k.trim().toLowerCase() === 'unknown'

function knownTotal(d: Distribution): number {
  return Object.entries(d).reduce((s, [k, v]) => (isUnknown(k) || !(v > 0) ? s : s + v), 0)
}

/** share (0..100) of the known audience matched, or null when too few are known. */
function share(matched: number, known: number): number | null {
  if (!(known >= AUDIENCE_MIN_KNOWN)) return null
  return (matched / known) * 100
}

export function audienceGenderScore(d: Distribution | undefined, majority: string | null): number | null {
  if (!d) return null
  const f = d.female > 0 ? d.female : 0
  const m = d.male > 0 ? d.male : 0
  const known = f + m
  if (majority === 'Female') return share(f, known)
  if (majority === 'Male') return share(m, known)
  if (majority === 'Balanced') {
    const s = share(Math.min(f, m) * 2, known)          // 100 at 50/50, 0 at 100/0
    return s
  }
  return null
}

/** The age buckets the pipeline writes; `45+` is open-ended. */
export const AGE_BUCKETS: Record<string, [number, number | null]> = {
  '13-17': [13, 17], '18-24': [18, 24], '25-34': [25, 34], '35-44': [35, 44], '45+': [45, null],
}

/**
 * How much of one bucket lies inside the requested range, 0..1, by years.
 * The open `45+` bucket cannot be split by years without inventing a
 * distribution, so it counts whole whenever the range reaches 45.
 */
export function ageBucketOverlap(bucket: string, min: number | null, max: number | null): number {
  const b = AGE_BUCKETS[bucket]
  if (!b) return 0
  const lo = min ?? -Infinity
  const hi = max ?? Infinity
  const [a, z] = b
  if (z === null) return hi >= a ? 1 : 0
  const from = Math.max(a, lo)
  const to = Math.min(z, hi)
  return to < from ? 0 : (to - from + 1) / (z - a + 1)
}

export function audienceAgeScore(d: Distribution | undefined, min: number | null, max: number | null): number | null {
  if (!d || (min === null && max === null)) return null
  let known = 0
  let matched = 0
  for (const [k, v] of Object.entries(d)) {
    if (!(k in AGE_BUCKETS) || !(v > 0)) continue
    known += v
    matched += v * ageBucketOverlap(k, min, max)
  }
  return share(matched, known)
}

const REGION_NAMES = ['en', 'id'].map(l => new Intl.DisplayNames([l], { type: 'region' }))
let countryIndex: Map<string, string> | null = null

/**
 * The Brand Profile stores the country as free text ('Indonesia'); the audience
 * pipeline keys it by ISO-2 ('ID'). Resolved here at compare time — the stored
 * profile value is not rewritten. Accepts a bare ISO-2 code too.
 */
export function countryToIso2(name: string | null | undefined): string | null {
  if (blank(name)) return null
  const t = name!.trim()
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase()
  if (!countryIndex) {
    countryIndex = new Map()
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    for (const x of A) for (const y of A) {
      const code = x + y
      for (const dn of REGION_NAMES) {
        let label: string | undefined
        try { label = dn.of(code) } catch { label = undefined }
        if (label && label !== code) countryIndex.set(label.toLowerCase(), code)
      }
    }
  }
  return countryIndex.get(t.toLowerCase()) ?? null
}

export function audienceCountryScore(d: Distribution | undefined, target: string | null): number | null {
  const iso = countryToIso2(target)
  if (!d || !iso) return null
  const matched = Object.entries(d).reduce((s, [k, v]) => (k.trim().toUpperCase() === iso && v > 0 ? s + v : s), 0)
  return share(matched, knownTotal(d))
}

export function audienceCityScore(d: Distribution | undefined, target: string | null): number | null {
  if (!d || blank(target)) return null
  const want = target!.trim().toLowerCase()
  const matched = Object.entries(d).reduce((s, [k, v]) => (k.trim().toLowerCase() === want && v > 0 ? s + v : s), 0)
  return share(matched, knownTotal(d))
}

export function audienceInterestScore(d: Distribution | undefined, wanted: readonly string[]): number | null {
  if (!d || !wanted.length) return null
  const w = new Set(wanted)
  const matched = Object.entries(d).reduce((s, [k, v]) => (w.has(k.trim().toLowerCase()) && v > 0 ? s + v : s), 0)
  return share(matched, knownTotal(d))
}

/** Score only the selected criteria; an absent record scores null everywhere. */
export function audienceScores(rec: AudienceRecord | undefined, req: AudienceRequirements): AudienceScores {
  const out: AudienceScores = {}
  for (const k of selectedAudienceCriteria(req)) {
    out[k] =
      k === 'audience_gender' ? audienceGenderScore(rec?.gender, req.genderMajority)
      : k === 'audience_age' ? audienceAgeScore(rec?.age, req.targetAgeMin, req.targetAgeMax)
      : k === 'audience_country' ? audienceCountryScore(rec?.country, req.targetCountry)
      : k === 'audience_city' ? audienceCityScore(rec?.city, req.targetCity)
      : audienceInterestScore(rec?.interest, wantedInterests(req))
  }
  return out
}

/* ── read: the existing Audience Analysis L2, newest day per account ──────── */

const AUDIENCE_SQL = `
  WITH acc AS (
    SELECT ksa.kol_id::text AS id, ksa.social_account_id
      FROM public.kol_social_account ksa
     WHERE ksa.kol_id = ANY ($1::uuid[])
  )
  SELECT acc.id, a.audience_type AS dim, a.dimension_key AS key, SUM(a.audience_count)::float8 AS n
    FROM acc
    JOIN l2_gold.audience_demographics_daily a ON a.social_account_id = acc.social_account_id
   WHERE a.audience_type IN ('gender', 'age')
     AND a.audience_date = (SELECT MAX(x.audience_date) FROM l2_gold.audience_demographics_daily x
                             WHERE x.social_account_id = a.social_account_id
                               AND x.audience_type = a.audience_type)
   GROUP BY 1, 2, 3
  UNION ALL
  SELECT acc.id, g.geo_level, g.geo_key, SUM(g.audience_count)::float8
    FROM acc
    JOIN l2_gold.audience_geo_daily g ON g.social_account_id = acc.social_account_id
   WHERE g.geo_level IN ('city', 'country')
     AND g.audience_date = (SELECT MAX(x.audience_date) FROM l2_gold.audience_geo_daily x
                             WHERE x.social_account_id = g.social_account_id)
   GROUP BY 1, 2, 3
  UNION ALL
  SELECT acc.id, 'interest', i.interest_key, SUM(i.audience_count)::float8
    FROM acc
    JOIN l2_gold.audience_interest_daily i ON i.social_account_id = acc.social_account_id
   WHERE i.audience_date = (SELECT MAX(x.audience_date) FROM l2_gold.audience_interest_daily x
                             WHERE x.social_account_id = i.social_account_id)
   GROUP BY 1, 2, 3`

/** creator id → its audience distributions. Creators with no audience rows are absent. */
export async function audienceRecordsFor(creatorIds: string[]): Promise<Map<string, AudienceRecord>> {
  const out = new Map<string, AudienceRecord>()
  if (!creatorIds.length) return out
  const { rows } = await kolDb().query<{ id: string; dim: string; key: string | null; n: number | null }>(
    AUDIENCE_SQL, [creatorIds])
  for (const r of rows) {
    if (r.key === null || r.n === null) continue
    let rec = out.get(r.id)
    if (!rec) { rec = { gender: {}, age: {}, city: {}, country: {}, interest: {} }; out.set(r.id, rec) }
    const dim = r.dim as keyof AudienceRecord
    if (!(dim in rec)) continue
    rec[dim][r.key] = (rec[dim][r.key] ?? 0) + Number(r.n)
  }
  return out
}
