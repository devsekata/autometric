/**
 * Verifikasi jalur UI -> API -> DB kol untuk Brand Profile, Brand Match dan
 * What Matters.
 *
 *   npm run verify:ui-integration
 *
 * Skrip lain sudah memastikan MESINNYA benar. Yang ini memastikan UI benar-benar
 * memakai mesin itu — dua kegagalan yang tidak akan ditangkap `tsc` maupun
 * `npm run build` karena keduanya sintaksis sah:
 *
 *   HITUNGAN KEDUA  Komponen yang merata-rata sendiri, atau menambal skor null
 *                   dengan 0, akan merender angka yang MASUK AKAL tapi berbeda
 *                   dari yang dihitung backend. Kartu dan laporan lalu
 *                   berselisih soal creator yang sama.
 *
 *   BOUNDARY        Satu import `@/lib/db` di komponen akan menarik UI ke TSDB.
 *                   Itu tidak error — `l1_silver`/`l2_gold`/`feature` ada di
 *                   KEDUA server dengan nama sama, jadi yang muncul cuma angka
 *                   yang berbeda diam-diam.
 *
 * ── Ditulis ulang untuk SATU mesin Brand Match ────────────────────────────
 * Versi sebelumnya memeriksa scorer berbobot: empat bar `explain()`, konstanta
 * `W_*`, dan tujuh kriteria termasuk Brand Safety. Scorer itu sudah dihapus,
 * jadi pemeriksaannya tidak dipertahankan — ia diganti kontrak yang berlaku
 * sekarang: Match % adalah rata-rata kriteria yang DIPILIH Brand Profile, tanpa
 * bobot, tanpa band, dan kriteria yang belum terukur keluar dari pembagi.
 *
 * Bagian DB read-only; tidak menulis, tidak menghapus, tidak meninggalkan baris.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import kolDb from '@/lib/kolDb'
import { emptyProfile, isScoreable } from '@/lib/discover/brandMatch/profile'
import {
  WHAT_MATTERS_KEYS, brandMatchFromScores, cleanWhatMatters,
} from '@/lib/discover/whatMatters/brandMatch'
import { AUDIENCE_CRITERIA } from '@/lib/discover/whatMatters/audienceMatch'
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
  'KolCreatorReport.tsx', 'KolCreatorProfile.tsx', 'KolCreatorWorkspace.tsx',
]

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
    (form.match(/\bdraft\.([a-z][a-zA-Z]*)/g) ?? []).map(m => m.slice('draft.'.length)),
  )]
  const unknown = uiFields.filter(f => !backendFields.includes(f))
  check('setiap field yang dipakai UI dikenal backend', unknown.length === 0,
    unknown.join(', '))

  // Sembilan kolom yang dijatuhkan `migrations/kol/009` tidak boleh muncul lagi
  // sebagai input: field yang bisa diketik tapi tidak punya kolom adalah
  // preferensi yang user yakin tersimpan padahal tidak.
  const DROPPED = [
    'brandKeywords', 'brandHashtags', 'captionTerms', 'brandTone',
    'performanceTargets', 'minFollowers', 'minErPct', 'requireCategory', 'verifiedOnly',
  ]
  const revived = DROPPED.filter(f => backendFields.includes(f) || uiFields.includes(f))
  check('kolom yang dijatuhkan migrations/kol/009 tidak hidup lagi di form/tipe',
    revived.length === 0, revived.join(', '))

  check('profil kosong tidak scoreable (UI menampilkan prompt, bukan skor)',
    !isScoreable(emptyProfile('x')))
  check('profil yang memilih satu What Matters menjadi scoreable',
    isScoreable({ ...emptyProfile('x'), whatMatters: ['high_reach'] }))
  check('profil yang hanya mengisi Target Audience juga scoreable',
    isScoreable({ ...emptyProfile('x'), targetCity: 'Jakarta' }))
  // Brand category bukan lagi syarat: scorer yang membutuhkannya sudah hilang.
  check('brand category saja TIDAK menyalakan scoring',
    !isScoreable({ ...emptyProfile('x'), brandCategory: 'Beauty' }))

  /* ── 3. Brand Match: satu mesin, tanpa band, tanpa hitungan kedua ─────── */

  console.log('\nBrand Match — satu mesin, dirender apa adanya\n')

  const badge = read('MatchBadge.tsx')
  check('MatchBadge merender matchPct dari backend', /m\.matchPct/.test(badge))
  check('MatchBadge tidak merata-rata sendiri',
    !/\.reduce\(/.test(badge) && !/\/\s*m\.(selected|contributing)/.test(badge))
  check('matchPct null digambar sebagai "Match —", bukan 0', /'Match —'/.test(badge))
  check('rincian kriteria null digambar "belum terukur", bukan 0',
    /belum terukur/.test(badge) && /score === null/.test(badge))

  // Tidak ada band di mana pun: bukan cuma di badge, tapi di seluruh UI fitur.
  const BANDS = /\b(Excellent|Strong|Good|Moderate|Low)\s+Match\b|LEVEL_TONE|MatchLevel/
  const banded = FEATURE_UI.filter(f => BANDS.test(read(f)))
  check('nol komponen menampilkan band Excellent/Strong/Good/Moderate/Low',
    banded.length === 0, banded.join(', '))

  // Sengaja disempitkan ke SINYAL MATCH. Pola `?? 0` yang lebih longgar juga
  // menangkap hal yang tidak berbahaya dan tidak berhubungan — mis. donut
  // audience-interest di KolCreatorSections yang menjaga `slices[0]` saat
  // arraynya kosong. Yang dijaga di sini hanya skor match, tempat 0 berarti
  // "cocokannya buruk" padahal null berarti "belum diukur".
  const badCoerce = FEATURE_UI.filter(f =>
    /\b(s|signal|sig|match|m|b)\.(pct|score|matchPct)\s*\?\?\s*0\b/.test(read(f)))
  check('nol komponen menambal skor match null dengan 0', badCoerce.length === 0,
    badCoerce.join(', '))

  // Bobot scorer lama tidak boleh kembali — tidak sebagai lapisan kompatibilitas
  // dan tidak sebagai salinan di UI.
  const reWeights = FEATURE_UI.filter(f =>
    /\bW_(BB|TA|CC|BP|PQ|BS|BRAND|CONTENT|TARGET|PERSONALITY|PERFORMANCE|SAFETY)/.test(read(f)))
  check('nol komponen mengimpor bobot engine (tidak ada hitungan kedua)',
    reWeights.length === 0, reWeights.join(', '))
  const oldEngine = FEATURE_UI.filter(f =>
    /brandMatch\/(score|explain)'|from '@\/lib\/discover\/brandMatch'/.test(read(f)))
  check('nol komponen mengimpor scorer berbobot yang sudah dihapus',
    oldEngine.length === 0, oldEngine.join(', '))

  // Aritmetikanya sendiri, di luar DB: null keluar dari pembagi, bukan nol.
  const withNull = brandMatchFromScores(
    { engagement: 80, reach: null }, ['strong_engagement', 'high_reach'])
  check('kriteria null keluar dari pembagi (80, bukan 40)',
    withNull.matchPct === 80 && withNull.contributing === 1 && withNull.selected === 2,
    String(withNull.matchPct))
  check('semua kriteria null → Match % null, bukan 0',
    brandMatchFromScores({ engagement: null }, ['strong_engagement']).matchPct === null)
  check('tidak ada yang dipilih → no_selection',
    brandMatchFromScores({ engagement: 80 }, []).unavailable === 'no_selection')
  check('brand_safety tidak bisa dipilih', cleanWhatMatters(['brand_safety']).length === 0)

  /* ── 4. Kriteria yang tidak tersedia: tidak bisa dipilih di UI ────────── */

  console.log('\nKriteria yang tidak tersedia — disabled, bukan nol\n')

  check('form hanya menawarkan vocabulary What Matters dari API',
    /data\.vocabulary\.whatMatters\.map/.test(form))
  check('form tidak menuliskan daftar kriterianya sendiri',
    !/strong_engagement/.test(form))
  check('kriteria Target Audience yang kosong dirender disabled',
    /PickChip/.test(form) && /disabled=\{!on\}/.test(form))
  check('form menjelaskan null tidak dihitung nol',
    /bukan dihitung nol|not scored zero|leaves the denominator|tidak dihitung sebagai nol/i.test(form))
  check('enam What Matters + lima Target Audience, dan tidak ada brand_safety',
    WHAT_MATTERS_KEYS.length === 6 && AUDIENCE_CRITERIA.length === 5
    && !(WHAT_MATTERS_KEYS as readonly string[]).includes('brand_safety'),
    `${WHAT_MATTERS_KEYS.length}/${AUDIENCE_CRITERIA.length}`)
  check('kriteria Target Audience persis yang disepakati',
    AUDIENCE_CRITERIA.join(',')
      === 'audience_gender,audience_age,audience_country,audience_city,audience_interest',
    AUDIENCE_CRITERIA.join(','))

  /* ── 5. What Matters: enam kriteria, lewat API ────────────────────────── */

  console.log('\nWhat Matters — enam kriteria dari backend\n')

  check('6 kriteria terdaftar', CRITERIA_ORDER.length === 6, CRITERIA_ORDER.join(','))
  check('label sesuai yang disepakati',
    CRITERIA_ORDER.map(k => CRITERIA_LABELS[k]).join(' | ')
      === 'Strong Engagement | High Audience Quality | Consistent Performance | '
        + 'Audiens Aktif & Asli | High Reach | Content Quality',
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
  check('route membaca pilihan dari Brand Profile agency, bukan query string',
    /getBrandProfile\(access\.orgId\)/.test(route) && !/sp\.get\('brandMatch'\)/.test(route))

  /* ── 6. Live: null tetap null sampai ke payload ───────────────────────── */

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
    check('contributing tidak pernah melebihi selected',
      all.every(r => r.contributing <= r.selected))
    check('skor null saat tidak ada kriteria yang menyumbang',
      all.every(r => r.contributing > 0 ? r.score !== null : r.score === null))

    // Brand Match harus memakai ANGKA YANG SAMA dengan What Matters — satu
    // mesin, bukan dua jalur yang kebetulan mirip.
    const choice = ['strong_engagement', 'high_reach']
    let same = 0
    for (const [, r] of scored) {
      const vals = [r.scores.engagement, r.scores.reach]
        .filter((v): v is number => typeof v === 'number')
      const expected = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
      const bm = brandMatchFromScores(r.scores, choice).matchPct
      if (bm === null ? expected === null : Math.abs(bm - (expected ?? 0)) < 1e-9) same++
    }
    check(`Brand Match = rata-rata skor What Matters creator itu sendiri (${same}/${scored.size})`,
      scored.size > 0 && same === scored.size)

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
