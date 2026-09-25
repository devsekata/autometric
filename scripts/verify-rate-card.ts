/**
 * Verifikasi jalur data rate card, dari L1 sampai ke bentuk yang dikirim UI.
 *
 *   npm run verify:rate-card
 *
 * Sumber resmi harga hanya SATU: `l1_silver.unified_rate_card`. Yang dibuktikan
 * di sini BUKAN bahwa angkanya "ada", tapi bahwa setiap angka yang sampai ke
 * layar bisa ditelusuri balik ke satu baris di tabel itu — tidak ada harga yang
 * dikarang, dibulatkan, dirata-ratakan, diambil acak, atau dipinjam dari harga
 * roster — dan bahwa saat sumbernya kosong, produk mengatakan "belum tersedia"
 * alih-alih menampilkan harga 0.
 *
 * Verifier ini berjalan di dua keadaan, dan memilih sendiri dari jumlah baris:
 *
 *   * KOSONG (keadaan sekarang, EXPECTED). Feed rate card resmi belum ada:
 *     tabel ini dan semua layer di bawahnya 0 baris, harga roster dimatikan
 *     oleh keputusan owner (scrapper migration 048/050). Yang dibuktikan:
 *     `RATE_CARD_AVAILABLE` false, directory tidak mengarang `rateFrom`,
 *     plafon harga tidak mengembalikan siapa pun, detail creator tanpa harga.
 *   * TERISI. Validasi penuh seperti Phase 5D: `rateFrom` = MIN(fee) di L1,
 *     satu harga termurah per post_type, mata uang tunggal.
 *
 * Di kedua keadaan: tidak ada fee null/nol/negatif, tidak ada baris dari
 * roster, `l2_gold.kol_profile_card.rate_card_*` tidak menjadi sumber kedua,
 * dan (statis) UI tidak memanggil `/discover/rates` atau menawarkan order
 * selama rate card tidak tersedia.
 *
 * READ-ONLY: setiap sesi dibuka dengan `default_transaction_read_only=on`.
 * MEMBUTUHKAN VPN kantor: assertion database memanggil KOL lewat `@/lib/kolDb`.
 */
process.env.PGOPTIONS = '-c default_transaction_read_only=on'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { listKolDirectory } from '@/lib/discover/kolDirectory'
import { getKolMeasured } from '@/lib/discover/kolMeasured'
import { RATE_CARD_AVAILABLE } from '@/lib/discover/rateCardAvailability'
import kolDb from '@/lib/kolDb'

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const note = (label: string) => console.log(`  note  ${label}`)

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap(name => {
  const p = join(dir, name)
  return statSync(join(ROOT, p)).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : []
})

;(async () => {
  const db = kolDb()
  const { rows: [ro] } = await db.query<{ transaction_read_only: string }>('SHOW transaction_read_only')
  ok('sesi KOL read-only', ro?.transaction_read_only === 'on')

  /* ── 1. sumber L1 ───────────────────────────────────────────────────────── */

  console.log('\nsumber L1: l1_silver.unified_rate_card')
  const src = await db.query<{
    rows: string; accts: string; null_fee: string; bad_fee: string
    currencies: string; dupes: string; orphans: string; roster: string
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
                                 WHERE sa.id = u.social_account_id))::text      AS orphans,
            COUNT(*) FILTER (WHERE coalesce(source_table, '') ILIKE '%roster%'
                                OR coalesce(source, '') ILIKE '%roster%')::text AS roster
       FROM l1_silver.unified_rate_card`,
  )
  const s = src.rows[0]
  const rows = Number(s.rows)
  const empty = rows === 0
  console.log(`  ${s.rows} baris / ${s.accts} akun — ${empty
    ? 'KOSONG: feed rate card resmi belum ada (expected)'
    : 'TERISI: validasi penuh'}`)
  // Berlaku di kedua keadaan (kosong: lulus karena tidak ada baris yang salah).
  ok('tidak ada fee null', s.null_fee === '0')
  ok('tidak ada fee nol atau negatif', s.bad_fee === '0')
  ok('tidak ada kunci bisnis ganda (akun, post_type)', s.dupes === '0')
  ok('tidak ada social_account yatim', s.orphans === '0')
  ok('tidak ada baris yang berasal dari harga roster', s.roster === '0',
    `${s.roster} baris bersumber roster — harga roster bukan rate card resmi`)
  if (empty) {
    note('mata uang tidak diperiksa — tidak ada harga')
  } else {
    // Mata uang dibaca dari sumber, bukan diasumsikan. Kalau suatu hari ada mata
    // uang kedua, assertion ini yang jatuh lebih dulu — sebelum UI menampilkan
    // dua mata uang dengan simbol Rp yang sama.
    ok('mata uang masih tunggal (UI memformat semua sebagai IDR)', s.currencies === '1',
      `${s.currencies} mata uang berbeda`)
  }

  /* ── 2. flag ketersediaan mengikuti sumbernya ───────────────────────────── */

  console.log('\nRATE_CARD_AVAILABLE mengikuti sumbernya')
  if (empty) {
    ok('RATE_CARD_AVAILABLE false selama sumber kosong', RATE_CARD_AVAILABLE === false,
      `RATE_CARD_AVAILABLE=${RATE_CARD_AVAILABLE}`)
  } else if (!RATE_CARD_AVAILABLE) {
    // Bukan kegagalan: flag dinyalakan hanya setelah feed disetujui owner.
    note(`sumber terisi (${rows} baris) tapi RATE_CARD_AVAILABLE masih false — menunggu keputusan owner`)
  } else {
    ok('RATE_CARD_AVAILABLE true dan sumber terisi', true)
  }

  console.log('\nsatu akun tidak boleh dipetakan ke dua creator')
  const ambiguous = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM (
       SELECT social_account_id FROM public.kol_social_account
        WHERE social_account_id IN (SELECT DISTINCT social_account_id FROM l1_silver.unified_rate_card)
        GROUP BY 1 HAVING COUNT(DISTINCT kol_id) > 1) t`,
  )
  ok('pemetaan akun -> creator tidak ambigu', ambiguous.rows[0].n === '0',
    `${ambiguous.rows[0].n} akun bercabang`)

  /* ── 3. directory: rateFrom dan plafon harga ────────────────────────────── */

  console.log('\nrateFrom di listing hanya dari L1, tidak pernah dikarang')
  const page = await listKolDirectory({ maxRate: 1_000_000, pageSize: 24 })
  if (empty) {
    ok('plafon harga tidak mengembalikan creator (tidak ada harga untuk diplafon)',
      page.rows.length === 0 && page.total === 0, `${page.total} total`)
    const plain = await listKolDirectory({ pageSize: 24 })
    ok('listing biasa tetap jalan', plain.rows.length > 0, `${plain.total} creator`)
    ok('tidak ada rateFrom di listing — null, bukan 0',
      plain.rows.every(r => r.rateFrom === null),
      `${plain.rows.filter(r => r.rateFrom !== null).length} baris punya rateFrom`)
  } else {
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
    ok('setiap rateFrom positif dan di bawah plafon yang diminta',
      priced.every(r => (r.rateFrom as number) > 0 && (r.rateFrom as number) <= 1_000_000))
  }

  /* ── 4. detail creator ──────────────────────────────────────────────────── */

  console.log('\ndetail creator: tiap deliverable punya harganya sendiri')
  if (empty) {
    // Creator roster yang punya data L1 (getKolMeasured null = tidak ada data
    // sama sekali, jadi tidak membuktikan apa-apa soal harga): tanpa sumber,
    // detailnya tidak boleh punya harga.
    // Kandidat diambil dari tabel yang sama yang diagregasi getKolMeasured.
    const { rows: candidates } = await db.query<{ id: string; username: string }>(
      `SELECT kd.id, kd.username FROM public.kol_directory kd
        WHERE kd.directory_status = 'active'
          AND EXISTS (SELECT 1 FROM public.kol_social_account ksa
                        JOIN l1_silver.unified_post p ON p.social_account_id = ksa.social_account_id
                       WHERE ksa.kol_id = kd.id)
        ORDER BY kd.id LIMIT 5`)
    let shown: { username: string; rates: number } | null = null
    for (const c of candidates) {
      const m = await getKolMeasured(c.id)
      if (m) { shown = { username: c.username, rates: m.rates.length }; break }
    }
    ok('ada creator dengan data L1 untuk diperiksa', shown !== null,
      shown ? `@${shown.username}` : `0 dari ${candidates.length} kandidat`)
    ok('detail creator tanpa harga — daftar rates kosong, bukan harga 0',
      shown?.rates === 0, `${shown?.rates ?? '—'} rate`)
  } else {
    // Creator dengan deliverable terbanyak — kasus paling keras untuk aturan
    // "jangan tumpuk satu post_type dengan post_type lain".
    const pick = await db.query<{ kol_id: string; n: string }>(
      `SELECT ksa.kol_id, COUNT(DISTINCT u.post_type)::text AS n
         FROM public.kol_social_account ksa
         JOIN l1_silver.unified_rate_card u ON u.social_account_id = ksa.social_account_id
        GROUP BY ksa.kol_id ORDER BY COUNT(DISTINCT u.post_type) DESC, ksa.kol_id LIMIT 1`,
    )
    if (!pick.rows.length) {
      ok('ada harga yang terpetakan ke creator roster', false,
        `${rows} baris di L1, tidak satu pun lewat kol_social_account`)
    } else {
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
    }
  }

  /* ── 5. Gold bukan sumber harga kedua ───────────────────────────────────── */

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

  /* ── 6. UI dan source (statis) ──────────────────────────────────────────── */

  // Hanya bermakna saat rate card tidak tersedia: memastikan UI tidak menyajikan
  // kontrol harga di atas sumber yang tidak ada. Dicek dari teks source, jadi
  // tidak butuh database dan tidak menjalankan UI.
  console.log('\nUI selama rate card tidak tersedia (statis)')
  if (RATE_CARD_AVAILABLE) {
    note('RATE_CARD_AVAILABLE true — pemeriksaan "unavailable" dilewati')
  } else {
    const filters = read('src/components/discover/KolDirectoryFilters.tsx')
    ok('filter Max Rate Card tidak dikirim ke API',
      /if \(RATE_CARD_AVAILABLE && f\.maxRate > 0\) p\.maxRate\s*=/.test(filters))
    ok('slider Max Rate Card hanya dirender saat tersedia',
      /\{RATE_CARD_AVAILABLE \? \(/.test(filters))

    const directoryPage = read('src/components/discover/KolDirectoryPage.tsx')
    ok('Add to Cart dan bulk cart menolak order tanpa rate card',
      (directoryPage.match(/if \(!RATE_CARD_AVAILABLE\) \{ flash\(/g) ?? []).length >= 2)
    ok('dialog harga roster hanya dirender saat tersedia',
      /\{RATE_CARD_AVAILABLE && pricing && \(/.test(directoryPage))

    const rateCard = read('src/components/discover/KolRateCard.tsx')
    ok('tab Rate Card creator menampilkan "belum tersedia", bukan form harga',
      /if \(!RATE_CARD_AVAILABLE\) \{\s*return <EmptyState/.test(rateCard))

    // Setiap komponen yang memanggil /discover/rates harus menahan panggilannya
    // di balik RATE_CARD_AVAILABLE (endpoint-nya 503 selama tidak tersedia).
    const callers = walk('src/components').filter(p => read(p).includes('/discover/rates'))
    const ungated = callers.filter(p => !read(p).includes('RATE_CARD_AVAILABLE'))
    ok('/discover/rates tidak dipanggil tanpa penjaga RATE_CARD_AVAILABLE', ungated.length === 0,
      ungated.length
        ? `tanpa penjaga: ${ungated.map(p => relative(ROOT, join(ROOT, p)).replace(/\\/g, '/')).join(', ')}`
        : `${callers.length} pemanggil, semuanya dijaga`)
  }

  // Berlaku di kedua keadaan: tidak ada harga pengganti untuk harga L1 di kode
  // discover. `baseRate` sengaja tidak termasuk: itu tarif override milik org
  // dari `/discover/rates` (0 = belum diset, dijaga `> 0`), dan pemanggilannya
  // sudah diperiksa oleh assertion `/discover/rates` di atas.
  const discoverSrc = [...walk('src/lib/discover'), ...walk('src/components/discover')]
  const fallback = discoverSrc.filter(p =>
    /\b(rateFrom|fee|min_fee)\s*\?\?\s*[0-9]/.test(read(p))
    || /Math\.random/.test(read(p))
    || /from ['"]@\/lib\/discover\/kolSample['"]/.test(read(p)))
  ok('tidak ada harga default/acak/sampel di kode discover', fallback.length === 0,
    fallback.map(p => p.replace(/\\/g, '/')).join(', '))
  const rosterPrice = discoverSrc.filter(p =>
    /\b(story|story_session|feed_photo|feed_video|reel|live|owning_asset|tap_link|link_in_bio|live_attendance|host|comment|photoshoot|other)_price\b/.test(read(p)))
  ok('kolom harga kol_roster_import tidak dibaca kode discover', rosterPrice.length === 0,
    rosterPrice.map(p => p.replace(/\\/g, '/')).join(', '))

  console.log(bad ? `\n${bad} GAGAL` : `\nSemua assertion rate card lulus (${empty ? 'sumber kosong — unavailable, expected' : 'sumber terisi'}).`)
  process.exit(bad ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
