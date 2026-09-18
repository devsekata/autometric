/**
 * Verifikasi perilaku What Matters yang tidak ditangkap port verifier.
 *
 *   npm run verify:what-matters
 *
 * `whatmatters:port:verify` sudah memastikan enam kriteria mereproduksi Python.
 * Yang TIDAK bisa dijamin olehnya ada dua:
 *
 *   Content Quality   Paritas angkanya dengan Python sudah dijaga port
 *                     verifier (sejak scrapper 5cf0578). File ini menjaga
 *                     PERILAKU-nya: kasus normal, tiap komponen NULL, semua
 *                     NULL, renormalisasi bobot, dan aturan sampel post.
 *
 *   Nullable          Cabang null adalah tempat model ini paling mudah rusak
 *                     dengan cara yang MENGHASILKAN ANGKA alih-alih error:
 *                     satu `?? 0` akan membuat kreator yang belum diukur
 *                     terbaca sebagai kreator yang buruk, dan tidak ada
 *                     typecheck maupun build yang akan menyentuhnya.
 *
 * Bagian terakhir memeriksa boundary database di level source.
 * Murni in-memory kecuali itu; tidak menyentuh database, tidak menulis apa pun.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  brandSafetyScore, communityStrengthScore, contentQualityScore,
  percentileScore, stabilityLabel, summarisePostQuality, whatMattersScore,
  type PostQualityInput,
} from '@/lib/discover/whatMatters/score'
import {
  CRITERIA_ORDER, CRITERIA_LABELS,
  W_CQ_CONSISTENCY, W_CQ_ENGAGEMENT, W_CQ_VIEWS, type CriterionKey,
} from '@/lib/discover/whatMatters/model'
import { parseMatters, rankByWhatMatters } from '@/lib/discover/whatMatters'

let failures = 0

function check(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok    ${label}`)
  else { failures++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

const near = (a: number | null, b: number) =>
  a !== null && Math.abs(a - b) < 1e-6

/** Lima nilai terukur; percentile(3) = 2 yang lebih kecil / 4 = 50. */
const POP = [1, 2, 3, 4, 5]

function main() {
  console.log('\nPrasyarat\n')
  check('percentile(3, [1..5]) = 50', near(percentileScore(3, POP), 50),
    String(percentileScore(3, POP)))

  /* ── Content Quality ──────────────────────────────────────────────────── */

  console.log('\nContent Quality — Engagement 50 + Views 30 + Consistency 20\n')

  check('bobot 50 / 30 / 20',
    W_CQ_ENGAGEMENT === 50 && W_CQ_VIEWS === 30 && W_CQ_CONSISTENCY === 20)

  // Populasi kecil yang bisa dihitung tangan: percentile = lebih kecil / (n-1).
  const POP_ER_CQ = [0.5, 1.0, 2.0, 4.0]
  const POP_V_CQ = [1000, 5000, 20000, 80000]
  const post = (
    eng: number | null, foll: number | null, er: number | null, views: number | null,
    hidden = false, kolab = false,
  ): PostQualityInput => ({
    engagement_owned: eng, followers_at_post_date: foll, er_followers: er,
    views, likes_hidden: hidden, is_collaboration: kolab,
  })
  const cq = (posts: PostQualityInput[]) => {
    const s = summarisePostQuality(posts)
    return contentQualityScore(s.erPct, POP_ER_CQ, s.medianViews, POP_V_CQ, s.erSdPp, s.erPosts)
  }
  // ER 2,0 / 2,1 / 1,9 / 2,0 % -> SD 0,08 pp -> High. ER aditif 80/4000 = 2,0%
  // -> percentile 66,6667. Median views 5.350 -> 66,6667.
  const STABLE = [post(20, 1000, 0.020, 5000), post(21, 1000, 0.021, 6000),
    post(19, 1000, 0.019, 5500), post(20, 1000, 0.020, 5200)]

  check('data normal → 0,5 x 66,6667 + 0,3 x 66,6667 + 0,2 x 100',
    near(cq(STABLE), 0.5 * 66.6667 + 0.3 * 66.6667 + 0.2 * 100), String(cq(STABLE)))

  const noViews = STABLE.map(p => ({ ...p, views: null }))
  check('views NULL → dikeluarkan dari penyebut (dibagi 0,7), bukan views = 0',
    near(cq(noViews), (0.5 * 66.6667 + 0.2 * 100) / 0.7), String(cq(noViews)))
  check('views NULL tidak menurunkan skor seolah nol',
    (cq(noViews) ?? 0) > 0.5 * 66.6667 + 0.2 * 100)

  // Tanpa ER per post, engagement DAN consistency tidak terukur.
  const noEr = [post(null, null, null, 5000), post(null, null, null, 6000),
    post(null, null, null, 5500)]
  check('engagement NULL → tinggal views (66,6667)', near(cq(noEr), 66.6667), String(cq(noEr)))

  const onePost = [post(20, 1000, 0.020, 5000)]
  check('consistency NULL (1 post, minimum 3) → (0,5 x 66,6667 + 0,3 x 33,3333) / 0,8',
    near(cq(onePost), (0.5 * 66.6667 + 0.3 * 33.3333) / 0.8), String(cq(onePost)))
  check('consistency NULL dengan 2 post ber-ER (di bawah minimum), bukan "stabil"',
    stabilityLabel(summarisePostQuality(STABLE.slice(0, 2)).erSdPp, 2) === null)

  check('semua komponen NULL → null, bukan 0',
    contentQualityScore(null, POP_ER_CQ, null, POP_V_CQ, null, 0) === null)
  check('kreator tanpa post → null', cq([]) === null)
  const empty = summarisePostQuality([])
  check('ringkasan tanpa post: semua null, 0 post ber-ER',
    empty.erPct === null && empty.medianViews === null && empty.erSdPp === null
    && empty.erPosts === 0)

  check('performa stabil → consistency 100',
    contentQualityScore(null, POP_ER_CQ, null, POP_V_CQ,
      summarisePostQuality(STABLE).erSdPp, 4) === 100)
  const unstable = [post(5, 1000, 0.005, 5000), post(80, 1000, 0.080, 6000),
    post(10, 1000, 0.010, 5500), post(120, 1000, 0.120, 5200)]
  const u = summarisePostQuality(unstable)
  check('performa sangat tidak stabil → SD > 3 pp → consistency 0',
    (u.erSdPp ?? 0) > 3
    && contentQualityScore(null, POP_ER_CQ, null, POP_V_CQ, u.erSdPp, u.erPosts) === 0)
  check('ketidakstabilan menurunkan skor dibanding tanpa komponen consistency',
    (cq(unstable) ?? 100) < (0.5 * 100 + 0.3 * 66.6667) / 0.8, String(cq(unstable)))

  check('ambang stability = metrics_thresholds (<=1 High, <=3 Medium, sisanya Low)',
    stabilityLabel(1.0, 3) === 'High Stability'
    && stabilityLabel(1.0001, 3) === 'Medium Stability'
    && stabilityLabel(3.0, 3) === 'Medium Stability'
    && stabilityLabel(3.01, 3) === 'Low Stability'
    && stabilityLabel(null, 5) === null)

  check('aturan sampel views: likes_hidden, kolaborasi dan views 0 tidak ikut',
    summarisePostQuality([post(null, null, null, 5000),
      post(null, null, null, 999_999, true), post(null, null, null, 999_999, false, true),
      post(null, null, null, 0)]).medianViews === 5000)

  /* ── Brand Safety ─────────────────────────────────────────────────────── */

  console.log('\nBrand Safety — Auth 40 + FQ 30 + Verified 15 + Paid 15\n')

  // auth 80, fq 60, verified true (100), paid 20 -> 50
  // (80x40 + 60x30 + 100x15 + 50x15) / 100 = 72,5
  check('semua komponen tersedia → 72,5',
    near(brandSafetyScore(80, 60, true, 20), 72.5),
    String(brandSafetyScore(80, 60, true, 20)))
  check('unverified = 50, bukan 0 (pertanyaan belum terjawab, bukan bukti bahaya)',
    near(brandSafetyScore(null, null, false, null), 50))
  check('verified null → dilepas dari bobot, bukan jadi 0',
    near(brandSafetyScore(80, null, null, null), 80))
  check('sebagian NULL → hanya yang ada yang dihitung',
    near(brandSafetyScore(80, 60, null, null), (80 * 40 + 60 * 30) / 70),
    String(brandSafetyScore(80, 60, null, null)))
  check('semua NULL → null, bukan 0',
    brandSafetyScore(null, null, null, null) === null)
  check('paid ratio tinggi menurunkan skor, tidak pernah negatif',
    near(brandSafetyScore(null, null, null, 80), 0))

  /* ── Community ────────────────────────────────────────────────────────── */

  console.log('\nAudiens Aktif & Asli — AQ 70% + ER percentile 30%\n')

  // aq 80, er percentile 50 -> 80x0,7 + 50x0,3 = 71
  check('AQ + ER tersedia → 71', near(communityStrengthScore(80, 3, POP), 71),
    String(communityStrengthScore(80, 3, POP)))
  check('hanya AQ → AQ apa adanya (80), bukan 80x0,7',
    near(communityStrengthScore(80, null, POP), 80),
    String(communityStrengthScore(80, null, POP)))
  check('hanya ER → percentile apa adanya (50), bukan 50x0,3',
    near(communityStrengthScore(null, 3, POP), 50),
    String(communityStrengthScore(null, 3, POP)))
  check('keduanya NULL → null, bukan 0',
    communityStrengthScore(null, null, POP) === null)
  check('label tidak mengklaim mengukur komunitas',
    CRITERIA_LABELS.community === 'Audiens Aktif & Asli',
    CRITERIA_LABELS.community)

  /* ── Agregat & ranking ────────────────────────────────────────────────── */

  console.log('\nAgregat dan ranking\n')

  const s = {
    engagement: 80, audience_quality: null, consistency: 40,
    community: null, reach: 10, content_quality: null, brand_safety: null,
  }
  check('kriteria terpilih yang NULL keluar dari PENYEBUT, bukan dihitung nol',
    near(whatMattersScore(s, ['engagement', 'audience_quality'] as CriterionKey[]), 80),
    String(whatMattersScore(s, ['engagement', 'audience_quality'] as CriterionKey[])))
  check('rata-rata atas yang punya nilai',
    near(whatMattersScore(s, ['engagement', 'consistency', 'reach'] as CriterionKey[]),
      (80 + 40 + 10) / 3))
  check('semua terpilih NULL → null',
    whatMattersScore(s, ['audience_quality', 'community'] as CriterionKey[]) === null)
  check('tidak ada yang dipilih → null', whatMattersScore(s, []) === null)

  check('7 kriteria terdaftar', CRITERIA_ORDER.length === 7, CRITERIA_ORDER.join(','))
  check('parseMatters membuang kunci tak dikenal tanpa menggagalkan request',
    parseMatters('engagement,tidak_ada,reach').join(',') === 'engagement,reach')
  check('parseMatters membuang duplikat',
    parseMatters('reach,reach').join(',') === 'reach')

  const rows = [{ id: 'a', v: 10 }, { id: 'b', v: null }, { id: 'c', v: 90 }]
  const of = (r: { v: number | null }) => r.v
  check('ranking: belum terukur di bawah pada KEDUA arah',
    rankByWhatMatters(rows, of, 'desc').map(r => r.id).join('') === 'cab'
    && rankByWhatMatters(rows, of, 'asc').map(r => r.id).join('') === 'acb')

  /* ── Boundary ─────────────────────────────────────────────────────────── */

  console.log('\nBoundary database\n')

  const dir = join(process.cwd(), 'src', 'lib', 'discover', 'whatMatters')
  const offenders: string[] = []
  for (const f of readdirSync(dir).filter(x => x.endsWith('.ts'))) {
    for (const [i, line] of readFileSync(join(dir, f), 'utf8').split(/\r?\n/).entries()) {
      if (/^\s*import\b.*['"]@\/lib\/db['"]/.test(line)) offenders.push(`${f}:${i + 1}`)
    }
  }
  check('tidak ada import @/lib/db di whatMatters/', offenders.length === 0,
    offenders.join(', '))
  check('whatMatters/records.ts memakai kolDb',
    /from '@\/lib\/kolDb'/.test(readFileSync(join(dir, 'records.ts'), 'utf8')))

  console.log(failures === 0
    ? '\nSemua pemeriksaan lulus.\n'
    : `\n${failures} pemeriksaan gagal.\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
