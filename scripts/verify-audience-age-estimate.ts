/**
 * Estimated audience Age — the fallback for creators with no usable measured age
 * and no curated label.
 *
 *   npx tsx scripts/verify-audience-age-estimate.ts                               offline (pure model)
 *   npx dotenv -e .env.local -- npx tsx scripts/verify-audience-age-estimate.ts --db   + every creator, READ-ONLY
 *
 * Offline: the model sums to 100, moves the right way for each signal, keeps
 * stated ages as evidence, and never invents a band nobody is in.
 *
 * `--db`: runs the production reader (`getKolGold`) for EVERY creator that has
 * an audience analysis row, Instagram and TikTok, and checks that real sources
 * are served unchanged and only the empty ones are estimated. SELECT-only: each
 * read below is a SELECT, and the before-state query runs in a READ ONLY
 * transaction. No Add KOL, no Apify.
 */
import assert from 'node:assert/strict'
import {
  ESTIMATE_AGE_BANDS, PRIOR_WEIGHT, estimateAudienceAge, type AgeEstimateSignals,
} from '../src/lib/discover/audienceAgeEstimate'

let n = 0
const check = (name: string, fn: () => void) => { fn(); n++; console.log(`ok  ${name}`) }

const sum = (slices: { pct: number }[]) => Math.round(slices.reduce((a, s) => a + s.pct, 0) * 10) / 10
const pct = (e: ReturnType<typeof estimateAudienceAge>, band: string) => e.slices.find(s => s.label === band)?.pct ?? 0
/** Share of the audience under 25: the single number "younger / older" is judged by. */
const young = (e: ReturnType<typeof estimateAudienceAge>) => pct(e, '13-17') + pct(e, '18-24')

const PLATFORMS = ['instagram', 'tiktok', null, 'youtube']
const CATEGORIES = [null, 'Beauty', 'Entertainment', 'Lifestyle', 'Food', 'Fashion', 'Fitness', 'Tech', 'Gen Z', 'Moms']
const INTERESTS = [null, 'business', 'beauty', 'entertainment', 'parenting', 'religion', 'food', 'education', 'music']
const CREATOR_AGES = [null, '18-24', '25-34', '45+']

check('every signal combination sums to exactly 100 and has no negative band', () => {
  for (const platform of PLATFORMS) for (const categoryKey of CATEGORIES)
    for (const interestTop of INTERESTS) for (const creatorAgeBand of CREATOR_AGES) {
      const e = estimateAudienceAge({ platform, categoryKey, interestTop, creatorAgeBand })
      assert.equal(sum(e.slices), 100)
      assert.ok(e.slices.every(s => s.pct > 0 && s.n === 0))
      assert.equal(e.observedKnown, 0)
    }
})

check('no evidence, no signal: Instagram is the documented base split', () => {
  const e = estimateAudienceAge({ platform: 'instagram' })
  assert.deepEqual(e.slices.map(s => [s.label, s.pct]),
    [['18-24', 32], ['25-34', 41], ['35-44', 19], ['45+', 8]])
  assert.deepEqual(e.basis, ['platform instagram'])
})

check('bands come out youngest first and only from the known set', () => {
  const e = estimateAudienceAge({ platform: 'tiktok', interestTop: 'parenting' }, { '13-17': 1, '45+': 2 })
  const order = e.slices.map(s => ESTIMATE_AGE_BANDS.indexOf(s.label as (typeof ESTIMATE_AGE_BANDS)[number]))
  assert.ok(order.every(i => i >= 0))
  assert.deepEqual(order, [...order].sort((a, b) => a - b))
})

check('13-17 never appears unless a follower stated an age in it', () => {
  for (const platform of PLATFORMS) for (const categoryKey of CATEGORIES)
    assert.equal(pct(estimateAudienceAge({ platform, categoryKey, interestTop: 'education' }), '13-17'), 0)
  assert.ok(pct(estimateAudienceAge({ platform: 'tiktok' }, { '13-17': 1 }), '13-17') > 0)
})

check('the estimate is not one fixed split: platform and signals move it', () => {
  const ig = estimateAudienceAge({ platform: 'instagram' })
  const tt = estimateAudienceAge({ platform: 'tiktok' })
  assert.ok(young(tt) > young(ig), 'TikTok skews younger than Instagram')
  const base = young(ig)
  assert.ok(young(estimateAudienceAge({ platform: 'instagram', categoryKey: 'Gen Z' })) > base)
  assert.ok(young(estimateAudienceAge({ platform: 'instagram', categoryKey: 'Entertainment' })) > base)
  assert.ok(young(estimateAudienceAge({ platform: 'instagram', categoryKey: 'Moms' })) < base)
  assert.ok(young(estimateAudienceAge({ platform: 'instagram', interestTop: 'parenting' })) < base)
  assert.ok(young(estimateAudienceAge({ platform: 'instagram', interestTop: 'business' })) < base)
  assert.ok(young(estimateAudienceAge({ platform: 'instagram', interestTop: 'education' })) > base)
  assert.ok(young(estimateAudienceAge({ platform: 'instagram', creatorAgeBand: '45+' })) < base)
  assert.ok(young(estimateAudienceAge({ platform: 'instagram', creatorAgeBand: '18-24' })) > base)
})

check('neutral or unknown signals change nothing and are not listed as a basis', () => {
  const base = estimateAudienceAge({ platform: 'instagram' })
  const same = estimateAudienceAge({ platform: 'Instagram ', categoryKey: 'Beauty', interestTop: 'food', creatorAgeBand: '25-34' })
  assert.deepEqual(same.slices, base.slices)
  assert.deepEqual(same.basis, ['platform instagram'])
})

check('signals are case-insensitive and each one used is named in the basis', () => {
  const e = estimateAudienceAge({ platform: 'TikTok', categoryKey: 'moms', interestTop: 'Parenting', creatorAgeBand: '45+' })
  assert.deepEqual(e.basis, ['platform tiktok', 'kategori moms', 'minat audiens Parenting', 'umur kreator 45+'])
})

check('stacked signals are capped, so no band is ever wiped out', () => {
  const old = estimateAudienceAge({ platform: 'instagram', categoryKey: 'Moms', interestTop: 'parenting', creatorAgeBand: '45+' })
  const yng = estimateAudienceAge({ platform: 'tiktok', categoryKey: 'Gen Z', interestTop: 'education', creatorAgeBand: '18-24' })
  for (const e of [old, yng]) {
    assert.equal(e.slices.length, 4)
    assert.ok(e.slices.every(s => s.pct >= 3), JSON.stringify(e.slices))
  }
})

check('an unknown platform falls back to a split and says so', () => {
  const e = estimateAudienceAge({ platform: 'youtube' })
  assert.equal(sum(e.slices), 100)
  assert.deepEqual(e.basis, ['platform tidak dikenal'])
})

check('partial evidence is kept: stated ages raise their band and carry their count', () => {
  const signals: AgeEstimateSignals = { platform: 'tiktok', interestTop: 'business' }
  const prior = estimateAudienceAge(signals)
  const withOne = estimateAudienceAge(signals, { '18-24': 1 })
  assert.equal(sum(withOne.slices), 100)
  assert.equal(withOne.observedKnown, 1)
  assert.equal(withOne.slices.find(s => s.label === '18-24')?.n, 1)
  assert.ok(pct(withOne, '18-24') > pct(prior, '18-24'))
  // (prior x PRIOR_WEIGHT + observed) / (PRIOR_WEIGHT + observed)
  const expected = ((pct(prior, '18-24') / 100) * PRIOR_WEIGHT + 1) / (PRIOR_WEIGHT + 1) * 100
  assert.ok(Math.abs(pct(withOne, '18-24') - expected) <= 0.1)
  assert.ok(withOne.basis.includes('1 follower yang menyebut umur'))
})

check('more evidence pulls further from the prior; the prior never outvotes it', () => {
  const s: AgeEstimateSignals = { platform: 'instagram' }
  const one = pct(estimateAudienceAge(s, { '35-44': 1 }), '35-44')
  const four = pct(estimateAudienceAge(s, { '35-44': 4 }), '35-44')
  assert.ok(four > one && one > pct(estimateAudienceAge(s), '35-44'))
})

check('`unknown`, junk keys and non-positive counts are not evidence', () => {
  const base = estimateAudienceAge({ platform: 'instagram' })
  const junk = estimateAudienceAge({ platform: 'instagram' },
    { unknown: 100, '18-24': 0, '25-34': -3, 'not-a-band': 9, '45+': Number.NaN })
  assert.deepEqual(junk.slices, base.slices)
  assert.equal(junk.observedKnown, 0)
})

check('deterministic: the same inputs always give the same split', () => {
  const a = estimateAudienceAge({ platform: 'tiktok', categoryKey: 'Food', interestTop: 'business' }, { '25-34': 2 })
  const b = estimateAudienceAge({ platform: 'tiktok', categoryKey: 'Food', interestTop: 'business' }, { '25-34': 2 })
  assert.deepEqual(a, b)
})

async function db() {
  const { default: kolDb } = await import('../src/lib/kolDb')
  const { getKolGold, withCuratedFallback } = await import('../src/lib/discover/kolGold')
  const { AUDIENCE_SERVED } = await import('../src/lib/discover/curatedAudience')

  check('the real-source rule is unchanged: measured, then curated, then nothing', () => {
    const m = [{ label: '25-34', pct: 100, n: 7 }]
    assert.deepEqual(withCuratedFallback(m, true, '18-24'), { slices: m, source: 'measured' })
    assert.deepEqual(withCuratedFallback(m, false, '18-24'),
      { slices: [{ label: '18-24', pct: 100, n: 0 }], source: 'curated' })
    assert.deepEqual(withCuratedFallback(m, false, null), { slices: [], source: null })
  })

  // BEFORE: what each creator had for Age under the real-source rule alone.
  const client = await kolDb().connect()
  let before: {
    kol_id: string; username: string; platform: string; directory_status: string
    age_measured: string | null; curated_age: string | null
  }[]
  try {
    await client.query('BEGIN READ ONLY')
    assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on')
    before = (await client.query(
      `SELECT kd.id AS kol_id, kd.username, s.platform, kd.directory_status, s.age_measured, s.curated_age
         FROM (${AUDIENCE_SERVED}) s
         JOIN public.kol_social_account ksa ON ksa.social_account_id = s.social_account_id
         JOIN public.kol_directory kd ON kd.id = ksa.kol_id
        ORDER BY s.platform, kd.username`)).rows
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
  }

  const tally = { measured: 0, curated: 0, estimated: 0, empty: 0 }
  const wasEmpty = before.filter(b => b.age_measured === null && !(b.curated_age ?? '').trim())
  const estimated: { username: string; platform: string; split: string; basis: string }[] = []
  const problems: string[] = []

  for (const b of before) {
    const gold = await getKolGold(b.kol_id)
    const a = gold?.audience
    const src = a?.source.age ?? null
    const tag = `${b.platform}/@${b.username}`
    if (!a || !a.age.length || src === null) { tally.empty++; problems.push(`${tag}: Age still empty`); continue }
    tally[src]++

    if (b.age_measured !== null) {
      if (src !== 'measured') problems.push(`${tag}: usable measured age served as ${src}`)
    } else if ((b.curated_age ?? '').trim()) {
      if (src !== 'curated' || a.age.length !== 1 || a.age[0].label !== b.curated_age!.trim() || a.ageEstimate !== null)
        problems.push(`${tag}: curated age ${b.curated_age} changed -> ${src} ${JSON.stringify(a.age)}`)
    } else {
      if (src !== 'estimated') problems.push(`${tag}: empty age served as ${src}`)
      if (sum(a.age) !== 100) problems.push(`${tag}: estimate sums to ${sum(a.age)}`)
      if (!a.ageEstimate?.basis.length) problems.push(`${tag}: estimate has no basis`)
      if (a.final.age !== null) problems.push(`${tag}: an estimate leaked into final.age`)
      if (a.coverage.age !== null) problems.push(`${tag}: an estimate reports a coverage share`)
      estimated.push({
        username: b.username, platform: b.platform,
        split: a.age.map(s => `${s.label} ${s.pct}%`).join(' · '),
        basis: a.ageEstimate?.basis.join(', ') ?? '',
      })
    }
    if (src !== 'estimated' && a.ageEstimate !== null) problems.push(`${tag}: ageEstimate set on a ${src} age`)
  }

  const byPlatform = (rows: { platform: string }[]) =>
    Object.entries(rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.platform]: (m[r.platform] ?? 0) + 1 }), {}))
      .map(([p, c]) => `${p} ${c}`).join(', ')

  console.log(`\ncreators with an audience analysis : ${before.length} (${byPlatform(before)})`)
  console.log(`Age empty BEFORE                   : ${wasEmpty.length} (${byPlatform(wasEmpty)})`)
  console.log(`Age shown AFTER                    : ${before.length - tally.empty}`)
  console.log(`  measured (real, usable)          : ${tally.measured}`)
  console.log(`  curated  (label, unchanged)      : ${tally.curated}`)
  console.log(`  estimated (model)                : ${tally.estimated}`)
  console.log(`  still empty                      : ${tally.empty}\n`)
  for (const e of estimated) console.log(`  ${e.platform.padEnd(9)} @${e.username.padEnd(24)} ${e.split}\n${' '.repeat(38)}basis: ${e.basis}`)
  console.log()

  check('every creator with an audience analysis now shows an Age', () => assert.equal(tally.empty, 0))
  check('exactly the creators that were empty are estimated — no more, no fewer', () =>
    assert.equal(tally.estimated, wasEmpty.length))
  check('measured and curated ages are served unchanged; estimates are labelled and sum to 100', () =>
    assert.deepEqual(problems, []))
  check('Instagram and TikTok are both covered', () =>
    assert.ok(new Set(before.map(b => b.platform)).size >= 2))

  await kolDb().end()
}

const done = () => console.log(`\n${n} checks passed`)
if (process.argv.includes('--db')) db().then(done).catch(e => { console.error(e); process.exit(1) })
else done()
