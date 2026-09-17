/**
 * Verifies the Creator Profile shows only data the KOL server actually holds.
 *
 *   npm run verify:profile-real               # static + logic + @iben_ma
 *   npm run verify:profile-real -- --offline  # static + logic only, no VPN
 *   npm run verify:profile-real -- someone    # a different username
 *
 * Three layers:
 *   1. static  — the workspace files import no generator and render no demo
 *                badge, fake campaign list or followers × ER "reach".
 *   2. logic   — `formatErRows` ignores engagement on days with no follower
 *                denominator (the `clips` 3.21% vs 2.29% bug on @iben_ma).
 *   3. live    — loads the creator through `getKolCreator` + `creatorIntel`,
 *                the same path the API route and the page use, and compares
 *                each figure with a direct SELECT. Read-only. Needs the VPN.
 */
import { readFileSync } from 'node:fs'
import kolDb from '@/lib/kolDb'
import { getKolCreator } from '@/lib/discover/kolDirectory'
import { creatorIntel } from '@/lib/discover/kolIntel'
import { formatErRows } from '@/lib/discover/kolFormatEr'
import type { GoldFormatDay } from '@/lib/discover/kolGold'

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const close = (a: number | null | undefined, b: number | null | undefined, eps = 1e-6) =>
  a == null || b == null ? a == b : Math.abs(a - b) <= eps
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

const args = process.argv.slice(2)
const offline = args.includes('--offline')
const username = args.find(a => !a.startsWith('--')) ?? 'iben_ma'

/* ── 1. static ─────────────────────────────────────────────────────────────── */

console.log('\nstatic')
const FILES = [
  'src/components/discover/KolCreatorWorkspace.tsx',
  'src/components/discover/KolCreatorSections.tsx',
  'src/components/discover/KolCreatorProfile.tsx',
  'src/components/discover/KolCreatorReport.tsx',
  'src/lib/discover/kolIntel.ts',
  'src/lib/discover/kolMeasured.ts',
  'src/lib/discover/kolGold.ts',
]
const BANNED: [string, RegExp][] = [
  ['Math.random', /Math\.random/],
  ['kolSample import', /from ['"][^'"]*kolSample['"]/],
  ['sampleIntel call', /sampleIntel\(/],
  ['demo badge', /Demo profile/],
  ['written-in campaigns', /CAMPAIGN_OPTIONS|Summer Beauty Campaign/],
  ['followers × ER reach', /followers\s*\*\s*creator\.erPct/],
  ['sample marker prop', /\bsample(=\{|\s*\/?>|\s+\n)/],
]
for (const f of FILES) {
  // Comments are stripped first: several files explain in prose what the old
  // generator did, and naming it there is history, not a call.
  const src = readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const hits = BANNED.filter(([, re]) => re.test(src)).map(([l]) => l)
  ok(f, hits.length === 0, hits.join(', '))
}

/* ── 2. logic ──────────────────────────────────────────────────────────────── */

console.log('\nlogic: formatErRows')
{
  const day = (date: string, engagement: number | null, followersDenom: number | null): GoldFormatDay => ({
    date, platform: 'instagram', mediaType: 'clips', postCount: 1, postsInSample: 1,
    likes: null, comments: null, views: null, engagement, followersDenom,
    engagementForEr: followersDenom ? engagement : null,
    erFollowers: engagement !== null && followersDenom ? engagement / followersDenom : null,
  })
  // Day 2 has engagement but no snapshot: it must not enter the numerator.
  const rows = formatErRows([day('2026-08-01', 100, 10_000), day('2026-08-02', 900, null)])
  ok('engagement without a denominator is excluded', close(rows[0].er, 0.01), `er=${rows[0].er}`)
  // Even if a row carried engagementForEr without a denominator, it must not count.
  const odd = formatErRows([day('2026-08-01', 100, 10_000), { ...day('2026-08-02', 900, null), engagementForEr: 900 }])
  ok('engagementForEr without a denominator is excluded', close(odd[0].er, 0.01), `er=${odd[0].er}`)
  ok('post count still covers every day', rows[0].posts === 2)
  const none = formatErRows([day('2026-08-02', 900, null)])
  ok('no denominator at all → er null, not 0', none[0].er === null)
}

/* ── 3. live ───────────────────────────────────────────────────────────────── */

async function live() {
  const db = kolDb()
  const { rows: roster } = await db.query<{ id: string; platform: string | null }>(
    `SELECT kd.id, pl.key AS platform
       FROM public.kol_directory kd LEFT JOIN public.platforms pl ON pl.id = kd.platform_id
      WHERE kd.username = $1`, [username])
  ok(`@${username} is in the roster`, roster.length > 0, `${roster.length} row(s)`)

  for (const { id, platform } of roster) {
    console.log(`\nlive: @${username} · ${platform} · ${id}`)
    const payload = await getKolCreator(id)
    if (!payload) { ok('getKolCreator returned the creator', false); continue }
    const { creator, gold, measured } = payload
    const intel = creatorIntel(creator, measured, gold?.posts ?? [])

    // Audience quality — newest analysis row, as kolGold picks it.
    const { rows: q } = await db.query(
      `SELECT q.follower_quality_score f, q.authenticity_score a, q.audience_quality_score aq
         FROM (SELECT social_account_id, follower_quality_score, authenticity_score, audience_quality_score, updated_at
                 FROM feature.ig_audience_analysis
               UNION ALL
               SELECT social_account_id, follower_quality_score, authenticity_score, audience_quality_score, updated_at
                 FROM feature.tt_audience_analysis) q
         JOIN public.kol_social_account k ON k.social_account_id = q.social_account_id
        WHERE k.kol_id = $1 ORDER BY q.updated_at DESC NULLS LAST LIMIT 1`, [id])
    const aq = gold?.audienceQuality ?? null
    ok('Authenticity = feature DB', close(aq?.authenticity, n(q[0]?.a)),
      `ui=${aq?.authenticity ?? '—'} db=${q[0]?.a ?? '—'}`)
    ok('Follower quality = feature DB', close(aq?.followerQuality, n(q[0]?.f)),
      `ui=${aq?.followerQuality ?? '—'} db=${q[0]?.f ?? '—'}`)

    // The API row's L2 figures — what the header KPIs and the Content tab show.
    const { rows: l2 } = await db.query(
      `SELECT c.platform, c.audience_quality_score aq, c.audience_quality_tier tier,
              c.content_topic topic, c.content_topic_source topic_src,
              c.avg_views, c.views_analyzed_count, c.post_frequency_monthly pfm,
              c.followers_growth
         FROM public.kol_social_account k
         JOIN l2_gold.kol_profile_card c ON c.social_account_id = k.social_account_id
        WHERE k.kol_id = $1`, [id])
    const card = l2.find(r => r.platform === creator.platform) ?? l2[0]
    ok('Audience Quality = L2 profile card', close(creator.audienceQualityScore, n(card?.aq)),
      `ui=${creator.audienceQualityScore ?? '—'} (${creator.audienceQualityTier ?? '—'}) l2=${card?.aq ?? '—'}` +
      ` · feature composite=${q[0]?.aq ?? '—'}`)
    ok('Content Topic = L2 profile card', creator.contentTopic === (card?.topic ?? null),
      `ui=${creator.contentTopic ?? '—'} [${creator.contentTopicSource ?? '—'}] l2=${card?.topic ?? '—'}`)
    ok('Avg Views = L2 avg_views (over posts with views)', close(intel.kpi.avgViews, n(card?.avg_views)),
      `ui=${intel.kpi.avgViews ?? '—'} l2=${card?.avg_views ?? '—'} over ${card?.views_analyzed_count ?? '—'} post`)
    ok('Post frequency = L2 post_frequency_monthly', close(creator.postFrequencyMonthly, n(card?.pfm)),
      `ui=${creator.postFrequencyMonthly ?? '—'} l2=${card?.pfm ?? '—'}`)
    ok('Growth = L2 followers_growth', close(creator.growthPct, n(card?.followers_growth)),
      `ui=${creator.growthPct ?? '—'} l2=${card?.followers_growth ?? '—'}`)

    // Gender — share of the classified audience, newest day per account.
    const { rows: g } = await db.query<{ key: string; n: string }>(
      `SELECT a.dimension_key AS key, SUM(a.audience_count) AS n
         FROM public.kol_social_account k
         JOIN l2_gold.audience_demographics_daily a ON a.social_account_id = k.social_account_id
        WHERE k.kol_id = $1 AND a.audience_type = 'gender'
          AND a.audience_date = (SELECT MAX(x.audience_date) FROM l2_gold.audience_demographics_daily x
                                  WHERE x.social_account_id = a.social_account_id AND x.audience_type = 'gender')
        GROUP BY 1`, [id])
    const known = g.filter(r => r.key.toLowerCase() !== 'unknown')
    const knownTotal = known.reduce((s, r) => s + Number(r.n), 0)
    for (const r of known) {
      const dbPct = Math.round((Number(r.n) / knownTotal) * 1000) / 10
      const uiPct = gold?.audience?.gender.find(s => s.label === r.key)?.pct ?? null
      ok(`gender ${r.key} = DB`, close(uiPct, dbPct, 0.05), `ui=${uiPct ?? '—'}% db=${dbPct}%`)
    }
    if (!known.length) ok('gender empty in DB → empty in UI', !(gold?.audience?.gender.length))

    // Interests — the top classified key must be what the UI leads with.
    const { rows: it } = await db.query<{ key: string }>(
      `SELECT i.interest_key AS key
         FROM public.kol_social_account k
         JOIN l2_gold.audience_interest_daily i ON i.social_account_id = k.social_account_id
        WHERE k.kol_id = $1 AND lower(i.interest_key) <> 'unknown'
          AND i.audience_date = (SELECT MAX(x.audience_date) FROM l2_gold.audience_interest_daily x
                                  WHERE x.social_account_id = i.social_account_id)
        GROUP BY 1 ORDER BY SUM(i.audience_count) DESC, 1 LIMIT 1`, [id])
    const uiTop = gold?.audience?.interests[0]?.label ?? null
    ok('top interest = DB', uiTop === (it[0]?.key ?? null), `ui=${uiTop ?? '—'} db=${it[0]?.key ?? '—'}`)

    // ER per format, paired numerator/denominator (the API's engagementForEr).
    const { rows: fe } = await db.query<{ media_type: string; paired: string | null; naive: string | null }>(
      `SELECT f.media_type,
              SUM(f.engagement_sum) FILTER (WHERE f.followers_denom_sum > 0 AND f.engagement_sum IS NOT NULL)::numeric
                / NULLIF(SUM(f.followers_denom_sum) FILTER (WHERE f.followers_denom_sum > 0 AND f.engagement_sum IS NOT NULL), 0) AS paired,
              SUM(f.engagement_sum)::numeric / NULLIF(SUM(f.followers_denom_sum), 0) AS naive
         FROM public.kol_social_account k
         JOIN l2_gold.content_format_daily f ON f.social_account_id = k.social_account_id
        WHERE k.kol_id = $1 GROUP BY 1`, [id])
    const uiFormats = formatErRows(gold?.formats ?? [])
    for (const r of fe) {
      const ui = uiFormats.find(x => x.mediaType === r.media_type)?.er ?? null
      const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(2)}%`)
      ok(`ER ${r.media_type} = paired DB`, close(ui, n(r.paired), 1e-9),
        `ui=${pct(ui)} db=${pct(n(r.paired))} (unpaired would be ${pct(n(r.naive))})`)
    }

    // Per-post ER in the content grid = post_metric.er_followers.
    const { rows: pm } = await db.query<{ content_id: string; er: string | null }>(
      `SELECT p.content_id, p.er_followers AS er
         FROM public.kol_social_account k
         JOIN l2_gold.post_metric p ON p.social_account_id = k.social_account_id
        WHERE k.kol_id = $1`, [id])
    const erBy = new Map(pm.map(r => [r.content_id, n(r.er)]))
    const recent = measured?.recent ?? []
    let matched = 0
    recent.forEach((p, i) => {
      const item = intel.content.recent[i]
      const expect = p.contentId && erBy.has(p.contentId) ? erBy.get(p.contentId)! : null
      if (expect !== null) matched++
      const expectPct = expect === null ? null : Math.round(expect * 10_000) / 100
      if (item.erPct !== expectPct) ok(`post ${p.contentId} ER = post_metric`, false, `ui=${item.erPct} db=${expectPct}`)
    })
    ok('grid ER = post_metric.er_followers', true, `${recent.length} post, ${matched} with pipeline ER`)

    // Hidden-like sentinel never reaches the UI.
    ok('no negative likes in grid', intel.content.recent.every(c => c.likes === null || c.likes >= 0))
    const { rows: lk } = await db.query<{ s: string | null }>(
      `SELECT SUM(p.likes) FILTER (WHERE p.likes >= 0) s
         FROM public.kol_social_account k JOIN l1_silver.unified_post p ON p.social_account_id = k.social_account_id
        WHERE k.kol_id = $1`, [id])
    ok('total likes excludes -1 sentinel', close(intel.performance.likes, n(lk[0]?.s)),
      `ui=${intel.performance.likes ?? '—'} db=${lk[0]?.s ?? '—'}`)

    // Profile card figures.
    const { rows: pc } = await db.query(
      `SELECT c.platform, c.followers_count, c.following_count, c.media_count, c.followers_growth
         FROM public.kol_social_account k JOIN l2_gold.kol_profile_card c ON c.social_account_id = k.social_account_id
        WHERE k.kol_id = $1`, [id])
    for (const r of pc) {
      const card = gold?.cards.find(c => c.platform === r.platform)
      ok(`card ${r.platform} followers/following/posts/growth = DB`,
        !!card && close(card.followers, n(r.followers_count)) && close(card.following, n(r.following_count))
          && close(card.mediaCount, n(r.media_count)) && close(card.followersGrowth, n(r.followers_growth)),
        `followers=${card?.followers} following=${card?.following} posts=${card?.mediaCount} growth=${card?.followersGrowth}`)
    }

    // Columns with no source stay empty.
    ok('reach / impressions stay null', intel.performance.reach === null && intel.performance.impressions === null
      && intel.kpi.avgReach === null)
    ok('age stays empty (no age rows exist)', (gold?.audience?.age.length ?? 0) === 0
      || (await db.query(`SELECT 1 FROM l2_gold.audience_demographics_daily WHERE audience_type='age' LIMIT 1`)).rowCount! > 0)
  }
  await db.end()
}

;(async () => {
  if (!offline) await live()
  else console.log('\nlive: skipped (--offline)')
  console.log(bad ? `\n${bad} check(s) FAILED` : '\nall checks passed')
  process.exit(bad ? 1 : 0)
})().catch(e => {
  console.error('\nERR', e instanceof Error ? e.message : e)
  console.error('The live checks need the office VPN (PG_HOST_KOL). Use --offline to skip them.')
  process.exit(1)
})
