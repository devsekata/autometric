/**
 * Reads the whole eligible creator population off the KOL server and writes
 * `scripts/brand-match/population.json`.
 *
 *   npm run brandmatch:population        (office VPN required)
 *   npm run brandmatch:distribution
 *
 * Same rules as `roster-fetch.mjs`, same tables, same canonical categories, and
 * the same classifier — but every active creator instead of 24 named ones, so
 * the distribution test has a real population to describe rather than a
 * hand-picked sample.
 *
 * ── Why one fetch and three filters ────────────────────────────────────────
 * The three preference profiles each define their own eligible population
 * (platform, minimum followers, category requirement, minimum engagement rate).
 * Fetching once and filtering three times, rather than running three queries,
 * guarantees the three populations are subsets of ONE reading of the server
 * taken at ONE moment. Three separate fetches minutes apart could disagree about
 * a creator's follower count, and the comparison in section 11 of the workbook
 * would be reporting that disagreement as a difference between preferences.
 *
 * ── What is cheap and what is not ──────────────────────────────────────────
 * `kol_directory` is the only large table here at ~7.200 active rows. Everything
 * that makes a creator richly scoreable is tiny: 27 accounts carry an audience
 * analysis, 44 an engagement analysis, 55 any harvested post, 1.978 a profile
 * card. So the whole population fits in a handful of bounded queries, and the
 * resulting file is mostly rows that will score on category and verification
 * alone. That imbalance is the single most important thing the distribution test
 * is going to show, and it is a property of the database, not of this script.
 */

import pg from 'pg'
import path from 'node:path'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { classify, canonicaliser } from './classify.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(HERE, 'population.json')

const REQUIRED = ['PG_HOST_KOL', 'PG_DB_KOL', 'PG_USER_KOL', 'PG_PASSWORD_KOL']
const absent = REQUIRED.filter(k => !process.env[k])
if (absent.length) {
  console.error(`missing from the environment: ${absent.join(', ')}`)
  console.error('run through the env loader: npm run brandmatch:population')
  process.exit(1)
}

const pool = new pg.Pool({
  host: process.env.PG_HOST_KOL,
  port: Number(process.env.PG_PORT_KOL ?? 5432),
  database: process.env.PG_DB_KOL,
  user: process.env.PG_USER_KOL,
  password: process.env.PG_PASSWORD_KOL,
  max: 4,
  connectionTimeoutMillis: 10_000,
})

const num = v => (v === null || v === undefined ? null : Number(v))

/** Shares of the KNOWN portion, plus how large that portion was. */
function shares(rows, keyCol) {
  const total = rows.reduce((a, r) => a + Number(r.n), 0)
  if (!total) return { knownPct: null, rows: [] }
  const known = rows.filter(r => r[keyCol] !== 'unknown').reduce((a, r) => a + Number(r.n), 0)
  if (!known) return { knownPct: 0, rows: [] }
  return {
    knownPct: Math.round((known / total) * 1000) / 10,
    rows: rows
      .filter(r => r[keyCol] !== 'unknown')
      .map(r => ({ key: r[keyCol], pct: Math.round((Number(r.n) / known) * 1000) / 10 }))
      .sort((a, b) => b.pct - a.pct),
  }
}

async function main() {
  const t0 = Date.now()

  const { rows: catMaster } = await pool.query(`
    SELECT kc.name, kc.taxonomy_key,
           (SELECT COUNT(*)::int FROM public.kol_directory kd
             WHERE kc.id = ANY (COALESCE(kd.category_ids, ARRAY[kd.category_id]))
               AND kd.directory_status = 'active') AS creators
      FROM public.kol_categories kc
     ORDER BY creators DESC, kc.name`)
  const keyOfName = new Map(catMaster.map(c => [c.name, c.taxonomy_key]))
  const toCanonical = canonicaliser(keyOfName)
  const CANONICAL = [...new Set(catMaster.map(c => c.taxonomy_key).filter(Boolean))].sort()

  console.log(`category master: ${catMaster.length} names → ${CANONICAL.length} canonical keys`)

  const { rows: dir } = await pool.query(`
    SELECT kd.id, kd.username, kd.username_normalized AS handle, p.key AS platform,
           kd.followers_count AS followers, kd.engagement_rate AS er,
           kd.verified_status, kd.creator_city, kd.bio, kd.created_at,
           (SELECT array_agg(kc.name ORDER BY kc.name)
              FROM public.kol_categories kc
             WHERE kc.id = ANY (COALESCE(kd.category_ids, ARRAY[kd.category_id]))) AS categories
      FROM public.kol_directory kd
      JOIN public.platforms p ON p.id = kd.platform_id
     WHERE kd.directory_status = 'active'`)
  console.log(`active creators: ${dir.length}`)

  const { rows: links } = await pool.query(
    'SELECT kol_id, social_account_id FROM public.kol_social_account')
  const saOf = new Map()
  for (const l of links) {
    if (!saOf.has(l.kol_id)) saOf.set(l.kol_id, [])
    saOf.get(l.kol_id).push(l.social_account_id)
  }

  // Every signal table read in full — all of them are small. No creator filter is
  // applied here on purpose: filtering by the population would mean re-running
  // these the moment a preference changed its eligibility rule.
  const [aud, eng, card, interest, geo, demo, posts] = await Promise.all([
    pool.query(`
      SELECT social_account_id AS sid, audience_quality_score AS aq, authenticity_score AS auth,
             follower_quality_score AS fq, female_pct, male_pct, gender_known_pct
        FROM feature.ig_audience_analysis
       UNION ALL
      SELECT social_account_id, audience_quality_score, authenticity_score,
             follower_quality_score, female_pct, male_pct, gender_known_pct
        FROM feature.tt_audience_analysis`),
    pool.query(`
      SELECT social_account_id AS sid, engagement_rate AS er, avg_views, median_views,
             view_to_follower_ratio AS vfr, post_frequency_monthly AS pfm,
             observation_days AS obs, paid_ratio, posts_analyzed_count AS posts
        FROM feature.ig_engagement_analysis`),
    pool.query(`
      SELECT DISTINCT ON (social_account_id)
             social_account_id AS sid, tier, is_verified, followers_growth,
             avg_views, median_views, view_to_follower_ratio AS vfr,
             monitoring_er_pct AS er, post_frequency_monthly AS pfm,
             observation_days AS obs, paid_ratio
        FROM l2_gold.kol_profile_card
       ORDER BY social_account_id, profile_snapshot_date DESC NULLS LAST`),
    pool.query(`
      SELECT social_account_id AS sid, interest_key AS k, SUM(audience_count)::numeric AS n
        FROM l2_gold.audience_interest_daily x
       WHERE audience_date = (SELECT MAX(audience_date) FROM l2_gold.audience_interest_daily y
                               WHERE y.social_account_id = x.social_account_id)
       GROUP BY 1, 2`),
    pool.query(`
      SELECT social_account_id AS sid, geo_level AS lvl, geo_key AS k,
             SUM(audience_count)::numeric AS n
        FROM l2_gold.audience_geo_daily x
       WHERE audience_date = (SELECT MAX(audience_date) FROM l2_gold.audience_geo_daily y
                               WHERE y.social_account_id = x.social_account_id)
       GROUP BY 1, 2, 3`),
    pool.query(`
      SELECT social_account_id AS sid, dimension_key AS k, SUM(audience_count)::numeric AS n
        FROM l2_gold.audience_demographics_daily x
       WHERE audience_type = 'gender'
         AND audience_date = (SELECT MAX(audience_date) FROM l2_gold.audience_demographics_daily y
                               WHERE y.social_account_id = x.social_account_id AND y.audience_type = 'gender')
       GROUP BY 1, 2`),
    pool.query(`
      SELECT social_account_id AS sid, caption, hashtags
        FROM l1_silver.unified_post
       ORDER BY COALESCE(posted_at, date::timestamptz) DESC NULLS LAST`),
  ])

  const by = rows => {
    const m = new Map()
    for (const r of rows) {
      if (!m.has(r.sid)) m.set(r.sid, [])
      m.get(r.sid).push(r)
    }
    return m
  }
  const audBy = by(aud.rows); const engBy = by(eng.rows); const cardBy = by(card.rows)
  const intBy = by(interest.rows); const geoBy = by(geo.rows); const demoBy = by(demo.rows)
  const postBy = by(posts.rows)

  console.log(`signal rows — audience ${aud.rows.length} · engagement ${eng.rows.length} · `
    + `card ${card.rows.length} · interest ${interest.rows.length} · geo ${geo.rows.length} · `
    + `demographics ${demo.rows.length} · posts ${posts.rows.length}`)

  const records = []
  /**
   * One active row carries neither `username_normalized` nor `username`.
   *
   * It has a follower count and nothing else — no handle to shortlist, no name
   * to put in front of a brand, no way for a reader to check it against the
   * platform. Excluded rather than carried under a placeholder identity, and
   * counted so the exclusion is visible instead of silently shrinking N.
   */
  const unidentifiable = []
  for (const d of dir) {
    if (!d.handle && !d.username) { unidentifiable.push(d.id); continue }
    const sids = saOf.get(d.id) ?? []
    const pick = m => sids.flatMap(s => m.get(s) ?? [])
    const a = pick(audBy)[0] ?? null
    const e = pick(engBy)[0] ?? null
    const c = pick(cardBy)[0] ?? null
    const postRows = pick(postBy)

    const captions = postRows.map(p => p.caption).filter(Boolean)
    const tags = postRows.flatMap(p => p.hashtags ?? []).filter(Boolean)
    const classified = classify(d.bio, captions, tags)

    // Rule 1: an existing kol_categories row always beats a keyword hit, and the
    // value that wins is that row's own taxonomy_key.
    const rawCats = d.categories ?? []
    const liveKeys = rawCats.map(n => keyOfName.get(n) ?? null).filter(Boolean)
    const classifiedKey = toCanonical(classified.category)

    const iShare = shares(pick(intBy).map(r => ({ k: r.k, n: r.n })), 'k')
    const gRows = pick(geoBy)
    const country = shares(gRows.filter(r => r.lvl === 'country').map(r => ({ k: r.k, n: r.n })), 'k')
    const city = shares(gRows.filter(r => r.lvl === 'city').map(r => ({ k: r.k, n: r.n })), 'k')
    const gender = shares(pick(demoBy).map(r => ({ k: r.k, n: r.n })), 'k')

    records.push({
      // `resolved` and `found` keep the shape identical to a roster record, so
      // toScoringRecord() and the scorer need no population-specific branch.
      resolved: d.handle,
      requested: d.handle,
      found: true,
      aliased: false,
      id: d.id,
      name: d.username,
      platform: d.platform === 'instagram' ? 'Instagram' : 'TikTok',
      followers: num(d.followers),
      verified: d.verified_status === 'verified' || c?.is_verified === true ? 'Yes' : 'No',
      bio: d.bio || null,
      addedDate: d.created_at,

      rawCategories: rawCats,
      category: liveKeys[0] ?? classifiedKey,
      categoryBasis: liveKeys.length ? 'live' : (classifiedKey ? classified.basis : null),
      classifiedCategory: classifiedKey,
      classification: classified,

      captionDigest: captions.concat(tags.map(t => `#${t}`))
        .join(' · ').replace(/\s+/g, ' ').slice(0, 1500) || null,
      hashtagDigest: [...new Set(tags.map(t => t.toLowerCase()))]
        .map(t => `#${t}`).join(' ').slice(0, 900) || null,

      er: num(d.er) ?? num(e?.er) ?? num(c?.er),
      avgViews: num(e?.avg_views) ?? num(c?.avg_views),
      medianViews: num(e?.median_views) ?? num(c?.median_views),
      vfr: num(e?.vfr) ?? num(c?.vfr),
      postFrequencyMonthly: num(e?.pfm) ?? num(c?.pfm),
      observationDays: num(e?.obs) ?? num(c?.obs),
      paidRatio: num(e?.paid_ratio) ?? num(c?.paid_ratio),
      followersGrowth: num(c?.followers_growth),

      audienceQuality: num(a?.aq),
      authenticity: num(a?.auth),
      followerQuality: num(a?.fq),
      femalePct: num(a?.female_pct) ?? (gender.rows.find(r => r.key === 'female')?.pct ?? null),
      malePct: num(a?.male_pct),

      interests: iShare.rows,
      interestKnownPct: iShare.knownPct,
      countryShares: country.rows,
      countryKnownPct: country.knownPct,
      cityShares: city.rows,
      cityKnownPct: city.knownPct,
    })
  }

  /**
   * One row per creator, not one per platform account.
   *
   * 216 handles hold a row on both Instagram and TikTok. Left in, each of those
   * people would be counted twice in every population, occupy two ranks, and
   * shift every percentile — and "no duplicate KOL" is one of the things this
   * test has to be able to assert.
   *
   * The survivor is picked by the same rule `roster-fetch.mjs` uses for the same
   * situation: the row carrying the most measured signal, not the most
   * followers. Every component of the score is built out of audience analysis,
   * engagement analysis, interest shares and the creator's own captions, so a
   * 24M-follower row with none of them scores worse on all six components than a
   * 4M row that has all four.
   */
  const bySignal = r => (r.audienceQuality !== null ? 4 : 0) + (r.vfr !== null ? 2 : 0)
    + (r.interestKnownPct !== null ? 2 : 0) + (r.captionDigest ? 2 : 0)
    + (r.postFrequencyMonthly !== null ? 1 : 0) + (r.er !== null ? 1 : 0)

  const byHandle = new Map()
  for (const rec of records) {
    const kept = byHandle.get(rec.resolved)
    if (!kept) { byHandle.set(rec.resolved, rec); continue }
    const better = bySignal(rec) > bySignal(kept)
      || (bySignal(rec) === bySignal(kept) && (rec.followers ?? 0) > (kept.followers ?? 0))
    if (better) byHandle.set(rec.resolved, rec)
  }
  const duplicateRowsDropped = records.length - byHandle.size
  const deduped = [...byHandle.values()]

  const coverage = {
    activeRowsRead: dir.length,
    unidentifiableExcluded: unidentifiable.length,
    duplicateRowsDropped,
    total: deduped.length,
    withCategory: deduped.filter(r => r.category).length,
    withLiveCategory: deduped.filter(r => r.categoryBasis === 'live').length,
    withEngagementRate: deduped.filter(r => r.er !== null).length,
    withViewRatio: deduped.filter(r => r.vfr !== null).length,
    withAudienceAnalysis: deduped.filter(r => r.audienceQuality !== null).length,
    withInterests: deduped.filter(r => r.interestKnownPct !== null).length,
    withCaptions: deduped.filter(r => r.captionDigest).length,
    withBio: deduped.filter(r => r.bio).length,
    verified: deduped.filter(r => r.verified === 'Yes').length,
  }

  writeFileSync(OUT, JSON.stringify({
    measuredAt: new Date().toISOString(),
    server: `${process.env.PG_HOST_KOL}/${process.env.PG_DB_KOL}`,
    categoryMaster: catMaster,
    canonicalCategories: CANONICAL,
    interestKeys: (await pool.query(
      'SELECT DISTINCT interest_key k FROM l2_gold.audience_interest_daily ORDER BY 1')).rows.map(r => r.k),
    coverage,
    unidentifiable,
    records: deduped,
  }))

  console.log(`\nwrote ${OUT} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log('\nSIGNAL COVERAGE ACROSS THE POPULATION')
  const pct = n => `${((n / coverage.total) * 100).toFixed(1)}%`
  for (const [label, n] of [
    ['carry a canonical category', coverage.withCategory],
    ['  of those, from kol_categories (live)', coverage.withLiveCategory],
    ['engagement rate measured', coverage.withEngagementRate],
    ['view-to-follower ratio', coverage.withViewRatio],
    ['audience analysis (quality/authenticity)', coverage.withAudienceAnalysis],
    ['audience interests', coverage.withInterests],
    ['harvested captions', coverage.withCaptions],
    ['bio text', coverage.withBio],
    ['platform-verified', coverage.verified],
  ]) {
    console.log(`  ${label.padEnd(42)} ${String(n).padStart(5)}  ${pct(n).padStart(7)}`)
  }
}

try {
  await main()
} catch (err) {
  console.error(`\nfailed: ${err.message}`)
  if (/timeout|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(err.message)) {
    console.error('the KOL host is on the office network — check the VPN is up.')
  }
  process.exitCode = 1
} finally {
  await pool.end()
}
