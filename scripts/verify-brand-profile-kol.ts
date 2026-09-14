/**
 * Verifikasi Brand Match hidup sepenuhnya di DB `kol`, dan empat bar UI-nya
 * melipat enam komponen dengan benar.
 *
 *   npm run verify:brand-profile-kol
 *
 * Kenapa skrip ini ada: dua hal yang paling mudah rusak di sini tidak akan
 * pernah ditangkap `tsc` maupun `npm run build`, karena keduanya sintaksis
 * benar dan hanya salah saat dijalankan.
 *
 *   BOUNDARY  Satu `import pool from '@/lib/db'` yang kembali ke
 *             `brandMatch/` akan membuat Brand Match membaca server yang
 *             salah. Dan itu TIDAK error: `l1_silver`, `l2_gold` dan `feature`
 *             ada di KEDUA server dengan nama yang sama, jadi query ke pool
 *             yang keliru mengembalikan angka berbeda tanpa satu pun keluhan.
 *             Diperiksa di level SOURCE, karena satu-satunya cara menangkapnya
 *             sebelum produksi adalah membaca importnya.
 *
 *   LIPATAN   Dua dari empat bar menggabungkan sepasang komponen. Kalau
 *             lipatannya memakai rata-rata biasa alih-alih `weighted()`,
 *             komponen yang N/A akan tertarik menjadi 0 dan creator yang belum
 *             terukur terbaca sebagai creator yang buruk — persis kesalahan
 *             yang seluruh model ini dibangun untuk menghindarinya.
 *
 * Pemeriksaan pertama membaca file; sisanya murni in-memory. Pemeriksaan
 * database bersifat read-only dan akan melewati dirinya sendiri dengan jujur
 * kalau migrasi `migrations/kol/001` belum dijalankan.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import kolDb from '@/lib/kolDb'
import { explain, SIGNAL_LABELS } from '@/lib/discover/brandMatch/explain'
import { V } from '@/lib/discover/brandMatch/model'
import { NA, type ScoreResult, type Scored } from '@/lib/discover/brandMatch/score'

let failures = 0
let skipped = 0

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  ok    ${label}`)
  } else {
    failures++
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function skip(label: string, why: string) {
  skipped++
  console.log(`  skip  ${label} — ${why}`)
}

/**
 * Satu `ScoreResult` dengan seluruh komponen bisa ditimpa.
 *
 * Nilai dasarnya N/A, bukan 0: default yang benar untuk roster ini adalah
 * "belum terukur", dan memakai 0 sebagai default akan membuat test lulus untuk
 * alasan yang salah.
 */
function result(over: Partial<ScoreResult> = {}): ScoreResult {
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
    dataCompleteness: 0, confidence: 'Limited Data',
    ...over,
  }
}

const barOf = (s: ScoreResult, id: string) =>
  explain(s).signals.find(x => x.id === id) ?? null

async function main() {
  /* ── 1. Database boundary, dibaca dari source ─────────────────────────── */

  console.log('\nBoundary — Brand Match tidak boleh menyentuh TSDB\n')

  const dir = join(process.cwd(), 'src', 'lib', 'discover', 'brandMatch')
  const files = readdirSync(dir).filter(f => f.endsWith('.ts'))
  const offenders: string[] = []
  for (const f of files) {
    for (const [i, line] of readFileSync(join(dir, f), 'utf8').split(/\r?\n/).entries()) {
      // Hanya baris import yang dihitung. Komentar yang MENYEBUT `@/lib/db`
      // justru diinginkan — di situlah alasan larangannya ditulis.
      if (/^\s*import\b.*['"]@\/lib\/db['"]/.test(line)) offenders.push(`${f}:${i + 1}`)
    }
  }
  check('tidak ada import @/lib/db di brandMatch/', offenders.length === 0, offenders.join(', '))
  check('brandMatch/ memakai kolDb', files.some(f =>
    /from '@\/lib\/kolDb'/.test(readFileSync(join(dir, f), 'utf8'))))

  const profileSrc = readFileSync(join(dir, 'profile.ts'), 'utf8')
  check('Brand Profile query menunjuk public.brand_profile',
    /FROM public\.brand_profile\b/.test(profileSrc)
    && /INSERT INTO public\.brand_profile\b/.test(profileSrc))
  check('tidak ada query ke discover_brand_profiles',
    !/(FROM|INTO|UPDATE)\s+public\.discover_brand_profiles/.test(profileSrc))

  /* ── 2. Empat bar, bukan lima atau enam ───────────────────────────────── */

  console.log('\nEmpat bar UI\n')

  const ids = Object.keys(SIGNAL_LABELS)
  check('tepat 4 bar', ids.length === 4, ids.join(','))
  check('id-nya category · audience · values · performance',
    ['category', 'audience', 'values', 'performance'].every(k => ids.includes(k)),
    ids.join(','))
  check('label sesuai brief',
    SIGNAL_LABELS.category === 'Category Matching'
    && SIGNAL_LABELS.audience === 'Audience Relevance'
    && SIGNAL_LABELS.values === 'Values Alignment'
    && SIGNAL_LABELS.performance === 'Past Performance',
    JSON.stringify(SIGNAL_LABELS))

  // Bobot yang dilipat harus berjumlah persis seperti brief: 40/30/10/20.
  check('bobot lipatan = 40 / 30 / 10 / 20',
    V.W_BRAND_BUSINESS + V.W_CONTENT_CATEGORY === 40
    && V.W_TARGET_AUDIENCE === 30
    && V.W_PERSONALITY === 10
    && V.W_PERFORMANCE + V.W_SAFETY === 20,
    `${V.W_BRAND_BUSINESS}+${V.W_CONTENT_CATEGORY} / ${V.W_TARGET_AUDIENCE} / ${V.W_PERSONALITY} / ${V.W_PERFORMANCE}+${V.W_SAFETY}`)

  /* ── 3. Lipatan memakai weighted(), bukan rata-rata polos ─────────────── */

  console.log('\nLipatan pasangan komponen\n')

  // Bobot sama (20/20), jadi dua nilai ada harus jadi rata-ratanya.
  check('Category Matching = mean(business, content) saat keduanya ada',
    barOf(result({ businessScore: 80, contentScore: 60 }), 'category')?.pct === 70)
  check('Past Performance = mean(performance, safety) saat keduanya ada',
    barOf(result({ performanceScore: 90, safetyScore: 50 }), 'performance')?.pct === 70)

  // Inti kontraknya: separuh yang N/A harus RENORMALISASI, bukan menarik ke 0.
  const halfCat = barOf(result({ businessScore: 80, contentScore: NA }), 'category')
  check('separuh N/A → bar = separuh yang ada (bukan 40, bukan 0)',
    halfCat?.pct === 80, String(halfCat?.pct))
  const halfPerf = barOf(result({ performanceScore: NA, safetyScore: 50 }), 'performance')
  check('separuh N/A pada Past Performance juga renormalisasi',
    halfPerf?.pct === 50, String(halfPerf?.pct))

  // Dua-duanya N/A → bar unavailable, bukan 0.
  const bothNa = barOf(result(), 'category')
  check('dua-duanya N/A → pct null + alasan, bukan 0',
    bothNa?.pct === null && !!bothNa?.unavailable, JSON.stringify(bothNa))

  /* ── 4. Values Alignment — BLOCKED, dan harus terlihat begitu ─────────── */

  console.log('\nValues Alignment\n')

  const values = barOf(result(), 'values')
  check('Values Alignment hadir sebagai bar', values !== null)
  check('Values Alignment unavailable saat personality N/A',
    values?.pct === null && !!values?.unavailable, JSON.stringify(values))
  check('Values Alignment TIDAK pernah dikarang jadi angka',
    barOf(result({ personalityScore: NA }), 'values')?.pct === null)

  /* ── 5. Bar membawa skor 0–100, bukan kontribusi terbobot ─────────────── */

  console.log('\nSkala bar\n')

  // Audience 30% dengan skor 80 harus melaporkan 80, bukan 80 x 0,30 = 24.
  check('bar melaporkan skor komponen, bukan kontribusi terbobot',
    barOf(result({ audienceScore: 80 }), 'audience')?.pct === 80)
  check('tidak ada bobot yang bocor ke label',
    !Object.values(SIGNAL_LABELS).some(l => /\d|%/.test(l)),
    JSON.stringify(SIGNAL_LABELS))

  /* ── 6. Database — read-only, melewati diri sendiri kalau belum migrasi ─ */

  console.log('\nDatabase (read-only)\n')

  try {
    const db = kolDb()
    const { rows: [who] } = await db.query<{ db: string }>('SELECT current_database() AS db')
    check('Brand Profile dibaca dari database kol', who.db === 'kol', who.db)

    const { rows: [t] } = await db.query<{ t: string | null }>(
      `SELECT to_regclass('public.brand_profile')::text AS t`)
    if (!t.t) {
      skip('public.brand_profile ada di kol',
        'migrations/kol/001 belum dijalankan — jalankan: npm run migrate:kol')
      skip('kolom brand_profile lengkap', 'tabel belum ada')
    } else {
      check('public.brand_profile ada di kol', true)
      const { rows: cols } = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='brand_profile'`)
      const have = new Set(cols.map(c => c.column_name))
      const need = [
        'organization_id', 'brand_category', 'brand_keywords', 'brand_hashtags',
        'caption_terms', 'gender_majority', 'target_country', 'target_city',
        'audience_interests', 'brand_personality',
      ]
      check('kolom yang dibaca engine semuanya ada',
        need.every(c => have.has(c)), need.filter(c => !have.has(c)).join(', ') || 'lengkap')

      // Tidak boleh ada FK yang keluar dari database ini.
      const { rows: fks } = await db.query<{ def: string }>(
        `SELECT pg_get_constraintdef(con.oid) def
           FROM pg_constraint con
           JOIN pg_class rel ON rel.oid = con.conrelid
          WHERE rel.relname = 'brand_profile' AND con.contype = 'f'`)
      check('tidak ada FK ke organizations/users (tabelnya di server lain)',
        !fks.some(f => /organizations|users/.test(f.def)),
        fks.map(f => f.def).join(' | ') || 'tidak ada FK sama sekali')
    }
  } catch (err) {
    skip('pemeriksaan database', `KOL server tidak terjangkau: ${
      err instanceof Error ? err.message.slice(0, 60) : String(err)}`)
    skipped += 2
  }

  console.log(
    failures === 0
      ? `\nSemua pemeriksaan lulus.${skipped ? ` ${skipped} dilewati.` : ''}\n`
      : `\n${failures} pemeriksaan gagal.${skipped ? ` ${skipped} dilewati.` : ''}\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main()
