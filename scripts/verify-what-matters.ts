/**
 * Verifikasi perilaku What Matters yang tidak ditangkap port verifier.
 *
 *   npm run verify:what-matters
 *
 * `whatmatters:port:verify` sudah memastikan enam kriteria mereproduksi Python.
 * Yang TIDAK bisa dijamin olehnya ada dua:
 *
 *   Content Quality   Python selalu mengembalikan None di sini, jadi tidak ada
 *                     yang bisa dibandingkan. Seluruh formula + dua rubriknya
 *                     hanya hidup di TypeScript, dan hanya file ini yang
 *                     menjaganya.
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
  percentileScore, whatMattersScore,
} from '@/lib/discover/whatMatters/score'
import {
  CRITERIA_ORDER, CRITERIA_LABELS, FORMAT_RUBRIC, TOPIC_SOURCE_RUBRIC,
  W_CQ_ENGAGEMENT, W_CQ_FORMAT, W_CQ_TOPIC, type CriterionKey,
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

  console.log('\nContent Quality — Engagement 40 + Format 30 + Topic 30\n')

  check('bobot berjumlah 100',
    W_CQ_ENGAGEMENT + W_CQ_FORMAT + W_CQ_TOPIC === 100)
  check('engagement TIDAK melebihi bobot 40', W_CQ_ENGAGEMENT === 40)

  // Semua tersedia: (50x40 + 100x30 + 100x30) / 100 = 80
  const all = contentQualityScore(3, POP, 'Video', 'beauty', 'content')
  check('semua data tersedia → 80', near(all, 80), String(all))

  // format NULL: bobot 30 dilepas, sisanya dinormalisasi ke 70.
  const noFmt = contentQualityScore(3, POP, null, 'beauty', 'content')
  check('format NULL → renormalisasi ke 5000/70, bukan 80 dan bukan 56',
    near(noFmt, 5000 / 70), String(noFmt))

  const noTopic = contentQualityScore(3, POP, 'Video', null, null)
  check('topic NULL → renormalisasi ke 5000/70',
    near(noTopic, 5000 / 70), String(noTopic))

  const noEr = contentQualityScore(null, POP, 'Video', 'beauty', 'content')
  check('engagement NULL → (100x30 + 100x30)/60 = 100', near(noEr, 100), String(noEr))

  check('semua NULL → null, bukan 0',
    contentQualityScore(null, POP, null, null, null) === null)

  // Rubrik harus benar-benar dipakai, dan case-insensitive.
  const lower = contentQualityScore(null, POP, 'video', 'beauty', 'content')
  const upper = contentQualityScore(null, POP, 'VIDEO', 'beauty', 'content')
  check('format cocok tanpa peduli besar-kecil huruf',
    near(lower, 100) && near(upper, 100))
  check('format tak dikenal → null, bukan 0 (bobotnya dilepas)',
    near(contentQualityScore(null, POP, 'Reel Panjang', 'beauty', 'content'), 100))
  check('rubrik format persis 3 nilai nyata di kolomnya',
    Object.keys(FORMAT_RUBRIC).sort().join(',') === 'carousel,image,video',
    Object.keys(FORMAT_RUBRIC).join(','))
  check('Video > Carousel > Image',
    FORMAT_RUBRIC.video > FORMAT_RUBRIC.carousel
    && FORMAT_RUBRIC.carousel > FORMAT_RUBRIC.image)

  // Sumbu topic menilai KEKUATAN BUKTI, bukan meranking subjeknya.
  const fromContent = contentQualityScore(null, POP, null, 'religion', 'content')
  const fromFallback = contentQualityScore(null, POP, null, 'religion', 'creator_category_fallback')
  check('topic dari caption (100) > topic dari fallback (50)',
    near(fromContent, 100) && near(fromFallback, 50),
    `${fromContent} vs ${fromFallback}`)
  check('topic yang BERBEDA dengan sumber sama mendapat skor SAMA — tidak ada ranking subjek',
    contentQualityScore(null, POP, null, 'religion', 'content')
      === contentQualityScore(null, POP, null, 'food', 'content'))
  check('topic NULL tapi source ada → tetap null (source tanpa topic tidak berarti)',
    contentQualityScore(null, POP, null, null, 'content') === null)
  check('rubrik topic hanya dua sumber yang benar-benar ada di kolomnya',
    Object.keys(TOPIC_SOURCE_RUBRIC).sort().join(',') === 'content,creator_category_fallback',
    Object.keys(TOPIC_SOURCE_RUBRIC).join(','))

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
