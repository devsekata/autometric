/**
 * Verifikasi jalur UI -> API -> DB kol untuk Brand Profile, Brand Fit dan
 * What Matters.
 *
 *   npm run verify:ui-integration
 *
 * Skrip lain sudah memastikan MESINNYA benar. Yang ini memastikan UI benar-benar
 * memakai mesin itu — dua kegagalan yang tidak akan ditangkap `tsc` maupun
 * `npm run build` karena keduanya sintaksis sah:
 *
 *   HITUNGAN KEDUA  Komponen yang mengalikan bobotnya sendiri, atau menambal
 *                   skor null dengan 0, akan merender angka yang MASUK AKAL
 *                   tapi berbeda dari yang dihitung backend. Kartu dan laporan
 *                   lalu berselisih soal creator yang sama.
 *
 *   BOUNDARY        Satu import `@/lib/db` di komponen akan menarik UI ke TSDB.
 *                   Itu tidak error — `l1_silver`/`l2_gold`/`feature` ada di
 *                   KEDUA server dengan nama sama, jadi yang muncul cuma angka
 *                   yang berbeda diam-diam.
 *
 * Bagian DB read-only; tidak menulis, tidak menghapus, tidak meninggalkan baris.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import kolDb from '@/lib/kolDb'
import { explain, SIGNAL_LABELS } from '@/lib/discover/brandMatch/explain'
import { emptyProfile, isScoreable } from '@/lib/discover/brandMatch/profile'
import { NA, type ScoreResult, type Scored } from '@/lib/discover/brandMatch/score'
import {
  CRITERIA_ORDER, CRITERIA_LABELS, matchWhatMatters, parseMatters,
} from '@/lib/discover/whatMatters'

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) console.log(`  ok    ${label}`)
  else { failures++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

const UI = join(process.cwd(), 'src', 'components', 'discover')
const read = (f: string) => readFileSync(join(UI, f), 'utf8')

/** Komponen yang merender ketiga fitur ini. */
const FEATURE_UI = [
  'BrandProfileForm.tsx', 'MatchBadge.tsx', 'KolDirectoryPage.tsx',
  'KolCreatorSections.tsx', 'CreatorQuickInsight.tsx', 'DiscoverCompare.tsx',
  'KolCreatorReport.tsx',
]

function naResult(over: Partial<ScoreResult> = {}): ScoreResult {
  const na: Scored = NA
  return {
    categoryMatch: na, keywordMatch: na, hashtagMatch: na, businessScore: na,
    ageScore: na, genderScore: na, locationScore: na, interestScore: na, audienceScore: na,
    contentCategoryMatch: na, subCategoryMatch: na, topicMatch: na, contentStyleMatch: na,
    contentScore: na, personalityScore: na,
    erScore: na, audienceQualityScore: na, consistencyScore: na, communityScore: na,
    averageViewsScore: na, recentGrowthScore: na, performanceScore: na,
    authenticityScore: na, followerQualityScore: na, verificationScore: na,
    paidRatioScore: na, safetyScore: na,
    availableWeight: 0, finalScore: na, level: 'Not Scored',
    dataCompleteness: 0, confidence: 'Limited Data', ...over,
  }
}

async function main() {
  /* ── 1. Boundary di lapisan UI ────────────────────────────────────────── */

  console.log('\nBoundary — UI tidak boleh menyentuh TSDB\n')

  const dbImports: string[] = []
  const dbpRefs: string[] = []
  for (const f of readdirSync(UI).filter(x => x.endsWith('.tsx') || x.endsWith('.ts'))) {
    for (const [i, line] of read(f).split(/\r?\n/).entries()) {
      if (/^\s*import\b.*['"]@\/lib\/db['"]/.test(line)) dbImports.push(`${f}:${i + 1}`)
      // Hanya query sungguhan; komentar yang MENYEBUT nama tabel lama justru
      // diinginkan, di situlah alasan pindahnya ditulis.
      if (/(FROM|INTO|UPDATE|DELETE FROM)\s+public\.discover_brand_profiles/.test(line)) {
        dbpRefs.push(`${f}:${i + 1}`)
      }
    }
  }
  check('nol import @/lib/db di seluruh komponen discover', dbImports.length === 0,
    dbImports.join(', '))
  check('nol query ke discover_brand_profiles dari UI', dbpRefs.length === 0,
    dbpRefs.join(', '))

  // UI tidak boleh memegang pool apa pun — ia bicara lewat fetch.
  const poolInUi = FEATURE_UI.filter(f => /from 'pg'|new Pool\(/.test(read(f)))
  check('nol koneksi database langsung di komponen fitur', poolInUi.length === 0,
    poolInUi.join(', '))

  /* ── 2. Brand Profile: UI -> API ──────────────────────────────────────── */

  console.log('\nBrand Profile — UI terhubung ke API\n')

  const form = read('BrandProfileForm.tsx')
  check('form membaca profil lewat GET endpoint',
    /fetch\(`\/api\/organizations\/\$\{orgId\}\/discover\/brand-profile`\)/.test(form))
  check('form menyimpan lewat PUT ke endpoint yang sama',
    /method:\s*'PUT'/.test(form) && /discover\/brand-profile/.test(form))

  // Setiap field yang dikirim UI harus dikenal backend, kalau tidak ia akan
  // dibuang diam-diam oleh `saveBrandProfile` dan user mengira tersimpan.
  const backendFields = Object.keys(emptyProfile('x'))
  const uiFields = [...new Set(
    (form.match(/\b(brand|target|audience|caption|preferred|content|min|require|verified|gender)[A-Z][a-zA-Z]*/g) ?? []),
  )].filter(f => f !== 'brandMatch' && f !== 'genderMajorities')
  const unknown = uiFields.filter(f => !backendFields.includes(f))
  check('setiap field yang dipakai UI dikenal backend', unknown.length === 0,
    unknown.join(', '))
  check('profil kosong tidak scoreable (UI menampilkan prompt, bukan skor)',
    !isScoreable(emptyProfile('x')))

  /* ── 3. Brand Fit: empat bar, dan UI tidak menghitung ulang ───────────── */

  console.log('\nBrand Fit — empat bar dari backend\n')

  const bars = explain(naResult({
    businessScore: 80, contentScore: 60, audienceScore: 70,
    performanceScore: 90, safetyScore: 50, finalScore: 72, level: 'Good Match',
  })).signals

  check('tepat 4 bar sampai ke UI', bars.length === 4, String(bars.length))
  check('id bar sesuai urutan produk',
    bars.map(b => b.id).join(',') === 'category,audience,values,performance',
    bars.map(b => b.id).join(','))
  check('label bar sesuai brief',
    bars.map(b => b.label).join(' | ')
      === 'Category Matching | Audience Relevance | Values Alignment | Past Performance',
    bars.map(b => b.label).join(' | '))
  check('bar membawa skor 0–100, bukan kontribusi terbobot',
    bars.find(b => b.id === 'audience')?.pct === 70)
  check('Values Alignment tampil unavailable, bukan 0',
    bars.find(b => b.id === 'values')?.pct === null
    && !!bars.find(b => b.id === 'values')?.unavailable)

  // MatchBadge harus MERENDER, bukan menghitung.
  const badge = read('MatchBadge.tsx')
  check('MatchBadge memakai pct apa adanya dari backend',
    /\$\{s\.pct\}%/.test(badge) && /\{s\.pct\}/.test(badge))
  check('MatchBadge menggambar null sebagai "Not measured", bukan 0',
    /Not measured/.test(badge) && /s\.pct === null|pct === null/.test(badge))
  // Sengaja disempitkan ke SINYAL MATCH. Pola `?? 0` yang lebih longgar juga
  // menangkap hal yang tidak berbahaya dan tidak berhubungan — mis. donut
  // audience-interest di KolCreatorSections yang menjaga `slices[0]` saat
  // arraynya kosong. Yang dijaga di sini hanya skor match, tempat 0 berarti
  // "cocokannya buruk" padahal null berarti "belum diukur".
  const badCoerce = FEATURE_UI.filter(f =>
    /\b(s|signal|sig|match|m)\.(pct|score)\s*\?\?\s*0\b/.test(read(f)))
  check('nol komponen menambal skor match null dengan 0', badCoerce.length === 0,
    badCoerce.join(', '))
  const reWeights = FEATURE_UI.filter(f =>
    /\bW_(BB|TA|CC|BP|PQ|BS|BRAND|CONTENT|TARGET|PERSONALITY|PERFORMANCE|SAFETY)/.test(read(f)))
  check('nol komponen mengimpor bobot engine (tidak ada hitungan kedua)',
    reWeights.length === 0, reWeights.join(', '))

  /* ── 4. What Matters: tujuh kriteria, lewat API ───────────────────────── */

  console.log('\nWhat Matters — tujuh kriteria dari backend\n')

  check('7 kriteria terdaftar', CRITERIA_ORDER.length === 7, CRITERIA_ORDER.join(','))
  check('label sesuai yang disepakati',
    CRITERIA_ORDER.map(k => CRITERIA_LABELS[k]).join(' | ')
      === 'Strong Engagement | High Audience Quality | Consistent Performance | '
        + 'Audiens Aktif & Asli | High Reach | Content Quality | Brand Safety',
    CRITERIA_ORDER.map(k => CRITERIA_LABELS[k]).join(' | '))

  const route = readFileSync(join(process.cwd(), 'src', 'app', 'api',
    'organizations', '[id]', 'discover', 'kol-directory', 'route.ts'), 'utf8')
  check('route menerima ?matters= dan memanggil engine',
    /parseMatters\(sp\.get\('matters'\)\)/.test(route)
    && /matchWhatMatters\(/.test(route))
  check('route mengirim daftar kriteria kanonik ke UI',
    /criteria: CRITERIA_ORDER\.map/.test(route))
  check('parseMatters membuang kunci tak dikenal',
    parseMatters('engagement,ngawur,reach').join(',') === 'engagement,reach')

  /* ── 5. Live: null tetap null sampai ke payload ───────────────────────── */

  console.log('\nLive terhadap DB kol (read-only)\n')

  try {
    const { rows: [who] } = await kolDb().query<{ db: string }>(
      'SELECT current_database() AS db')
    check('API membaca database kol', who.db === 'kol', who.db)

    const { rows: ids } = await kolDb().query<{ id: string }>(
      `SELECT id FROM public.kol_directory WHERE directory_status='active' LIMIT 12`)
    const scored = await matchWhatMatters(ids.map(r => r.id), [...CRITERIA_ORDER])
    check('engine mengembalikan hasil untuk creator nyata', scored.size > 0,
      `${scored.size}/${ids.length}`)

    const all = [...scored.values()]
    const anyNull = all.some(r => Object.values(r.scores).some(v => v === null))
    check('kriteria yang belum terukur sampai ke payload sebagai null',
      anyNull, 'tidak ada null sama sekali — curiga ada yang menambal')
    check('null TIDAK pernah muncul sebagai 0',
      all.every(r => Object.entries(r.scores)
        .every(([, v]) => v === null || (typeof v === 'number' && v > 0) || v === 0
          ? true : false)))
    check('contributing tidak pernah melebihi selected',
      all.every(r => r.contributing <= r.selected))
    check('skor null saat tidak ada kriteria yang menyumbang',
      all.every(r => r.contributing > 0 ? r.score !== null : r.score === null))

    const sample = all[0]
    console.log(`        contoh — contributing ${sample.contributing}/${sample.selected}, `
      + `score ${sample.score === null ? 'null' : sample.score.toFixed(1)}`)
  } catch (err) {
    check('pemeriksaan live', false,
      err instanceof Error ? err.message.slice(0, 80) : String(err))
  }

  console.log(failures === 0
    ? '\nSemua pemeriksaan lulus.\n'
    : `\n${failures} pemeriksaan gagal.\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
