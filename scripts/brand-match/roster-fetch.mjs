/**
 * Reads the 24 requested accounts off the KOL server and writes
 * `scripts/brand-match/roster.json`, the only source of creator data the
 * comparison workbook has.
 *
 *   npm run brandmatch:fetch          (office VPN required)
 *   npm run brandmatch:comparison
 *
 * Read-only, and on the KOL pool rather than the warehouse. `kol_directory`,
 * `kol_social_account` and the medallion schemas exist on BOTH servers under the
 * same names, so the pool is what decides which database a query lands in —
 * pointing this at the warehouse would return a different roster without
 * erroring once.
 *
 * ── What this file is allowed to do ─────────────────────────────────────────
 * Read, map, and classify. It never invents a creator and never fills a blank.
 * Where the database has nothing the record carries `null`, and the workbook
 * prints `N/A` or `Limited Data` over it. Four things are worth naming because
 * their absence is easy to mistake for a low number:
 *
 *   Age.        `audience_demographics_daily` holds gender and nothing else —
 *               `audience_type` is 'gender' in all 84 rows — and
 *               `age_gender_breakdown` is NULL in all 27 audience-analysis rows.
 *               There is no age signal anywhere on this server, so Age Match is
 *               N/A for every creator and the audience sub-weights renormalise
 *               over the three dimensions that do carry data.
 *
 *   Content topic. `feature.{ig,tt}_post_analysis.content_category` is NULL in
 *               all 212 rows. Topics here are therefore classified from real
 *               captions and hashtags by CLASSIFICATION_RULES in `taxonomy.mjs`,
 *               and each one carries the evidence that produced it so a reviewer
 *               can overrule it.
 *
 *   Brand safety. `feature.{ig,tt}_comments_analysis` holds 0 rows, so there is
 *               no sentiment, spam or toxicity reading for anybody. What gets
 *               computed downstream is an integrity screen over signals that do
 *               exist — authenticity, follower quality, verification, paid ratio
 *               — and it is labelled as a screen everywhere it appears. The
 *               content-risk half of brand safety is reported N/A rather than as
 *               a number that happens to look reassuring.
 *
 *   Rate card.  `l1_silver.unified_rate_card` holds 0 rows and every
 *               `rate_card_*` column on `kol_profile_card` is NULL. No price
 *               reaches this file, so no CPE, CPM or ROI is computed from one.
 */

import pg from 'pg'
import path from 'node:path'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TAXONOMY, CATEGORIES } from './taxonomy.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(HERE, 'roster.json')

/**
 * The 24 handles as the brief wrote them, in the brief's order.
 *
 * Two do not exist on the server under the spelling given and do exist under a
 * spelling one transposition away, so they resolve through `ALIASES` rather than
 * being reported missing — a slip in a handwritten list is not the same finding
 * as an account the roster does not carry. Both spellings are kept and the
 * Validation sheet prints the pair, so the substitution is visible rather than
 * silent. Nothing else is aliased: a handle that is absent stays absent and is
 * reported NOT FOUND IN KOL DATABASE.
 */
const REQUESTED = [
  'instagram', 'cristiano', 'leomessi', 'raffinagita1717', 'lunamaya', 'ibnuwardani',
  'iben_ma', 'inul.d', 'bbrightvc', 'pevpearce', 'irwansyah_15', 'fadiljaidi',
  'saalhaerid', 'jharnabhagwani', 'sptrakori_', 'lalitahutami', 'isyanasarasvati',
  'lambe_turah', 'ditanganu', 'hesfinatia', 'erickapinedao9', 'anyageraldine',
  'shabiraaluaadnan', 'pojoksatu.id',
]

/** requested spelling -> the spelling `kol_directory.username_normalized` carries. */
const ALIASES = {
  erickapinedao9: 'erickapineda09',
  shabiraaluaadnan: 'shabiraalulaadnan',
}

/**
 * How a `taxonomy.mjs` classifier label is expressed as a DB canonical category.
 *
 * This is NOT a hand-written opinion. Every row is resolved at runtime through
 * `public.kol_categories` itself: the classifier's label is looked up as a
 * category NAME in that table and the answer is whatever `taxonomy_key` the
 * database already assigned it. `Travel` is a real kol_categories row whose
 * taxonomy_key is `Lifestyle`; `Gaming` is a real row whose taxonomy_key is
 * `Tech`. The few labels below are the ones whose classifier spelling differs
 * from the database spelling, and each points at a row that exists.
 *
 * A label with no row, and no entry here, resolves to null — the creator stays
 * uncategorised rather than being filed under an invented key.
 */
const CLASSIFIER_LABEL_TO_DB_NAME = {
  Parenting: 'Parenting and family',
  'Home & Living': 'Home Decor',
  Automotive: 'Automotive and motorsports',
  Finance: 'Business and entrepreneurship',
  Tech: 'Technology and gadgets',
}

/* ── content classification: CLASSIFICATION_RULES in taxonomy.mjs ─────────── */

/**
 * Scores every taxonomy node against a creator's own words.
 *
 * Rule 3: an L3 hit scores 3, an L2 hit 2, an L1 hit 1, times the weight of the
 * evidence it was found in — bio x2 because that is the creator describing
 * themselves, captions and hashtags x1. Hits roll up, so a Skincare Routine hit
 * credits Skincare and Beauty too. Audience interest is deliberately not scored
 * here: rule 2 makes it a tie-break, because what an audience likes is not what
 * the creator makes.
 *
 * Matching is word-boundary rather than containment. Substring matching makes
 * "art" hit "start" and "kartu", which is how a keyword classifier quietly turns
 * into a random number generator.
 */
function classify(bio, captions, hashtags) {
  const evidence = [
    { text: (bio ?? '').toLowerCase(), weight: 2, source: 'bio' },
    { text: captions.join(' \n ').toLowerCase(), weight: 1, source: 'caption' },
    { text: hashtags.join(' ').toLowerCase(), weight: 1, source: 'hashtag' },
  ]
  const score = new Map()
  const hits = new Map()
  const add = (label, points, kw, source) => {
    score.set(label, (score.get(label) ?? 0) + points)
    if (!hits.has(label)) hits.set(label, new Set())
    hits.get(label).add(`${kw} (${source})`)
  }

  for (const cat of TAXONOMY) {
    const levels = [
      { label: cat.label, kw: cat.kw, points: 1, chain: [cat.label] },
      ...cat.subs.flatMap(sub => [
        { label: sub.label, kw: sub.kw, points: 2, chain: [cat.label, sub.label] },
        ...sub.topics.map(t => ({
          label: t.label, kw: t.kw, points: 3, chain: [cat.label, sub.label, t.label],
        })),
      ]),
    ]
    for (const node of levels) {
      for (const kw of node.kw) {
        // Several keywords carry regex metacharacters, so escape before use.
        const safe = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re = new RegExp(`(^|[^\\p{L}\\p{N}])${safe}([^\\p{L}\\p{N}]|$)`, 'iu')
        for (const ev of evidence) {
          if (!ev.text || !re.test(ev.text)) continue
          // Rule 3: a hit credits every level above it, not only its own.
          for (const label of node.chain) add(label, node.points * ev.weight, kw, ev.source)
        }
      }
    }
  }

  const ranked = [...score.entries()]
    .map(([label, points]) => ({ label, points, evidence: [...hits.get(label)].slice(0, 6) }))
    .sort((a, b) => b.points - a.points || a.label.localeCompare(b.label))

  const cats = ranked.filter(r => CATEGORIES.includes(r.label))
  const leader = cats[0]
  const runner = cats[1]

  /**
   * Rule 4, at the category level, plus one condition the rule implies but does
   * not spell out: the leader must be carried by at least two DISTINCT keywords.
   *
   * Points alone cannot tell "this creator makes beauty content" from "this
   * creator once wrote the word shade". Run without it, a single L1 hit in one
   * caption clears the >= 3 threshold and @fadiljaidi — a comedy account — comes
   * back Beauty on the strength of one word, while @irwansyah_15 comes back
   * Parenting on one instance of "keluarga". Both now fall through to
   * Uncategorized, which scores CAL_NEUTRAL against every brand: neither
   * credited nor punished for something nobody has measured. That is the correct
   * answer to "we do not know", and it is a far better failure than a confident
   * label that moves five brand scores.
   */
  const distinct = leader ? new Set(leader.evidence.map(e => e.replace(/ \(\w+\)$/, ''))).size : 0
  let assigned = null
  let basis = null
  if (leader && distinct >= 2 && leader.points >= 6 && (!runner || leader.points - runner.points >= 2)) {
    assigned = leader.label
    basis = 'calculated'
  } else if (leader && distinct >= 2 && leader.points >= 3) {
    assigned = leader.label
    basis = 'estimated'
  }
  return {
    category: assigned,
    basis,
    // Topics are reported at whatever level the evidence reached, so the Content
    // Topics column carries words the creator actually used.
    topics: ranked.filter(r => !CATEGORIES.includes(r.label)).slice(0, 3),
    categoryScores: cats.slice(0, 4),
  }
}

/* ── database ─────────────────────────────────────────────────────────────── */

const REQUIRED = ['PG_HOST_KOL', 'PG_DB_KOL', 'PG_USER_KOL', 'PG_PASSWORD_KOL']
const absent = REQUIRED.filter(k => !process.env[k])
if (absent.length) {
  console.error(`missing from the environment: ${absent.join(', ')}`)
  console.error('run through the env loader: npm run brandmatch:fetch')
  process.exit(1)
}

const pool = new pg.Pool({
  host: process.env.PG_HOST_KOL,
  port: Number(process.env.PG_PORT_KOL ?? 5432),
  database: process.env.PG_DB_KOL,
  user: process.env.PG_USER_KOL,
  password: process.env.PG_PASSWORD_KOL,
  max: 4,
  // The KOL host sits on the office network. Fail in seconds with a sentence
  // naming the likely cause rather than on the OS-level TCP timeout.
  connectionTimeoutMillis: 10_000,
})

const num = v => (v === null || v === undefined ? null : Number(v))

/**
 * Turns `key -> count` rows into shares of the KNOWN portion, and reports how
 * much of the sample was resolvable at all.
 *
 * The distinction matters here more than usual: 'unknown' is the largest single
 * interest key on this server (27 of 27 accounts carry it, often at 80-89% of
 * the sample). Reporting an interest as a share of the whole sample would make
 * every creator look uninterested in everything; reporting it as a share of the
 * known portion without also reporting that portion would make a 3-follower
 * reading look like a census. Both numbers travel together.
 */
function shares(rows, keyCol) {
  const total = rows.reduce((a, r) => a + Number(r.n), 0)
  if (!total) return { total: 0, knownPct: null, rows: [] }
  const known = rows.filter(r => r[keyCol] !== 'unknown').reduce((a, r) => a + Number(r.n), 0)
  if (!known) return { total, knownPct: 0, rows: [] }
  return {
    total,
    knownPct: Math.round((known / total) * 1000) / 10,
    rows: rows
      .filter(r => r[keyCol] !== 'unknown')
      .map(r => ({ key: r[keyCol], pct: Math.round((Number(r.n) / known) * 1000) / 10 }))
      .sort((a, b) => b.pct - a.pct),
  }
}

async function main() {
  const wanted = REQUESTED.map(h => ALIASES[h] ?? h)

  /**
   * The category master, and with it the project's own canonical taxonomy.
   *
   * `kol_categories.taxonomy_key` is the column that already answers "which of
   * these 28 names are the same thing" — Foodies, Food and Cooking all carry
   * `Food`; Sports, Gym Enthusiast, Cyclist and Fitness all carry `Fitness`.
   * Reading it is the difference between using the project's taxonomy and
   * writing a second one that looks like it.
   */
  const { rows: catMaster } = await pool.query(`
    SELECT kc.name, kc.taxonomy_key,
           (SELECT COUNT(*)::int FROM public.kol_directory kd
             WHERE kc.id = ANY (COALESCE(kd.category_ids, ARRAY[kd.category_id]))
               AND kd.directory_status = 'active') AS creators
      FROM public.kol_categories kc
     ORDER BY creators DESC, kc.name`)

  const keyOfName = new Map(catMaster.map(c => [c.name, c.taxonomy_key]))
  const CANONICAL = [...new Set(catMaster.map(c => c.taxonomy_key).filter(Boolean))].sort()

  /** A classifier label expressed as a DB canonical key, or null. */
  const canonicalOfLabel = label => {
    if (!label) return null
    const dbName = CLASSIFIER_LABEL_TO_DB_NAME[label] ?? label
    return keyOfName.get(dbName) ?? null
  }

  console.log('AVAILABLE CATEGORIES FROM EXISTING KOL DATABASE (public.kol_categories)')
  catMaster.forEach((c, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${c.name.padEnd(38)} ${String(c.creators).padStart(5)} creators`
      + `  → taxonomy_key ${c.taxonomy_key ? `"${c.taxonomy_key}"` : '(null)'}`)
  })
  console.log(`\nCANONICAL KEYS (kol_categories.taxonomy_key): ${CANONICAL.join(' · ')}\n`)

  const { rows: dir } = await pool.query(`
    SELECT kd.id, kd.username, kd.username_normalized AS handle, p.key AS platform,
           kd.followers_count AS followers, kd.engagement_rate AS er,
           kd.verified_status, kd.creator_city, kd.bio, kd.created_at, kd.last_refreshed_at,
           (SELECT array_agg(kc.name ORDER BY kc.name)
              FROM public.kol_categories kc
             WHERE kc.id = ANY (COALESCE(kd.category_ids, ARRAY[kd.category_id]))) AS categories
      FROM public.kol_directory kd
      LEFT JOIN public.platforms p ON p.id = kd.platform_id
     WHERE kd.username_normalized = ANY($1) AND kd.directory_status = 'active'`, [wanted])

  const { rows: links } = await pool.query(`
    SELECT ksa.kol_id, ksa.social_account_id
      FROM public.kol_social_account ksa
     WHERE ksa.kol_id = ANY($1)`, [dir.map(d => d.id)])
  const saOf = new Map()
  for (const l of links) {
    if (!saOf.has(l.kol_id)) saOf.set(l.kol_id, [])
    saOf.get(l.kol_id).push(l.social_account_id)
  }
  const allSa = links.map(l => l.social_account_id)

  const [aud, eng, card, interest, geo, demo, posts] = await Promise.all([
    pool.query(`
      SELECT social_account_id AS sid, audience_quality_score AS aq,
             authenticity_score AS auth, follower_quality_score AS fq,
             female_pct, male_pct, gender_known_pct
        FROM feature.ig_audience_analysis WHERE social_account_id = ANY($1)
       UNION ALL
      SELECT social_account_id, audience_quality_score, authenticity_score,
             follower_quality_score, female_pct, male_pct, gender_known_pct
        FROM feature.tt_audience_analysis WHERE social_account_id = ANY($1)`, [allSa]),

    // Engagement analysis exists for Instagram only; TikTok accounts fall back to
    // kol_profile_card, which the same pipeline writes from the same posts.
    pool.query(`
      SELECT social_account_id AS sid, engagement_rate AS er, avg_views, median_views,
             view_to_follower_ratio AS vfr, share_rate, post_frequency_monthly AS pfm,
             post_frequency_count AS pfc, observation_days AS obs, paid_ratio,
             posts_analyzed_count AS posts, views_analyzed_count AS views_n
        FROM feature.ig_engagement_analysis WHERE social_account_id = ANY($1)`, [allSa]),

    pool.query(`
      SELECT DISTINCT ON (social_account_id)
             social_account_id AS sid, tier, is_verified, followers_growth, growth_class,
             avg_views, median_views, view_to_follower_ratio AS vfr, monitoring_er_pct AS er,
             post_frequency_monthly AS pfm, observation_days AS obs, paid_ratio,
             rate_card_min_fee, rate_card_max_fee, profile_snapshot_date
        FROM l2_gold.kol_profile_card WHERE social_account_id = ANY($1)
       ORDER BY social_account_id, profile_snapshot_date DESC NULLS LAST`, [allSa]),

    // Latest snapshot per account only. Summing every day would weight a creator
    // scraped ten times ten-fold against one scraped once.
    pool.query(`
      SELECT social_account_id AS sid, interest_key AS k, SUM(audience_count)::numeric AS n
        FROM l2_gold.audience_interest_daily x
       WHERE social_account_id = ANY($1)
         AND audience_date = (SELECT MAX(audience_date) FROM l2_gold.audience_interest_daily y
                               WHERE y.social_account_id = x.social_account_id)
       GROUP BY 1, 2`, [allSa]),

    pool.query(`
      SELECT social_account_id AS sid, geo_level AS lvl, geo_key AS k,
             SUM(audience_count)::numeric AS n
        FROM l2_gold.audience_geo_daily x
       WHERE social_account_id = ANY($1)
         AND audience_date = (SELECT MAX(audience_date) FROM l2_gold.audience_geo_daily y
                               WHERE y.social_account_id = x.social_account_id)
       GROUP BY 1, 2, 3`, [allSa]),

    pool.query(`
      SELECT social_account_id AS sid, dimension_key AS k, SUM(audience_count)::numeric AS n
        FROM l2_gold.audience_demographics_daily x
       WHERE social_account_id = ANY($1) AND audience_type = 'gender'
         AND audience_date = (SELECT MAX(audience_date) FROM l2_gold.audience_demographics_daily y
                               WHERE y.social_account_id = x.social_account_id
                                 AND y.audience_type = 'gender')
       GROUP BY 1, 2`, [allSa]),

    // The creator's own words: the evidence rule 2 asks for. Captions come from
    // L1 (495 of 503 posts carry one) and hashtags off the same rows, so the two
    // pieces of evidence cannot disagree about which post they came from.
    pool.query(`
      SELECT social_account_id AS sid, caption, hashtags
        FROM l1_silver.unified_post
       WHERE social_account_id = ANY($1)
       ORDER BY COALESCE(posted_at, date::timestamptz) DESC NULLS LAST`, [allSa]),
  ])

  const by = rows => {
    const m = new Map()
    for (const r of rows) {
      if (!m.has(r.sid)) m.set(r.sid, [])
      m.get(r.sid).push(r)
    }
    return m
  }
  const audBy = by(aud.rows)
  const engBy = by(eng.rows)
  const cardBy = by(card.rows)
  const intBy = by(interest.rows)
  const geoBy = by(geo.rows)
  const demoBy = by(demo.rows)
  const postBy = by(posts.rows)

  const records = []
  const rejected = []

  for (const requested of REQUESTED) {
    const resolved = ALIASES[requested] ?? requested
    const candidates = dir.filter(d => d.handle === resolved)

    if (!candidates.length) {
      records.push({ requested, resolved: null, found: false, note: 'NOT FOUND IN KOL DATABASE' })
      continue
    }

    /**
     * A creator can hold a row on both platforms, and the brief asks for 24
     * accounts, so exactly one row per handle survives.
     *
     * The winner is the row carrying the most measured signal, not the row with
     * the most followers. Every component of the score is built out of audience
     * analysis, engagement analysis, interest shares and the creator's own
     * captions; a 24M-follower row with none of those scores worse on all six
     * components than a 4M row that has all four, and picking by follower count
     * would hand the engine a roster it cannot read. The loser is kept in
     * `rejected` and printed on the Validation sheet — a dropped row nobody can
     * see is indistinguishable from a row that was never there.
     */
    const scored = candidates.map(c => {
      const sids = saOf.get(c.id) ?? []
      const has = m => sids.some(s => (m.get(s) ?? []).length > 0)
      return {
        row: c,
        sids,
        signal: (has(audBy) ? 4 : 0) + (has(engBy) ? 2 : 0) + (has(intBy) ? 2 : 0)
          + (has(postBy) ? 2 : 0) + (has(cardBy) ? 1 : 0) + (c.er !== null ? 1 : 0),
      }
    }).sort((a, b) => b.signal - a.signal || Number(b.row.followers) - Number(a.row.followers))

    const win = scored[0]
    for (const lose of scored.slice(1)) {
      rejected.push({
        handle: lose.row.handle,
        platform: lose.row.platform,
        followers: Number(lose.row.followers),
        signal: lose.signal,
        keptPlatform: win.row.platform,
        keptFollowers: Number(win.row.followers),
        keptSignal: win.signal,
      })
    }

    const d = win.row
    const sids = win.sids
    const pick = m => sids.flatMap(s => m.get(s) ?? [])
    const a = pick(audBy)[0] ?? null
    const e = pick(engBy)[0] ?? null
    const c = pick(cardBy)[0] ?? null
    const postRows = pick(postBy)

    const captions = postRows.map(p => p.caption).filter(Boolean)
    const tags = postRows.flatMap(p => p.hashtags ?? []).filter(Boolean)
    const classified = classify(d.bio, captions, tags)

    /**
     * Rule 1: an existing kol_categories row always wins over a keyword hit —
     * and the value that wins is the row's own `taxonomy_key`, never a name this
     * script chose. A creator tagged "Sports" is canonically `Fitness` because
     * the database says so, not because that seemed reasonable.
     *
     * A raw category whose taxonomy_key is NULL — Animal Lovers, Medical,
     * Spirituality and religion — leaves the creator uncategorised. The database
     * has declined to place those on the taxonomy, and inventing a placement
     * here would be overruling it silently.
     */
    const rawCats = d.categories ?? []
    const liveKeys = rawCats.map(n => keyOfName.get(n) ?? null).filter(Boolean)
    const classifiedKey = canonicalOfLabel(classified.category)
    const category = liveKeys[0] ?? classifiedKey
    const categoryBasis = liveKeys.length ? 'live' : (classifiedKey ? classified.basis : null)

    // Interest keys are carried EXACTLY as the database spells them. The brand
    // side targets the same strings, so no crosswalk sits between the two halves
    // to disagree with itself — 'sports' and 'fitness' stay separate keys here
    // because they are separate keys in audience_interest_daily.
    const iShare = shares(pick(intBy).map(r => ({ k: r.k, n: r.n })), 'k')
    const interests = iShare.rows

    const gRows = pick(geoBy)
    const country = shares(gRows.filter(r => r.lvl === 'country').map(r => ({ k: r.k, n: r.n })), 'k')
    const city = shares(gRows.filter(r => r.lvl === 'city').map(r => ({ k: r.k, n: r.n })), 'k')

    const gender = shares(pick(demoBy).map(r => ({ k: r.k, n: r.n })), 'k')
    const femaleFromDemo = gender.rows.find(r => r.key === 'female')?.pct ?? null

    records.push({
      requested,
      resolved: d.handle,
      aliased: requested !== d.handle,
      found: true,
      id: d.id,
      socialAccountIds: sids,
      name: d.username,
      platform: d.platform === 'instagram' ? 'Instagram' : 'TikTok',
      followers: num(d.followers),
      verified: d.verified_status === 'verified' || c?.is_verified === true ? 'Yes' : 'No',
      creatorCity: d.creator_city,
      bio: d.bio || null,
      tier: c?.tier ?? null,
      addedDate: d.created_at,
      refreshedAt: d.last_refreshed_at,

      rawCategories: rawCats,
      category,
      categoryBasis,
      /** The classifier's own answer, expressed as a DB canonical key. */
      classifiedCategory: classifiedKey,
      classification: classified,
      captionCount: captions.length,
      hashtagCount: tags.length,

      /**
       * The creator's own recent text, flattened into one searchable string.
       *
       * This is what Keyword Match and Topic Match actually search, and without
       * it they cannot work on this roster. The alternative haystack — bio plus
       * the taxonomy's English node labels — fails twice over: `kol_directory.bio`
       * is ~12% filled server-wide, and the brand keyword lists are Indonesian
       * while the node labels are English, so "makanan" could never meet
       * "Culinary Review". Measured against the built workbook, searching bio and
       * labels alone returned 0 for 110 of 120 pairs — not because the creators
       * are irrelevant but because nobody had shown the formula any Indonesian.
       *
       * Capped at 1.500 characters: enough for ten captions' worth of subject
       * matter, small enough to sit in a cell a reviewer can read and check the
       * match against.
       */
      captionDigest: captions.concat(tags.map(t => `#${t}`))
        .join(' · ')
        .replace(/\s+/g, ' ')
        .slice(0, 1500) || null,

      /**
       * The creator's own hashtags, deduplicated, as one searchable string.
       *
       * Kept separate from the caption digest because `public.brand` carries
       * `brand_hashtags` as its own column beside `brand_keywords` — the schema
       * treats them as two different questions, so the match does too. A hashtag
       * is a claim about what a post is filed under; a keyword is a word that
       * happened to appear in a sentence.
       */
      hashtagDigest: [...new Set(tags.map(t => t.toLowerCase()))]
        .map(t => `#${t}`).join(' ').slice(0, 900) || null,

      // Three readings of the same quantity, in order of authority. None is
      // coalesced to zero: a creator nobody has measured is not a creator whose
      // engagement is nil.
      er: num(d.er) ?? num(e?.er) ?? num(c?.er),
      erSource: d.er !== null ? 'kol_directory.engagement_rate'
        : e?.er != null ? 'feature.ig_engagement_analysis.engagement_rate'
          : c?.er != null ? 'l2_gold.kol_profile_card.monitoring_er_pct' : null,

      avgViews: num(e?.avg_views) ?? num(c?.avg_views),
      medianViews: num(e?.median_views) ?? num(c?.median_views),
      vfr: num(e?.vfr) ?? num(c?.vfr),
      shareRate: num(e?.share_rate),
      postFrequencyMonthly: num(e?.pfm) ?? num(c?.pfm),
      observationDays: num(e?.obs) ?? num(c?.obs),
      paidRatio: num(e?.paid_ratio) ?? num(c?.paid_ratio),
      postsAnalyzed: num(e?.posts),
      followersGrowth: num(c?.followers_growth),
      growthClass: c?.growth_class ?? null,

      audienceQuality: num(a?.aq),
      authenticity: num(a?.auth),
      followerQuality: num(a?.fq),

      femalePct: num(a?.female_pct) ?? femaleFromDemo,
      malePct: num(a?.male_pct),
      genderKnownPct: num(a?.gender_known_pct),

      interests,
      interestKnownPct: iShare.knownPct,
      countryShares: country.rows,
      countryKnownPct: country.knownPct,
      cityShares: city.rows,
      cityKnownPct: city.knownPct,

      // Named explicitly so no reader has to work out why they are null.
      ageBands: null,                      // no age signal exists on this server
      contentCategoryFromPipeline: null,   // post_analysis.content_category NULL in all rows
      commentSentiment: null,              // comments_analysis holds 0 rows
      communityScore: null,                // no column anywhere
      rateCard: null,                      // unified_rate_card holds 0 rows
    })
  }

  const snapshot = {
    measuredAt: new Date().toISOString(),
    server: `${process.env.PG_HOST_KOL}/${process.env.PG_DB_KOL}`,
    /** The category master exactly as the server holds it, printed in the workbook. */
    categoryMaster: catMaster,
    canonicalCategories: CANONICAL,
    /** Every distinct interest key on the server, so the brand side can only target real ones. */
    interestKeys: (await pool.query(
      'SELECT DISTINCT interest_key k FROM l2_gold.audience_interest_daily ORDER BY 1')).rows.map(r => r.k),
    requested: REQUESTED.length,
    found: records.filter(r => r.found).length,
    aliased: records.filter(r => r.aliased).length,
    notFound: records.filter(r => !r.found).map(r => r.requested),
    rejectedDuplicates: rejected,
    aliasTable: Object.entries(ALIASES).map(([from, to]) => ({ from, to })),
    records,
  }
  writeFileSync(OUT, JSON.stringify(snapshot, null, 2))

  console.log(`wrote ${OUT}`)
  console.log(`  requested ${REQUESTED.length} · found ${snapshot.found} · resolved via alias ${snapshot.aliased}`)
  if (snapshot.notFound.length) console.log(`  NOT FOUND: ${snapshot.notFound.join(', ')}`)
  console.log(`  duplicate platform rows dropped: ${rejected.length}`)
  for (const r of records) {
    if (!r.found) { console.log(`  @${r.requested.padEnd(20)} NOT FOUND IN KOL DATABASE`); continue }
    const bits = [
      r.category ? `${r.category}/${r.categoryBasis}` : 'uncategorised',
      r.er != null ? `ER ${r.er}%` : 'ER —',
      r.audienceQuality != null ? `AQ ${r.audienceQuality}` : 'AQ —',
      `${r.interests.length} interests`,
      `${r.captionCount} captions`,
    ]
    console.log(`  @${r.resolved.padEnd(20)} ${r.platform.padEnd(10)} ${String(r.followers).padStart(10)}  ${bits.join(' · ')}`)
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
