import kolDb from '@/lib/kolDb'
import type { ScoringRecord } from './score'
import { tierOf } from './model'
// The same classifier the roster snapshot and the distribution test ran. See
// `./classifier.d.ts` for why this is imported rather than ported.
import { classify, canonicaliser } from '../../../../scripts/brand-match/classify.mjs'

/**
 * Builds `ScoringRecord`s for a set of creators, reading the real KOL server.
 *
 * This is the production counterpart of `scripts/brand-match/population-fetch.mjs`:
 * the same tables, the same columns, the same coalesce order, the same
 * known-share arithmetic — scoped to the creators on screen instead of the whole
 * roster. It has to be the same, because a score computed here and a score in
 * the published distribution test are supposed to be the same score.
 *
 * ── The data source does not change ────────────────────────────────────────
 * `public.kol_directory` on the KOL pool (`@/lib/kolDb`), which is what the
 * Creator Database has always read. Nothing here touches the warehouse, and
 * nothing here writes. The medallion schemas `l1_silver` / `l2_gold` / `feature`
 * exist on BOTH servers under the same names, so the POOL is what decides which
 * database a query lands in — using `@/lib/db` would return different numbers
 * without erroring once.
 *
 * ── Why per page and not precomputed ───────────────────────────────────────
 * A score is a function of (creator, brand profile), and the profile changes the
 * moment someone saves the form. Materialising 7.4k x every org would be a cache
 * to invalidate on every edit, and §9 requires the new profile to reach the
 * directory immediately. Scoring the ~24 rows a page actually shows costs six
 * small queries, because every table that makes a creator richly scoreable is
 * tiny: 24 rows of audience analysis, 44 of engagement analysis, ~500 posts,
 * ~1.978 profile cards. The only large table is `kol_directory` itself, and the
 * directory has already paged it before this runs.
 *
 * ── What is absent, and stays absent ───────────────────────────────────────
 * Age: `audience_demographics_daily` holds gender and nothing else, and
 * `age_gender_breakdown` is NULL in every audience-analysis row. There is no age
 * signal anywhere on this server, so `agePrimaryShare` is null for everyone and
 * Age Match is N/A — which renormalises away rather than scoring 0. The same is
 * true of sub-category, content style and community. None of them is filled in
 * here with a stand-in.
 */

/* ── the category vocabulary ──────────────────────────────────────────────── */

interface CategoryVocab {
  keyOfName: Map<string, string | null>
  toCanonical: (label: string | null | undefined) => string | null
  at: number
}

let vocabCache: CategoryVocab | null = null
/**
 * `public.kol_categories` is 28 rows that change when someone edits the
 * taxonomy, which is approximately never. Cached for an hour so a page of
 * creators does not re-read it per request, and re-read rather than held
 * forever so a taxonomy edit lands the same day.
 */
const VOCAB_TTL_MS = 60 * 60 * 1000

async function categoryVocab(): Promise<CategoryVocab> {
  if (vocabCache && Date.now() - vocabCache.at < VOCAB_TTL_MS) return vocabCache
  const { rows } = await kolDb().query<{ name: string; taxonomy_key: string | null }>(
    'SELECT name, taxonomy_key FROM public.kol_categories')
  const keyOfName = new Map<string, string | null>(rows.map(r => [r.name, r.taxonomy_key]))
  vocabCache = { keyOfName, toCanonical: canonicaliser(keyOfName), at: Date.now() }
  return vocabCache
}

/** Clears the taxonomy cache. For tests and for the verification script. */
export function resetCategoryVocab(): void { vocabCache = null }

/* ── helpers, matching population-fetch.mjs exactly ───────────────────────── */

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

/**
 * Shares of the KNOWN portion, plus how large that portion was.
 *
 * `unknown` is excluded from the numerator and from the denominator of each
 * share, but counted in `knownPct` — so a creator whose audience is 90%
 * unclassified does not look like a perfect interest match on the 10% that was.
 */
function shares(
  rows: { k: string; n: unknown }[],
): { knownPct: number | null; rows: { key: string; pct: number }[] } {
  const total = rows.reduce((a, r) => a + Number(r.n), 0)
  if (!total) return { knownPct: null, rows: [] }
  const known = rows.filter(r => r.k !== 'unknown').reduce((a, r) => a + Number(r.n), 0)
  if (!known) return { knownPct: 0, rows: [] }
  return {
    knownPct: Math.round((known / total) * 1000) / 10,
    rows: rows
      .filter(r => r.k !== 'unknown')
      .map(r => ({ key: r.k, pct: Math.round((Number(r.n) / known) * 1000) / 10 }))
      .sort((a, b) => b.pct - a.pct),
  }
}

function groupBy<T extends { sid: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const list = m.get(r.sid)
    if (list) list.push(r)
    else m.set(r.sid, [r])
  }
  return m
}

/* ── the builder ──────────────────────────────────────────────────────────── */

/**
 * One `ScoringRecord` per requested creator id, keyed by that id.
 *
 * A creator the roster does not have is simply absent from the map rather than
 * present with an empty record: an absent creator and an unmeasured one are
 * different facts, and the caller shows a different thing for each.
 */
export async function scoringRecordsFor(ids: string[]): Promise<Map<string, ScoringRecord>> {
  const out = new Map<string, ScoringRecord>()
  const wanted = [...new Set(ids.filter(Boolean))]
  if (!wanted.length) return out

  const db = kolDb()
  const { keyOfName, toCanonical } = await categoryVocab()

  const { rows: dir } = await db.query<{
    id: string; username: string | null; handle: string | null; platform: string | null
    followers: string | null; er: string | null; verified_status: string | null
    bio: string | null; categories: string[] | null
  }>(`
    SELECT kd.id, kd.username, kd.username_normalized AS handle, p.key AS platform,
           kd.followers_count AS followers, kd.engagement_rate AS er,
           kd.verified_status, kd.bio,
           (SELECT array_agg(kc.name ORDER BY kc.name)
              FROM public.kol_categories kc
             WHERE kc.id = ANY (COALESCE(kd.category_ids, ARRAY[kd.category_id]))) AS categories
      FROM public.kol_directory kd
      JOIN public.platforms p ON p.id = kd.platform_id
     WHERE kd.id = ANY ($1::uuid[])`, [wanted])
  if (!dir.length) return out

  const { rows: links } = await db.query<{ kol_id: string; social_account_id: string }>(
    'SELECT kol_id, social_account_id FROM public.kol_social_account WHERE kol_id = ANY ($1::uuid[])',
    [wanted])
  const sidsOf = new Map<string, string[]>()
  for (const l of links) {
    const list = sidsOf.get(l.kol_id)
    if (list) list.push(l.social_account_id)
    else sidsOf.set(l.kol_id, [l.social_account_id])
  }
  const sids = [...new Set(links.map(l => l.social_account_id))]

  // Nothing below has a row for a creator with no linked social account, so the
  // whole signal fetch is skipped rather than run with an empty array.
  const empty = { rows: [] as never[] }
  const [aud, eng, card, interest, geo, demo, posts] = sids.length ? await Promise.all([
    db.query<{
      sid: string; aq: string | null; auth: string | null; fq: string | null
      female_pct: string | null; male_pct: string | null
    }>(`
      SELECT social_account_id AS sid, audience_quality_score AS aq, authenticity_score AS auth,
             follower_quality_score AS fq, female_pct, male_pct
        FROM feature.ig_audience_analysis WHERE social_account_id = ANY ($1::uuid[])
       UNION ALL
      SELECT social_account_id, audience_quality_score, authenticity_score,
             follower_quality_score, female_pct, male_pct
        FROM feature.tt_audience_analysis WHERE social_account_id = ANY ($1::uuid[])`, [sids]),
    db.query<{
      sid: string; er: string | null; avg_views: string | null; vfr: string | null
      pfm: string | null; obs: string | null; paid_ratio: string | null
    }>(`
      SELECT social_account_id AS sid, engagement_rate AS er, avg_views,
             view_to_follower_ratio AS vfr, post_frequency_monthly AS pfm,
             observation_days AS obs, paid_ratio
        FROM feature.ig_engagement_analysis WHERE social_account_id = ANY ($1::uuid[])`, [sids]),
    db.query<{
      sid: string; followers_growth: string | null; avg_views: string | null
      vfr: string | null; er: string | null; pfm: string | null; obs: string | null
      paid_ratio: string | null; is_verified: boolean | null
    }>(`
      SELECT DISTINCT ON (social_account_id)
             social_account_id AS sid, is_verified, followers_growth, avg_views,
             view_to_follower_ratio AS vfr, monitoring_er_pct AS er,
             post_frequency_monthly AS pfm, observation_days AS obs, paid_ratio
        FROM l2_gold.kol_profile_card WHERE social_account_id = ANY ($1::uuid[])
       ORDER BY social_account_id, profile_snapshot_date DESC NULLS LAST`, [sids]),
    db.query<{ sid: string; k: string; n: string }>(`
      SELECT social_account_id AS sid, interest_key AS k, SUM(audience_count)::numeric AS n
        FROM l2_gold.audience_interest_daily x
       WHERE social_account_id = ANY ($1::uuid[])
         AND audience_date = (SELECT MAX(audience_date) FROM l2_gold.audience_interest_daily y
                               WHERE y.social_account_id = x.social_account_id)
       GROUP BY 1, 2`, [sids]),
    db.query<{ sid: string; lvl: string; k: string; n: string }>(`
      SELECT social_account_id AS sid, geo_level AS lvl, geo_key AS k,
             SUM(audience_count)::numeric AS n
        FROM l2_gold.audience_geo_daily x
       WHERE social_account_id = ANY ($1::uuid[])
         AND audience_date = (SELECT MAX(audience_date) FROM l2_gold.audience_geo_daily y
                               WHERE y.social_account_id = x.social_account_id)
       GROUP BY 1, 2, 3`, [sids]),
    db.query<{ sid: string; k: string; n: string }>(`
      SELECT social_account_id AS sid, dimension_key AS k, SUM(audience_count)::numeric AS n
        FROM l2_gold.audience_demographics_daily x
       WHERE social_account_id = ANY ($1::uuid[]) AND audience_type = 'gender'
         AND audience_date = (SELECT MAX(audience_date) FROM l2_gold.audience_demographics_daily y
                               WHERE y.social_account_id = x.social_account_id
                                 AND y.audience_type = 'gender')
       GROUP BY 1, 2`, [sids]),
    db.query<{ sid: string; caption: string | null; hashtags: string[] | null }>(`
      SELECT social_account_id AS sid, caption, hashtags
        FROM l1_silver.unified_post WHERE social_account_id = ANY ($1::uuid[])
       ORDER BY COALESCE(posted_at, date::timestamptz) DESC NULLS LAST`, [sids]),
  ]) : [empty, empty, empty, empty, empty, empty, empty]

  const audBy = groupBy(aud.rows); const engBy = groupBy(eng.rows); const cardBy = groupBy(card.rows)
  const intBy = groupBy(interest.rows); const geoBy = groupBy(geo.rows)
  const demoBy = groupBy(demo.rows); const postBy = groupBy(posts.rows)

  for (const d of dir) {
    const mine = sidsOf.get(d.id) ?? []
    const pick = <T extends { sid: string }>(m: Map<string, T[]>): T[] =>
      mine.flatMap(s => m.get(s) ?? [])

    const a = pick(audBy)[0] ?? null
    const e = pick(engBy)[0] ?? null
    const c = pick(cardBy)[0] ?? null
    const postRows = pick(postBy)

    const captions = postRows.map(p => p.caption).filter((x): x is string => !!x)
    const tags = postRows.flatMap(p => p.hashtags ?? []).filter(Boolean)
    const classified = classify(d.bio, captions, tags)

    // Rule 1: an existing kol_categories row always beats a keyword hit, and the
    // value that wins is that row's own taxonomy_key.
    const rawCats = d.categories ?? []
    const liveKeys = rawCats.map(n => keyOfName.get(n) ?? null).filter((x): x is string => !!x)
    const classifiedKey = toCanonical(classified.category)

    const iShare = shares(pick(intBy).map(r => ({ k: r.k, n: r.n })))
    const gRows = pick(geoBy)
    const country = shares(gRows.filter(r => r.lvl === 'country').map(r => ({ k: r.k, n: r.n })))
    const city = shares(gRows.filter(r => r.lvl === 'city').map(r => ({ k: r.k, n: r.n })))
    const gender = shares(pick(demoBy).map(r => ({ k: r.k, n: r.n })))

    const idShare = country.rows.find(x => x.key === 'ID')?.pct ?? null
    const interests: Record<string, number> = {}
    for (const it of iShare.rows) interests[it.key] = it.pct

    const topics = classified.topics.map(t => t.label).join(', ') || null
    const evidence = classified.categoryScores.slice(0, 2)
      .map(s => `${s.label} ${s.points}pt [${s.evidence.slice(0, 3).join('; ')}]`)
      .join('  ·  ') || null

    const followers = num(d.followers)

    out.set(d.id, {
      handle: d.handle,
      name: d.username,
      platform: d.platform === 'instagram' ? 'Instagram' : 'TikTok',
      followers,
      tier: tierOf(followers),
      verified: d.verified_status === 'verified' || c?.is_verified === true ? 'Yes' : 'No',

      category: liveKeys[0] ?? classifiedKey,
      classifiedCategory: classifiedKey,
      rawCategories: rawCats.join(' | ') || null,
      contentTopics: topics,
      classificationEvidence: evidence,
      bio: d.bio || null,
      captionDigest: captions.concat(tags.map(t => `#${t}`))
        .join(' · ').replace(/\s+/g, ' ').slice(0, 1500) || null,
      hashtagDigest: [...new Set(tags.map(t => t.toLowerCase()))]
        .map(t => `#${t}`).join(' ').slice(0, 900) || null,

      // No age signal exists anywhere on this server; carried as null so Age
      // Score resolves to N/A through the same branch it would use with data.
      agePrimaryShare: null,
      ageSecondaryShare: null,
      femalePct: num(a?.female_pct) ?? (gender.rows.find(r => r.key === 'female')?.pct ?? null),
      malePct: num(a?.male_pct),
      audienceCountry: idShare === null ? null : 'Indonesia',
      countryShare: idShare,
      cities: city.rows,
      cityKnownPct: city.knownPct,
      interests,
      interestKnownPct: iShare.knownPct,

      er: num(d.er) ?? num(e?.er) ?? num(c?.er),
      avgViews: num(e?.avg_views) ?? num(c?.avg_views),
      vfr: num(e?.vfr) ?? num(c?.vfr),
      postFrequencyMonthly: num(e?.pfm) ?? num(c?.pfm),
      observationDays: num(e?.obs) ?? num(c?.obs),
      followersGrowth: num(c?.followers_growth),
      paidRatio: num(e?.paid_ratio) ?? num(c?.paid_ratio),

      audienceQuality: num(a?.aq),
      authenticity: num(a?.auth),
      followerQuality: num(a?.fq),
    })
  }

  return out
}
