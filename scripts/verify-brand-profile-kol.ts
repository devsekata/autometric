/**
 * Verifikasi Brand Match hidup sepenuhnya di DB `kol`, dan rinciannya
 * merender kriteria yang dipilih Brand Profile dengan benar.
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
 *   PEMBAGI   Kriteria yang belum terukur harus KELUAR dari pembagi. Kalau ia
 *             ikut sebagai 0, creator yang belum diukur terbaca sebagai creator
 *             yang buruk — persis kesalahan yang seluruh model ini dibangun
 *             untuk menghindarinya.
 *
 * -- Ditulis ulang untuk SATU mesin Brand Match ----------------------------
 * Bagian 2-5 dulu memeriksa scorer berbobot: empat bar `explain()`, konstanta
 * `V.W_*`, dan lipatan pasangan komponen. Scorer itu sudah dihapus bersama
 * `score.ts` dan `explain.ts`, jadi pemeriksaannya TIDAK dipertahankan - ia
 * diganti kontrak yang berlaku sekarang: rincian Brand Match adalah satu baris
 * per kriteria yang dipilih, dengan skor apa adanya dari What Matters.
 *
 * Pemeriksaan pertama membaca file; sisanya murni in-memory. Pemeriksaan
 * database bersifat read-only dan akan melewati dirinya sendiri dengan jujur
 * kalau migrasi `migrations/kol/001` belum dijalankan.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import kolDb from '@/lib/kolDb'
import {
  WHAT_MATTERS_CRITERION, WHAT_MATTERS_KEYS, WHAT_MATTERS_OPTIONS,
  brandMatchFromScores, cleanWhatMatters,
} from '@/lib/discover/whatMatters/brandMatch'
import {
  AUDIENCE_CRITERIA, AUDIENCE_CRITERIA_LABELS, selectedAudienceCriteria,
} from '@/lib/discover/whatMatters/audienceMatch'
import { CRITERIA_LABELS } from '@/lib/discover/whatMatters'
import { emptyProfile, isScoreable } from '@/lib/discover/brandMatch/profile'
import type { CriterionScores } from '@/lib/discover/whatMatters/score'

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

/** Skor enam kriteria What Matters, semuanya terisi. */
const FULL: CriterionScores = {
  engagement: 82, audience_quality: 90, consistency: 50,
  community: 71, reach: 40, content_quality: 63,
}

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

  // Scorer berbobot harus benar-benar hilang, bukan disembunyikan: satu file
  // yang tertinggal adalah satu mesin kedua yang bisa dipanggil lagi.
  const GONE = ['score.ts', 'explain.ts', 'index.ts']
  const stillThere = GONE.filter(f => files.includes(f))
  check('scorer berbobot (score/explain/index) sudah dihapus dari brandMatch/',
    stillThere.length === 0, stillThere.join(', '))
  // Komentar dibuang dulu, sama seperti pemeriksaan boundary di atas yang hanya
  // menghitung baris import. Catatan yang MENJELASKAN kenapa bobot ini dihapus
  // justru diinginkan — di situlah alasannya ditulis — dan sebuah larangan yang
  // ikut menangkap penjelasannya sendiri akan mengajari orang menghapus
  // penjelasannya, bukan memperbaiki kodenya.
  const noComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const withWeights = files.filter(f => /\bW_BS_/.test(noComments(readFileSync(join(dir, f), 'utf8'))))
  check('tidak ada bobot W_BS_* yang tersisa di brandMatch/ (di luar komentar)',
    withWeights.length === 0, withWeights.join(', '))
  check('profile.ts tidak lagi mengekspor adapter scorer lama',
    !/export function toScoringBrand|export function toEligibility/.test(profileSrc))
  check('profile.ts membaca what_matters dan company_website',
    /what_matters/.test(profileSrc) && /company_website/.test(profileSrc))
  // Brand personality / Brand values dihapus dari profil, dan kolomnya
  // (brand_personality, brand_values) sudah di-drop oleh migrations/kol/011.
  check('profile.ts tidak membaca/menulis brand_personality atau brand_values',
    !/brand_personality|brand_values|brandPersonality|brandValues/.test(noComments(profileSrc)))

  /* ── 2. Kosakata: enam What Matters + lima Target Audience ───────────── */

  console.log('\nKosakata kriteria\n')

  check('enam What Matters, tidak lebih',
    WHAT_MATTERS_KEYS.length === 6, WHAT_MATTERS_KEYS.join(','))
  check('brand_safety tidak bisa dipilih',
    !(WHAT_MATTERS_KEYS as readonly string[]).includes('brand_safety')
    && cleanWhatMatters(['brand_safety']).length === 0)
  check('lima kriteria Target Audience, persis yang disepakati',
    AUDIENCE_CRITERIA.join(',')
      === 'audience_gender,audience_age,audience_country,audience_city,audience_interest',
    AUDIENCE_CRITERIA.join(','))
  check('label opsi = label What Matters (satu nama, bukan dua)',
    WHAT_MATTERS_OPTIONS.every(o => o.label === CRITERIA_LABELS[WHAT_MATTERS_CRITERION[o.key]]))
  check('tidak ada bobot yang bocor ke label',
    ![...Object.values(CRITERIA_LABELS), ...Object.values(AUDIENCE_CRITERIA_LABELS)]
      .some(l => /\d|%/.test(l)))

  /* ── 3. Match % = rata-rata kriteria yang dipilih ──────────────────── */

  console.log('\nMatch % — rata-rata, bobot sama\n')

  check('satu dipilih → skornya sendiri',
    brandMatchFromScores(FULL, ['strong_engagement']).matchPct === 82)
  check('dua dipilih → rata-ratanya',
    brandMatchFromScores(FULL, ['strong_engagement', 'high_audience_quality']).matchPct === 86)
  check('kriteria yang TIDAK dipilih tidak bisa menggerakkannya',
    brandMatchFromScores(FULL, ['strong_engagement']).matchPct
      === brandMatchFromScores({ ...FULL, reach: 0, community: 100 }, ['strong_engagement']).matchPct)

  /* ── 4. Yang belum terukur keluar dari pembagi, bukan jadi nol ───────── */

  console.log('\nKriteria yang belum terukur\n')

  const half = brandMatchFromScores({ ...FULL, reach: null }, ['strong_engagement', 'high_reach'])
  check('separuh null → Match % = separuh yang ada (bukan 41, bukan 0)',
    half.matchPct === 82, String(half.matchPct))
  check('…dan pembaginya ikut menyusut', half.contributing === 1 && half.selected === 2)
  check('…dan rinciannya menandainya tidak dihitung',
    half.breakdown.find(b => b.key === 'high_reach')?.counted === false
    && half.breakdown.find(b => b.key === 'high_reach')?.score === null)
  const allNull = brandMatchFromScores({ engagement: null }, ['strong_engagement'])
  check('semua null → Match % null (no_scores), bukan 0',
    allNull.matchPct === null && allNull.unavailable === 'no_scores')
  const none = brandMatchFromScores(FULL, [])
  check('tidak ada yang dipilih → Match % null (no_selection), rincian kosong',
    none.matchPct === null && none.unavailable === 'no_selection' && none.breakdown.length === 0)
  check('tidak ada band yang ikut terbawa di hasil',
    !('level' in none) && !('confidence' in none) && !('coverage' in none))

  /* ── 5. Scoreable = ada yang DIPILIH, bukan ada brand category ──────── */

  console.log('\nScoreable\n')

  const blank = emptyProfile('x')
  check('profil kosong tidak scoreable', !isScoreable(blank))
  check('brand category saja tidak menyalakan scoring',
    !isScoreable({ ...blank, brandCategory: 'Beauty' }))
  check('satu What Matters menyalakannya',
    isScoreable({ ...blank, whatMatters: ['high_reach'] }))
  check('satu field Target Audience juga menyalakannya',
    isScoreable({ ...blank, targetCity: 'Jakarta' }))
  check('field Target Audience yang kosong tidak memilih kriteria apa pun',
    selectedAudienceCriteria(blank).length === 0)
  check("gender 'Any' tidak memilih kriteria gender",
    selectedAudienceCriteria({ ...blank, genderMajority: 'Any' }).length === 0
    && selectedAudienceCriteria({ ...blank, genderMajority: 'Female' })
      .join(',') === 'audience_gender')

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
      // brand_keywords / brand_hashtags / caption_terms left this list with
      // migrations/kol/009, which dropped them; the engine no longer reads them.
      const need = [
        'organization_id', 'brand_category', 'gender_majority', 'target_country', 'target_city',
        'audience_interests',
        // migrations/kol/007 and 008: the criteria Brand Match averages, and the
        // website the form saves but nothing scores. brand_personality and
        // brand_values were dropped by migrations/kol/011.
        'what_matters', 'company_website',
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
