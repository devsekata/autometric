/**
 * Verifikasi jalur data rate card, dari L1 sampai ke bentuk yang dikirim UI.
 *
 *   npm run verify:rate-card
 *
 * Dibuat saat Phase 5D, setelah `l1_silver.unified_rate_card` terisi 8.856
 * baris / 6.959 creator (13 Sep 2026) dan kontrol plafon harga di Creator
 * Database dihidupkan kembali.
 *
 * Yang dibuktikan di sini BUKAN bahwa angkanya "ada", tapi bahwa setiap angka
 * yang sampai ke layar bisa ditelusuri balik ke satu baris di
 * `l1_silver.unified_rate_card` — tidak ada harga yang dikarang, dibulatkan,
 * dirata-ratakan, atau diambil acak saat satu creator punya banyak deliverable.
 *
 * Sumbernya SATU: L1. Kolom `l2_gold.kol_profile_card.rate_card_*` sengaja
 * dibiarkan null dan TIDAK dibaca — assertion terakhir menjaga itu, supaya
 * tidak diam-diam muncul sumber harga kedua yang bisa berbeda.
 *
 * MEMBUTUHKAN VPN kantor: semua assertion memanggil database KOL lewat
 * `@/lib/kolDb`.
 */
import { listKolDirectory } from '@/lib/discover/kolDirectory'
import { getKolMeasured } from '@/lib/discover/kolMeasured'
import kolDb from '@/lib/kolDb'

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

;(async () => {
  const db = kolDb()

  console.log('sumber L1 utuh')
  const src = await db.query<{
    rows: string; accts: string; null_fee: string; bad_fee: string
    currencies: string; dupes: string; orphans: string
  }>(
    `SELECT COUNT(*)::text                                            AS rows,
            COUNT(DISTINCT social_account_id)::text                   AS accts,
            COUNT(*) FILTER (WHERE fee IS NULL)::text                 AS null_fee,
            COUNT(*) FILTER (WHERE fee <= 0)::text                    AS bad_fee,
            COUNT(DISTINCT currency)::text                            AS currencies,
            (SELECT COUNT(*) FROM (SELECT social_account_id, post_type
                                     FROM l1_silver.unified_rate_card
                                    GROUP BY 1, 2 HAVING COUNT(*) > 1) d)::text AS dupes,
            (SELECT COUNT(*) FROM l1_silver.unified_rate_card u
              WHERE NOT EXISTS (SELECT 1 FROM public.social_account sa
                                 WHERE sa.id = u.social_account_id))::text      AS orphans
       FROM l1_silver.unified_rate_card`,
  )
  const s = src.rows[0]
  ok('ada harga untuk diperiksa', Number(s.rows) > 0, `${s.rows} baris / ${s.accts} akun`)
  ok('tidak ada fee null', s.null_fee === '0')
  ok('tidak ada fee nol atau negatif', s.bad_fee === '0')
  ok('tidak ada kunci bisnis ganda (akun, post_type)', s.dupes === '0')
  ok('tidak ada social_account yatim', s.orphans === '0')
  // Mata uang dibaca dari sumber, bukan diasumsikan. Kalau suatu hari ada mata
  // uang kedua, assertion ini yang jatuh lebih dulu — sebelum UI menampilkan
  // dua mata uang dengan simbol Rp yang sama.
  ok('mata uang masih tunggal (UI memformat semua sebagai IDR)', s.currencies === '1',
    `${s.currencies} mata uang berbeda`)

  console.log('\nsatu akun tidak boleh dipetakan ke dua creator')
  const ambiguous = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM (
       SELECT social_account_id FROM public.kol_social_account
        WHERE social_account_id IN (SELECT DISTINCT social_account_id FROM l1_silver.unified_rate_card)
        GROUP BY 1 HAVING COUNT(DISTINCT kol_id) > 1) t`,
  )
  ok('pemetaan akun -> creator tidak ambigu', ambiguous.rows[0].n === '0',
    `${ambiguous.rows[0].n} akun bercabang`)

  console.log('\nrateFrom di listing = MIN(fee) creator itu, bukan angka lain')
  const page = await listKolDirectory({ maxRate: 1_000_000, pageSize: 24 })
  ok('plafon mengembalikan creator', page.rows.length > 0, `${page.total} total`)

  const priced = page.rows.filter(r => r.rateFrom !== null)
  ok('creator yang lolos plafon punya rateFrom', priced.length === page.rows.length,
    `${priced.length} dari ${page.rows.length}`)

  const truth = await db.query<{ kol_id: string; min_fee: string }>(
    `SELECT ksa.kol_id, MIN(u.fee)::bigint::text AS min_fee
       FROM public.kol_social_account ksa
       JOIN l1_silver.unified_rate_card u ON u.social_account_id = ksa.social_account_id
      WHERE ksa.kol_id = ANY($1::uuid[]) AND u.fee IS NOT NULL
      GROUP BY ksa.kol_id`,
    [page.rows.map(r => r.id)],
  )
  const byKol = new Map(truth.rows.map(r => [r.kol_id, Number(r.min_fee)]))
  const wrong = priced.filter(r => byKol.get(r.id) !== r.rateFrom)
  ok('setiap rateFrom sama persis dengan MIN(fee) di L1', wrong.length === 0,
    wrong.length ? `${wrong.length} tidak cocok, contoh ${wrong[0].username}` : `${priced.length} dicocokkan`)
  ok('setiap rateFrom di bawah plafon yang diminta',
    priced.every(r => (r.rateFrom as number) <= 1_000_000))

  console.log('\ndetail creator: tiap deliverable punya harganya sendiri')
  // Creator dengan deliverable terbanyak — kasus paling keras untuk aturan
  // "jangan tumpuk satu post_type dengan post_type lain".
  const pick = await db.query<{ kol_id: string; n: string }>(
    `SELECT ksa.kol_id, COUNT(DISTINCT u.post_type)::text AS n
       FROM public.kol_social_account ksa
       JOIN l1_silver.unified_rate_card u ON u.social_account_id = ksa.social_account_id
      GROUP BY ksa.kol_id ORDER BY COUNT(DISTINCT u.post_type) DESC, ksa.kol_id LIMIT 1`,
  )
  const kolId = pick.rows[0].kol_id
  const measured = await getKolMeasured(kolId)
  ok('getKolMeasured mengembalikan creator itu', measured !== null)

  const rates = measured?.rates ?? []
  ok('jumlah baris rate = jumlah post_type berbeda di L1',
    rates.length === Number(pick.rows[0].n),
    `${rates.length} vs ${pick.rows[0].n}`)
  ok('tidak ada post_type kembar di hasil',
    new Set(rates.map(r => r.postType)).size === rates.length)
  ok('tiap harga positif dan bukan NaN',
    rates.every(r => Number.isFinite(r.fee) && r.fee > 0))
  ok('tiap mata uang dibawa dari sumber', rates.every(r => typeof r.currency === 'string' && r.currency.length > 0))

  // Kontrak yang dipegang UI: satu harga per post_type, yang TERMURAH — bukan
  // rata-rata dan bukan yang kebetulan terbaca duluan.
  const cheapest = await db.query<{ post_type: string; fee: string; currency: string }>(
    `SELECT DISTINCT ON (rc.post_type) rc.post_type, rc.fee::text, rc.currency
       FROM public.kol_social_account ksa
       JOIN l1_silver.unified_rate_card rc ON rc.social_account_id = ksa.social_account_id
      WHERE ksa.kol_id = $1 AND rc.fee IS NOT NULL AND rc.post_type IS NOT NULL
      ORDER BY rc.post_type, rc.fee ASC`,
    [kolId],
  )
  const expect = new Map(cheapest.rows.map(r => [r.post_type, Number(r.fee)]))
  const drifted = rates.filter(r => expect.get(r.postType) !== r.fee)
  ok('tiap harga = kuotasi termurah post_type itu di L1', drifted.length === 0,
    drifted.length ? `${drifted.length} melenceng, contoh ${drifted[0].postType}` : `${rates.length} deliverable dicocokkan`)
  ok('tiap mata uang = mata uang sumbernya',
    rates.every(r => r.currency === cheapest.rows.find(c => c.post_type === r.postType)?.currency))

  console.log('\nGold tetap bukan sumber harga kedua')
  const gold = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM l2_gold.kol_profile_card
      WHERE rate_card IS NOT NULL OR rate_card_min_fee IS NOT NULL
         OR rate_card_max_fee IS NOT NULL OR rate_card_post_types IS NOT NULL
         OR rate_card_currency IS NOT NULL`,
  )
  ok('kolom rate_card_* di kol_profile_card masih kosong seluruhnya',
    gold.rows[0].n === '0',
    `${gold.rows[0].n} baris terisi — kalau > 0, ada dua sumber harga yang bisa berbeda`)

  await db.end()
  console.log(bad ? `\n${bad} GAGAL` : '\nSemua assertion rate card lulus.')
  process.exit(bad ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
