/**
 * Verifikasi lima filter Creator Database yang diimplementasikan di BE-01…BE-05.
 *
 *   npm run verify:filters
 *
 * Kenapa skrip ini ada: kelima filter itu SQL, dan tidak ada satu pun di
 * TypeScript yang bisa membuktikan sebuah predikat memilih baris yang benar.
 * `tsc` bersih sepanjang `engagement_rate` dipakai mentah, sepanjang kategori
 * dicocokkan dengan equality, dan sepanjang `q` cuma melihat `username` — tiga
 * hal yang dulu salah dan tidak menghasilkan error apa pun.
 *
 * TIDAK ADA ANGKA ROSTER YANG DITULIS DI SINI. Versi sebelumnya membandingkan
 * dengan distribusi yang diukur 2026-09-08 atas roster 7.720 (Beauty 1.271,
 * tanpa kategori 3.547, untiered 526, …) dan dengan creator tertentu
 * ("Cristiano Ronaldo" sebagai displayName). Begitu roster berganti menjadi
 * 1.980 creator, 17 assertion merah padahal tidak satu filter pun berubah.
 * Sekarang setiap nilai yang diharapkan dihitung saat skrip jalan dengan SQL
 * sendiri, yang ditulis ulang di file ini dari aturan filternya — BUKAN dengan
 * memanggil fungsi produksi yang sedang diuji. Filter produksi dan SQL itu
 * harus sepakat; kalau salah satunya bergeser, skrip ini merah.
 *
 * Creator yang dipakai sebagai contoh (label agency, bio, outlier ER, prefix
 * username) juga dipilih dari database saat skrip jalan, bukan ditulis namanya.
 *
 * READ-ONLY: setiap sesi dibuka dengan `default_transaction_read_only=on`.
 * MEMBUTUHKAN VPN kantor: seluruh assertion memanggil database KOL sungguhan
 * lewat `@/lib/kolDb`, sama seperti `verify:creators`.
 */
process.env.PGOPTIONS = '-c default_transaction_read_only=on'

import kolDb from '../src/lib/kolDb'
import {
  listKolDirectory, listKolFacets, UNCATEGORIZED, UNTIERED, ER_SUSPECT_MIN,
} from '../src/lib/discover/kolDirectory'
import {
  KOL_FILTERS_DEFAULT, activeFilterCount, appliedFilters, filtersToParams, normalizeKolFilters,
  UNCATEGORIZED as UI_UNCATEGORIZED, UNTIERED as UI_UNTIERED,
  type KolFilters,
} from '../src/components/discover/KolDirectoryFilters'

let bad = 0
const ok = (label: string, cond: boolean, extra = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
}
const eq = (label: string, got: unknown, want: unknown) =>
  ok(label, got === want, got === want ? `${got}` : `dapat ${got}, harusnya ${want}`)

/* ── Ekspektasi independen: SQL yang ditulis ulang dari aturan filternya ── */

const db = kolDb()
const count = async (where: string, args: unknown[] = []) =>
  Number((await db.query(`SELECT count(*)::int AS n FROM public.kol_directory kd
                           WHERE kd.directory_status = 'active' AND ${where}`, args)).rows[0].n)

/** Id kategori creator: `category_ids`, atau `category_id` lama kalau kosong. */
const CAT_IDS = `COALESCE(kd.category_ids, ARRAY[kd.category_id])`
/** Creator membawa salah satu nama kategori di `$n`. */
const HAS_CATEGORY = (n: number) => `EXISTS (SELECT 1 FROM public.kol_categories kc
  WHERE kc.id = ANY (${CAT_IDS}) AND kc.name = ANY ($${n}::text[]))`
/** Creator yang tidak membawa satu pun nama kategori. */
const NO_CATEGORY = `NOT EXISTS (SELECT 1 FROM public.kol_categories kc WHERE kc.id = ANY (${CAT_IDS}))`
/** Follower creator jatuh di salah satu band bernama `$n` (batas dari kol_tiers). */
const IN_BAND = (n: number) => `EXISTS (SELECT 1 FROM public.kol_tiers t WHERE t.name = ANY ($${n}::text[])
  AND kd.followers_count >= t.min_followers AND (t.max_followers IS NULL OR kd.followers_count <= t.max_followers))`
/** Tidak jatuh di band mana pun (follower NULL, di bawah band terkecil, atau di celah). */
const NO_BAND = `NOT EXISTS (SELECT 1 FROM public.kol_tiers t
  WHERE kd.followers_count >= t.min_followers AND (t.max_followers IS NULL OR kd.followers_count <= t.max_followers))`
/** ER yang dipakai filter: nol, negatif, dan >100% dibuang (BE-05). */
const ER_OK = `kd.engagement_rate > 0 AND kd.engagement_rate <= 100`
/** Sama dengan escaping filter: `%`, `_` dan `\` dicari sebagai huruf biasa. */
const lit = (s: string) => s.replace(/[\\%_]/g, c => `\\${c}`)
/** Kolom yang dicari keyword search (BE-03), `$n` sudah di-escape. */
// The label is tenant data: it is searched only for the viewing agency's own
// active link (`$v`). Without a viewer, no label matches at all.
const SEARCH = (n: number, v?: number) => `(
     kd.username ILIKE '%' || $${n} || '%'
  OR kd.username_normalized ILIKE '%' || $${n} || '%'
  OR kd.bio ILIKE '%' || $${n} || '%'
  OR EXISTS (SELECT 1 FROM public.kol_categories kc WHERE kc.id = ANY (${CAT_IDS}) AND kc.name ILIKE '%' || $${n} || '%')${v ? `
  OR EXISTS (SELECT 1 FROM public.agency_kol_accounts a WHERE a.kol_account_id = kd.id
               AND a.agency_id = $${v}::uuid AND a.is_active IS TRUE AND a.label ILIKE '%' || $${n} || '%')` : ''})`
const PLATFORM = (n: number) => `kd.platform_id = (SELECT pl.id FROM public.platforms pl WHERE pl.key = $${n})`

async function main() {
  const { rows: [ro] } = await db.query<{ transaction_read_only: string }>('SHOW transaction_read_only')
  ok('sesi KOL read-only', ro?.transaction_read_only === 'on')

  const ROSTER = await count('TRUE')
  console.log(`Roster aktif saat ini (SQL): ${ROSTER.toLocaleString('id-ID')}`)
  eq('tanpa filter = seluruh roster aktif', (await listKolDirectory({ pageSize: 1 })).total, ROSTER)

  /* ── BE-05 — Engagement Rate ──────────────────────────────────────────── */
  console.log('\n── BE-05 Engagement Rate ──')

  // Filter minEr terkecil yang masih di atas 0 mengambil seluruh baris ber-ER.
  // minEr=0 tidak bisa: predikatnya `>=`, jadi 0 ikut menarik baris yang justru
  // dibuang.
  const erAll = await listKolDirectory({ minErPct: 0.0001, pageSize: 60, sort: 'engagement' })
  eq('total ER bersih = SQL (0 < ER <= 100)', erAll.total, await count(`${ER_OK} AND kd.engagement_rate >= 0.0001`))

  for (const t of [0.5, 3, 100, 101]) {
    const r = await listKolDirectory({ minErPct: t, pageSize: 1 })
    eq(`minEr ${t} = SQL (NULL dan >100% tidak ikut)`, r.total, await count(`${ER_OK} AND kd.engagement_rate >= $1`, [t]))
  }

  const top = erAll.rows
  ok('tidak ada erPct > 100 di halaman teratas sort=engagement',
    top.every(r => r.erPct === null || r.erPct <= 100),
    `maks ${Math.max(...top.map(r => r.erPct ?? 0))}`)

  // Outlier >100% dipilih dari database, bukan dari daftar nama.
  const { rows: outliers } = await db.query<{ id: string; username: string; er: string }>(`
    SELECT kd.id, kd.username, kd.engagement_rate::text AS er FROM public.kol_directory kd
     WHERE kd.directory_status = 'active' AND kd.engagement_rate > 100 ORDER BY kd.engagement_rate DESC`)
  console.log(`  ${outliers.length} outlier >100% di roster`)
  const leaked = top.filter(r => outliers.some(o => o.id === r.id)).map(r => r.username)
  ok('outlier >100% tidak muncul di baris teratas', leaked.length === 0, leaked.join(', '))
  if (outliers.length) {
    // Tetap ada di roster, dan nilai mentahnya tetap bisa diaudit — dibuang dari
    // metrik, bukan dari database.
    const got = await listKolDirectory({ ids: outliers.map(o => o.id), pageSize: outliers.length })
    eq('setiap outlier masih ada di roster', got.total, outliers.length)
    ok('erPct outlier null (dibuang)', got.rows.every(r => r.erPct === null))
    ok('erRaw outlier = nilai mentah di database (auditable)',
      got.rows.every(r => r.erRaw === Number(outliers.find(o => o.id === r.id)?.er)),
      got.rows.slice(0, 3).map(r => `@${r.username} ${r.erRaw}`).join(', '))
    ok('erQuality outlier null', got.rows.every(r => r.erQuality === null))
  } else {
    console.log('  (tidak ada outlier >100% saat ini — assertion outlier tidak berlaku)')
  }

  // Suspect atas seluruh roster, bukan cuma halaman ini: epsilon di atas ambang
  // supaya predikat `>=` milik minEr menirukan `>` milik erQualityOf.
  const suspectAll = await listKolDirectory({ minErPct: ER_SUSPECT_MIN + 0.0000001, pageSize: 1 })
  eq(`erQuality suspect (> ${ER_SUSPECT_MIN}%) = SQL`, suspectAll.total,
    await count(`${ER_OK} AND kd.engagement_rate > $1`, [ER_SUSPECT_MIN]))

  const suspect = erAll.rows.filter(r => r.erQuality === 'suspect')
  ok('erQuality suspect hanya untuk ER di atas ambang',
    suspect.every(r => (r.erPct ?? 0) > ER_SUSPECT_MIN),
    `${suspect.length} dari ${erAll.rows.length} baris halaman ini`)
  ok('erQuality measured untuk ER wajar',
    erAll.rows.filter(r => r.erQuality === 'measured').every(r => (r.erPct ?? 0) <= ER_SUSPECT_MIN))

  // minEr kosong ≠ minEr 0: yang pertama tidak memfilter apa pun.
  eq('minEr absent = tanpa filter (roster penuh)', (await listKolDirectory({ pageSize: 1 })).total, ROSTER)

  /* ── BE-03 — Keyword Search ───────────────────────────────────────────── */
  console.log('\n── BE-03 Keyword Search ──')

  const searchTotal = async (q: string) => count(SEARCH(1), [lit(q)])

  // Nama tampilan (label agency) yang BERBEDA dari username — dipilih dari data
  // dengan aturan displayName yang sama: label dari link AKTIF milik agency yang
  // melihat. Label adalah data tenant, jadi pencarian dan tampilannya diuji
  // dari sudut agency pemilik link itu.
  const { rows: [named] } = await db.query<{ id: string; username: string; label: string; agency_id: string }>(`
    SELECT kd.id, kd.username, trim(a.label) AS label, a.agency_id::text AS agency_id
      FROM public.kol_directory kd
      JOIN public.agency_kol_accounts a ON a.kol_account_id = kd.id AND a.is_active IS TRUE
      JOIN public.agencies ag ON ag.id = a.agency_id AND ag.deleted_at IS NULL
     WHERE kd.directory_status = 'active' AND a.label IS NOT NULL
       AND lower(trim(a.label)) <> lower(kd.username)
       AND position(lower(trim(a.label)) IN lower(kd.username)) = 0
       AND length(trim(a.label)) >= 4 AND trim(a.label) ~ ' '
     ORDER BY kd.id, a.agency_id LIMIT 1`)
  ok('ada creator dengan nama tampilan berbeda dari username untuk diuji', !!named)
  if (named) {
    const viewerAgencyId = named.agency_id
    const byLabel = await listKolDirectory({ q: named.label, viewerAgencyId, pageSize: 1 })
    eq(`q="${named.label}" (nama tampilan, agency pemilik) = SQL`, byLabel.total,
      await count(SEARCH(1, 2), [lit(named.label), viewerAgencyId]))
    eq(`q nama tampilan menemukan @${named.username}`,
      (await listKolDirectory({ q: named.label, ids: [named.id], viewerAgencyId, pageSize: 1 })).total, 1)
    eq('q tidak peka huruf besar/kecil',
      (await listKolDirectory({ q: named.label.toUpperCase(), ids: [named.id], viewerAgencyId, pageSize: 1 })).total, 1)
    // Tanpa agency yang melihat, label tidak dicari sama sekali.
    eq(`q="${named.label}" tanpa viewer = SQL tanpa label`,
      (await listKolDirectory({ q: named.label, pageSize: 1 })).total, await searchTotal(named.label))
    // displayName ikut terisi untuk agency pemilik, karena hasil yang bisa dicari
    // lewat nama harus bisa menampilkan nama itu.
    const row = (await listKolDirectory({ ids: [named.id], viewerAgencyId, pageSize: 1 })).rows[0]
    eq('displayName terisi dari label milik agency yang melihat', row?.displayName ?? null, named.label)
  }

  // Potongan username (partial match), dari username nyata.
  const { rows: [someone] } = await db.query<{ id: string; username: string }>(`
    SELECT kd.id, kd.username FROM public.kol_directory kd
     WHERE kd.directory_status = 'active' AND length(kd.username) >= 8 AND kd.username ~ '^[a-z0-9]+$'
     ORDER BY kd.id LIMIT 1`)
  if (someone) {
    const part = someone.username.slice(2, 7)
    const partial = await listKolDirectory({ q: part, pageSize: 60 })
    eq(`q="${part}" (potongan username) = SQL`, partial.total, await searchTotal(part))
    eq(`q potongan menemukan @${someone.username}`,
      (await listKolDirectory({ q: part, ids: [someone.id], pageSize: 1 })).total, 1)
    ok('q tidak menghasilkan baris duplikat (semi-join, bukan join)',
      new Set(partial.rows.map(r => r.id)).size === partial.rows.length)
  } else {
    ok('ada username untuk uji partial match', false, 'tidak ketemu')
  }

  // Bio: kata dari bio yang tidak ada di username, kategori, maupun label.
  const { rows: bios } = await db.query<{ id: string; username: string; bio: string }>(`
    SELECT kd.id, kd.username, kd.bio FROM public.kol_directory kd
     WHERE kd.directory_status = 'active' AND kd.bio ~* '[a-z]{7,}' ORDER BY kd.id LIMIT 50`)
  let bioCase: { id: string; username: string; word: string } | null = null
  for (const b of bios) {
    for (const w of b.bio.toLowerCase().match(/[a-z]{7,}/g) ?? []) {
      if (b.username.toLowerCase().includes(w)) continue
      const { rows: [hit] } = await db.query<{ n: number }>(`
        SELECT count(*)::int AS n FROM public.kol_directory kd
         WHERE kd.id = $1 AND (kd.username_normalized ILIKE '%' || $2 || '%'
            OR EXISTS (SELECT 1 FROM public.kol_categories kc WHERE kc.id = ANY (${CAT_IDS}) AND kc.name ILIKE '%' || $2 || '%')
            OR EXISTS (SELECT 1 FROM public.agency_kol_accounts a WHERE a.kol_account_id = kd.id AND a.label ILIKE '%' || $2 || '%'))`,
        [b.id, w])
      if (hit.n === 0) { bioCase = { id: b.id, username: b.username, word: w }; break }
    }
    if (bioCase) break
  }
  ok('ada kata bio yang hanya cocok lewat bio untuk diuji', !!bioCase)
  if (bioCase) {
    eq(`q="${bioCase.word}" (hanya ada di bio @${bioCase.username}) menemukannya`,
      (await listKolDirectory({ q: bioCase.word, ids: [bioCase.id], pageSize: 1 })).total, 1)
    eq(`q="${bioCase.word}" = SQL`, (await listKolDirectory({ q: bioCase.word, pageSize: 1 })).total,
      await searchTotal(bioCase.word))
  }

  // Wildcard harus literal, dan hasilnya sama dengan SQL yang meng-escape-nya.
  for (const q of ['100%', '_']) {
    const r = await listKolDirectory({ q, pageSize: 5 })
    eq(`"${q}" dicari sebagai huruf biasa = SQL`, r.total, await searchTotal(q))
    ok(`"${q}" bukan wildcard (tidak mengembalikan seluruh roster)`, r.total < ROSTER, `${r.total} hasil`)
  }

  const none = 'zzqqxx-tidak-ada-creator-ini'
  eq('q tanpa kecocokan = SQL', (await listKolDirectory({ q: none, pageSize: 1 })).total, await searchTotal(none))
  eq('q tanpa kecocokan → kosong', (await listKolDirectory({ q: none, pageSize: 1 })).total, 0)

  // Ranking: exact match di depan prefix match. Username yang menjadi awalan
  // username lain dipilih dari data.
  const { rows: [pre] } = await db.query<{ username: string }>(`
    SELECT kd.username FROM public.kol_directory kd
     WHERE kd.directory_status = 'active' AND kd.username ~ '^[a-z0-9]{4,}$'
       AND EXISTS (SELECT 1 FROM public.kol_directory o
                    WHERE o.directory_status = 'active' AND o.id <> kd.id
                      AND lower(o.username) LIKE lower(kd.username) || '_%')
     ORDER BY kd.username LIMIT 1`)
  if (pre) {
    const rank = await listKolDirectory({ q: pre.username, pageSize: 20 })
    const isExact = (r: { username: string }) => r.username.toLowerCase() === pre.username.toLowerCase()
    const firstLoose = rank.rows.findIndex(r => !isExact(r))
    const lastExact = rank.rows.map(isExact).lastIndexOf(true)
    ok(`exact match (@${pre.username}) berada di atas prefix match`,
      isExact(rank.rows[0] ?? { username: '' }) && (firstLoose === -1 || lastExact < firstLoose),
      rank.rows.slice(0, 3).map(r => '@' + r.username).join(', '))
  } else {
    ok('ada username yang menjadi awalan username lain untuk uji ranking', false, 'tidak ketemu')
  }

  /* ── BE-02 — Tier ─────────────────────────────────────────────────────── */
  console.log('\n── BE-02 Tier ──')

  const facets = await listKolFacets()
  const { rows: bands } = await db.query<{ name: string; min: number; max: number | null }>(`
    SELECT name, min_followers AS min, max_followers AS max FROM public.kol_tiers ORDER BY min_followers`)
  const tierSum = facets.tiers.reduce((n, t) => n + t.count, 0)
  eq('SUM(tiers.count) + untiered = seluruh roster', tierSum + facets.untiered, ROSTER)
  eq('facets.untiered = SQL (tanpa band)', facets.untiered, await count(NO_BAND))
  eq('jumlah band = baris kol_tiers', facets.tiers.length, bands.length)
  ok('batas setiap band = kol_tiers, bukan hardcode',
    bands.every(b => facets.tiers.some(t => t.name === b.name && t.min === b.min && t.max === b.max)),
    facets.tiers.map(t => `${t.name} ${t.min}-${t.max ?? '∞'}`).join(' | '))
  for (const t of facets.tiers) {
    eq(`facet ${t.name} = SQL`, t.count, await count(IN_BAND(1), [[t.name]]))
  }

  const micro = await listKolDirectory({ tiers: ['Micro'], pageSize: 60 })
  const microBand = facets.tiers.find(t => t.name === 'Micro')
  eq('filter Micro = SQL', micro.total, await count(IN_BAND(1), [['Micro']]))
  ok('semua baris Micro berada dalam range Micro',
    !!microBand && micro.rows.every(r => r.followers !== null
      && r.followers >= microBand.min && r.followers <= (microBand.max ?? Infinity)),
    `min ${Math.min(...micro.rows.map(r => r.followers ?? 0))}`)

  const macro = await listKolDirectory({ tiers: ['Macro'], pageSize: 1 })
  const both = await listKolDirectory({ tiers: ['Micro', 'Macro'], pageSize: 1 })
  eq('tier=Micro,Macro = SQL (gabungan)', both.total, await count(IN_BAND(1), [['Micro', 'Macro']]))
  eq('tier=Micro,Macro = Micro + Macro (band tidak beririsan)', both.total, micro.total + macro.total)

  const untiered = await listKolDirectory({ tiers: [UNTIERED], pageSize: 5 })
  eq('tier=__untiered = SQL (tanpa band)', untiered.total, await count(NO_BAND))
  ok('baris untiered tidak punya tier', untiered.rows.every(r => r.tier === null))

  // Facet mengikuti platform, dan tidak boleh melebihi roster platform itu.
  const igFacets = await listKolFacets({ platform: 'instagram' })
  const igTotal = facets.platforms.find(p => p.key === 'instagram')?.count ?? 0
  eq('roster Instagram di facet = SQL', igTotal, await count(PLATFORM(1), ['instagram']))
  const igTierSum = igFacets.tiers.reduce((n, t) => n + t.count, 0)
  eq('tier Instagram + untiered Instagram = roster Instagram', igTierSum + igFacets.untiered, igTotal)
  ok('setiap band Instagram <= band roster-wide',
    igFacets.tiers.every(t => t.count <= (facets.tiers.find(x => x.name === t.name)?.count ?? 0)))

  /* ── BE-01 — Kategori ─────────────────────────────────────────────────── */
  console.log('\n── BE-01 Kategori ──')

  // Kategori contoh diambil dari facet (yang terbanyak dan yang kedua), jadi uji
  // ini tidak bergantung pada nama kategori tertentu masih dipakai.
  const [catA, catB] = facets.categories.map(c => c.name)
  ok('facet punya minimal dua kategori untuk diuji', !!catA && !!catB, `${catA}, ${catB}`)

  const a = await listKolDirectory({ categories: [catA], pageSize: 60 })
  eq(`category=${catA} = SQL`, a.total, await count(HAS_CATEGORY(1), [[catA]]))
  ok(`setiap baris ${catA} benar-benar bertag ${catA}`, a.rows.every(r => r.categories.includes(catA)))

  const b = await listKolDirectory({ categories: [catB], pageSize: 1 })
  eq(`category=${catB} = SQL`, b.total, await count(HAS_CATEGORY(1), [[catB]]))

  const union = await listKolDirectory({ categories: [catA, catB], pageSize: 1 })
  eq(`${catA},${catB} = SQL (union, bukan irisan)`, union.total, await count(HAS_CATEGORY(1), [[catA, catB]]))
  ok('union tidak lebih kecil dari salah satu kategorinya', union.total >= Math.max(a.total, b.total))
  ok('union tidak lebih besar dari penjumlahan', union.total <= a.total + b.total)

  // Creator multi-kategori tidak boleh hilang dari chip mana pun yang ia bawa.
  const { rows: [multi] } = await db.query<{ id: string; username: string }>(`
    SELECT kd.id, kd.username FROM public.kol_directory kd
     WHERE kd.directory_status = 'active'
       AND (SELECT count(*) FROM public.kol_categories kc WHERE kc.id = ANY (${CAT_IDS})) > 1
     ORDER BY kd.id LIMIT 1`)
  if (multi) {
    const cats = (await listKolDirectory({ ids: [multi.id], pageSize: 1 })).rows[0]?.categories ?? []
    ok(`@${multi.username} membawa lebih dari satu kategori`, cats.length > 1, cats.join(', '))
    for (const cat of cats) {
      const hit = await listKolDirectory({ categories: [cat], ids: [multi.id], pageSize: 5 })
      ok(`@${multi.username} (${cats.length} kategori) muncul di chip "${cat}"`,
        hit.rows.some(r => r.id === multi.id))
    }
  } else {
    console.log('  (tidak ada creator multi-kategori saat ini — assertion multi-kategori tidak berlaku)')
  }

  const uncat = await listKolDirectory({ categories: [UNCATEGORIZED], pageSize: 5 })
  eq('category=__uncategorized = SQL (tanpa nama kategori)', uncat.total, await count(NO_CATEGORY))
  ok('baris uncategorized memang tanpa kategori', uncat.rows.every(r => r.categories.length === 0))
  eq('facets.uncategorized = SQL (category_ids dan category_id kosong)', facets.uncategorized,
    await count(`(kd.category_ids IS NULL OR cardinality(kd.category_ids) = 0) AND kd.category_id IS NULL`))
  eq('facets.uncategorized = filter __uncategorized', facets.uncategorized, uncat.total)

  // Facet memuat setiap nama kategori yang dipakai roster aktif, masing-masing
  // dengan jumlah creator yang sama dengan SQL.
  const { rows: usedNames } = await db.query<{ name: string; n: number }>(`
    SELECT kc.name, count(DISTINCT kd.id)::int AS n
      FROM public.kol_directory kd JOIN public.kol_categories kc ON kc.id = ANY (${CAT_IDS})
     WHERE kd.directory_status = 'active' GROUP BY kc.name`)
  eq('jumlah kategori di facet = nama kategori yang dipakai roster', facets.categories.length, usedNames.length)
  const facetOff = facets.categories.filter(c => c.count !== usedNames.find(u => u.name === c.name)?.n)
  ok('setiap count kategori di facet = SQL', facetOff.length === 0,
    facetOff.slice(0, 3).map(c => `${c.name} ${c.count}`).join(', '))
  ok('setiap kategori di facet punya count > 0', facets.categories.every(c => c.count > 0))

  const mixed = await listKolDirectory({ categories: [catA, UNCATEGORIZED], pageSize: 1 })
  eq(`${catA} + __uncategorized = SQL (union keduanya)`, mixed.total,
    await count(`(${HAS_CATEGORY(1)} OR ${NO_CATEGORY})`, [[catA]]))
  eq(`${catA} + __uncategorized = ${catA} + uncategorized (tidak beririsan)`, mixed.total, a.total + uncat.total)

  // Beberapa creator multi-kategori lagi (bukan cuma satu), dipilih dari data:
  // masing-masing harus muncul di setiap chip yang ia bawa.
  const { rows: multis } = await db.query<{ id: string; username: string; names: string[] }>(`
    SELECT kd.id, kd.username, array_agg(DISTINCT kc.name ORDER BY kc.name) AS names
      FROM public.kol_directory kd JOIN public.kol_categories kc ON kc.id = ANY (${CAT_IDS})
     WHERE kd.directory_status = 'active'
     GROUP BY kd.id, kd.username HAVING count(DISTINCT kc.name) > 1
     ORDER BY kd.id LIMIT 5`)
  for (const m of multis) {
    const got = (await listKolDirectory({ ids: [m.id], pageSize: 1 })).rows[0]?.categories ?? []
    eq(`@${m.username}: kategori di baris = SQL`, JSON.stringify([...got].sort()), JSON.stringify(m.names))
    const hits = await Promise.all(m.names.map(n => listKolDirectory({ categories: [n], ids: [m.id], pageSize: 1 })))
    ok(`@${m.username} muncul di setiap chip kategorinya (${m.names.length})`, hits.every(h => h.total === 1))
  }

  // Kategori yang tidak dipakai satu pun creator aktif — kategori master sungguhan
  // (bila ada) dan nama yang tidak ada — mengembalikan 0, bukan error.
  const { rows: [unused] } = await db.query<{ name: string }>(`
    SELECT kc.name FROM public.kol_categories kc
     WHERE NOT EXISTS (SELECT 1 FROM public.kol_directory kd
                        WHERE kd.directory_status = 'active' AND kc.id = ANY (${CAT_IDS}))
     ORDER BY kc.name LIMIT 1`)
  if (unused) {
    eq(`kategori master tanpa creator aktif ("${unused.name}") = SQL`,
      (await listKolDirectory({ categories: [unused.name], pageSize: 1 })).total,
      await count(HAS_CATEGORY(1), [[unused.name]]))
  }
  const ghost = '__kategori_yang_tidak_ada__'
  eq('nama kategori yang tidak ada → 0', (await listKolDirectory({ categories: [ghost], pageSize: 1 })).total, 0)

  // Paging penuh satu kategori: tidak ada creator ganda antarhalaman, dan
  // himpunan id-nya persis sama dengan SQL.
  const seen: string[] = []
  const pages = Math.ceil(a.total / 60)
  for (let pg = 1; pg <= pages; pg++) {
    const r = await listKolDirectory({ categories: [catA], page: pg, pageSize: 60, sort: 'name', dir: 'asc' })
    seen.push(...r.rows.map(x => x.id))
  }
  eq(`${catA}: tidak ada creator ganda di seluruh halaman`, new Set(seen).size, seen.length)
  const { rows: truthIds } = await db.query<{ id: string }>(`
    SELECT kd.id FROM public.kol_directory kd WHERE kd.directory_status = 'active' AND ${HAS_CATEGORY(1)}`, [[catA]])
  const truthSet = new Set(truthIds.map(r => r.id))
  ok(`${catA}: himpunan id dari semua halaman = SQL`,
    seen.length === truthSet.size && seen.every(id => truthSet.has(id)), `${seen.length} vs ${truthSet.size}`)

  // Keyword + kategori, dan platform + kategori: AND.
  const { rows: [member] } = await db.query<{ username: string }>(`
    SELECT kd.username FROM public.kol_directory kd
     WHERE kd.directory_status = 'active' AND ${HAS_CATEGORY(1)} AND kd.username ~ '^[a-z0-9]{6,}$'
     ORDER BY kd.id LIMIT 1`, [[catA]])
  if (member) {
    const kw = member.username.slice(1, 4)
    eq(`q="${kw}" + category=${catA} = SQL (AND)`,
      (await listKolDirectory({ q: kw, categories: [catA], pageSize: 1 })).total,
      await count(`${SEARCH(1)} AND ${HAS_CATEGORY(2)}`, [lit(kw), [catA]]))
  }
  for (const pl of facets.platforms.map(p => p.key)) {
    eq(`platform=${pl} + category=${catA} = SQL (AND)`,
      (await listKolDirectory({ platform: pl, categories: [catA], pageSize: 1 })).total,
      await count(`${PLATFORM(1)} AND ${HAS_CATEGORY(2)}`, [pl, [catA]]))
  }

  // Filter kategori tidak mengubah urutan: tetap per provenance, lalu followers
  // menurun dengan NULL di akhir.
  const catSorted = await listKolDirectory({ categories: [catA], sort: 'followers', dir: 'desc', pageSize: 60 })
  const PROV: Record<string, number> = { Live: 0, Calculated: 1 }
  ok(`${catA} sort=followers desc tetap berurutan`, catSorted.rows.every((r, i) => {
    if (i === 0) return true
    const p = catSorted.rows[i - 1]
    const gp = PROV[p.status] ?? 2, gr = PROV[r.status] ?? 2
    if (gp !== gr) return gp < gr
    if (p.followers === null) return r.followers === null
    return r.followers === null || p.followers >= r.followers
  }), catSorted.rows.slice(0, 3).map(r => `${r.status} ${r.followers}`).join(', '))

  // Parameter dan chip: kategori terpilih masuk ke `category`, reset
  // mengosongkannya, dan chip "applied" menghapus hanya kategorinya sendiri.
  eq('tanpa kategori: tidak ada parameter category', filtersToParams(KOL_FILTERS_DEFAULT).category, undefined)
  eq('dua kategori → category=a,b', filtersToParams({ ...KOL_FILTERS_DEFAULT, categories: [catA, catB] }).category,
    `${catA},${catB}`)
  const chips = appliedFilters({ ...KOL_FILTERS_DEFAULT, categories: [catA, catB] })
  const chipA = chips.find(c => c.label === catA)
  ok('setiap kategori terpilih punya chip applied', !!chipA && chips.some(c => c.label === catB))
  eq('menghapus chip satu kategori menyisakan yang lain',
    JSON.stringify(chipA?.clear.categories), JSON.stringify([catB]))

  /* ── BE-04 — Section Tabs ─────────────────────────────────────────────── */
  console.log('\n── BE-04 Section Tabs ──')

  // Tanggal batas ditentukan tes; jumlahnya dihitung dari database.
  const WINDOW = new Date('2026-08-07T00:00:00Z')
  const created = await listKolDirectory({ createdAfter: WINDOW, pageSize: 5 })
  const createdSql = await count(`kd.created_at >= $1`, [WINDOW])
  eq('createdAfter=2026-08-07 = SQL (created_at)', created.total, createdSql)
  const refreshed = await listKolDirectory({ refreshedAfter: WINDOW, pageSize: 5 })
  const refreshedSql = await count(`kd.last_refreshed_at >= $1`, [WINDOW])
  eq('refreshedAfter=2026-08-07 = SQL (last_refreshed_at)', refreshed.total, refreshedSql)
  // Dua kolom yang berbeda: kalau datanya membedakan keduanya, hasil filternya
  // juga harus berbeda.
  ok('Recently Added dan Recently Updated membaca kolom yang berbeda',
    createdSql === refreshedSql || created.total !== refreshed.total,
    `created ${createdSql}, refreshed ${refreshedSql}`)

  const cutoff = new Date(Date.now() - 30 * 864e5)
  eq('refreshedAfter 30 hari terakhir = SQL', (await listKolDirectory({ refreshedAfter: cutoff, pageSize: 1 })).total,
    await count(`kd.last_refreshed_at >= $1`, [cutoff]))

  const noDates = await listKolDirectory({ createdAfter: null, refreshedAfter: null, pageSize: 1 })
  eq('parameter tanggal kosong = tanpa filter', noDates.total, ROSTER)

  const sortCreated = await listKolDirectory({ sort: 'created', dir: 'desc', pageSize: 5 })
  ok('sort=created masih jalan (backward compatible)', sortCreated.rows.length === Math.min(5, ROSTER))
  const sortUpdated = await listKolDirectory({ sort: 'updated', dir: 'desc', pageSize: 5 })
  const sortRecent5 = await listKolDirectory({ sort: 'recent', dir: 'desc', pageSize: 5 })
  ok('sort=updated adalah alias sort=recent, bukan implementasi kedua',
    JSON.stringify(sortUpdated.rows.map(r => r.id)) === JSON.stringify(sortRecent5.rows.map(r => r.id)))
  // Kontrak urutan: kelompok provenance dulu (Live → Calculated → Estimated),
  // lalu kolom yang diminta di dalam kelompok itu.
  const GROUP: Record<string, number> = { Live: 0, Calculated: 1 }
  const grp = (s: string) => GROUP[s] ?? 2
  const ordered = (rows: { status: string; lastRefreshedAt: string | null }[], dir: 'asc' | 'desc') =>
    rows.every((r, i) => {
      if (i === 0) return true
      const p = rows[i - 1]
      if (grp(p.status) !== grp(r.status)) return grp(p.status) < grp(r.status)
      if (!p.lastRefreshedAt || !r.lastRefreshedAt) return true
      return dir === 'desc' ? p.lastRefreshedAt >= r.lastRefreshedAt : p.lastRefreshedAt <= r.lastRefreshedAt
    })
  const sortRecent = await listKolDirectory({ sort: 'recent', dir: 'desc', pageSize: 20 })
  ok('sort=recent desc: per provenance, lalu last_refreshed_at menurun', ordered(sortRecent.rows, 'desc'),
    sortRecent.rows.slice(0, 2).map(r => `${r.status} ${r.lastRefreshedAt}`).join(' , '))
  const sortAsc = await listKolDirectory({ sort: 'recent', dir: 'asc', pageSize: 20 })
  ok('sort=recent asc: per provenance, lalu last_refreshed_at menaik', ordered(sortAsc.rows, 'asc'),
    sortAsc.rows.slice(0, 2).map(r => `${r.status} ${r.lastRefreshedAt}`).join(' , '))
  // Baris pertama = timestamp terbaru di kelompok provenance teratas yang ada,
  // dengan aturan provenance yang ditulis ulang di SQL.
  const { rows: [newest] } = await db.query<{ ts: string }>(`
    WITH g AS (
      SELECT kd.last_refreshed_at,
             CASE WHEN kd.last_refreshed_at >= now() - interval '7 days' THEN 0
                  WHEN kd.scrape_status = 'success' THEN 1 ELSE 2 END AS grp
        FROM public.kol_directory kd WHERE kd.directory_status = 'active')
    SELECT max(last_refreshed_at) AS ts FROM g WHERE grp = (SELECT min(grp) FROM g)`)
  eq('baris pertama sort=recent desc = timestamp terbaru di kelompok teratas (SQL)',
    sortRecent.rows[0]?.lastRefreshedAt ? new Date(sortRecent.rows[0].lastRefreshedAt).getTime() : null,
    newest?.ts ? new Date(newest.ts).getTime() : null)

  /* ── Kombinasi, paging, input kosong ──────────────────────────────────── */
  console.log('\n── Kombinasi & paging ──')

  const combo = await listKolDirectory({
    categories: [catA], tiers: ['Micro'], platform: 'instagram', minErPct: 1, pageSize: 20,
  })
  eq('kombinasi 4 filter (AND) = SQL', combo.total,
    await count(`${HAS_CATEGORY(1)} AND ${IN_BAND(2)} AND ${PLATFORM(3)} AND ${ER_OK} AND kd.engagement_rate >= 1`,
      [[catA], ['Micro'], 'instagram']))
  ok('kombinasi menyempit', combo.total <= a.total && combo.total <= micro.total, `${combo.total} hasil`)
  ok('setiap baris kombinasi memenuhi keempat syarat',
    combo.rows.every(r => r.categories.includes(catA) && r.tier === 'Micro'
      && r.platform === 'instagram' && (r.erPct ?? 0) >= 1))

  const p1 = await listKolDirectory({ categories: [catA], page: 1, pageSize: 10, sort: 'name', dir: 'asc' })
  const p2 = await listKolDirectory({ categories: [catA], page: 2, pageSize: 10, sort: 'name', dir: 'asc' })
  eq('total sama di setiap halaman', p1.total, p2.total)
  ok('halaman 2 tidak mengulang halaman 1', !p1.rows.some(x => p2.rows.some(y => y.id === x.id)))
  eq('pageSize dihormati', p1.rows.length, Math.min(10, p1.total))

  const empty = await listKolDirectory({
    q: '', categories: [], tiers: [], platform: '', minErPct: null, pageSize: 1,
  })
  eq('semua filter kosong = roster penuh', empty.total, ROSTER)

  const idsEmpty = await listKolDirectory({ ids: [], pageSize: 1 })
  eq('ids kosong = bukan "tidak ada hasil"', idsEmpty.total, ROSTER)

  /* ── No. 14b — Direct Engagement Rate (kol_directory.engagement_rate) ── */
  console.log('\n── No. 14b Direct Engagement Rate ──')

  // Batas persis: satu nilai ER nyata dari database. Kolomnya numeric(5,2),
  // jadi +0,005 sudah pasti di atas nilai itu.
  const { rows: [atV] } = await db.query<{ v: string }>(`
    SELECT kd.engagement_rate::text AS v FROM public.kol_directory kd
     WHERE kd.directory_status = 'active' AND ${ER_OK} AND kd.engagement_rate >= 1
     GROUP BY kd.engagement_rate ORDER BY count(*) DESC, kd.engagement_rate LIMIT 1`)
  if (atV) {
    const v = Number(atV.v)
    const { rows: atIds } = await db.query<{ id: string }>(`
      SELECT kd.id FROM public.kol_directory kd WHERE kd.directory_status = 'active' AND kd.engagement_rate = $1`, [v])
    const ids = atIds.map(r => r.id)
    eq(`minEr ${v} (tepat di nilai) menyertakan creator ber-ER ${v}`,
      (await listKolDirectory({ minErPct: v, ids, pageSize: 60 })).total, ids.length)
    eq(`minEr ${v + 0.005} (sedikit di atas) mengecualikan mereka`,
      (await listKolDirectory({ minErPct: v + 0.005, ids, pageSize: 60 })).total, 0)
    eq(`minEr ${v - 0.005} (sedikit di bawah) = SQL`,
      (await listKolDirectory({ minErPct: v - 0.005, pageSize: 1 })).total,
      await count(`${ER_OK} AND kd.engagement_rate >= $1`, [v - 0.005]))
  }

  // 0, >100% dan NULL: tetap ada di roster tanpa filter, tidak pernah lolos
  // filter ER, dan erPct mereka null (dibuang dari metrik, bukan dari database).
  const pick = async (where: string) => (await db.query<{ id: string }>(`
    SELECT kd.id FROM public.kol_directory kd WHERE kd.directory_status = 'active' AND ${where} ORDER BY kd.id LIMIT 60`)).rows.map(r => r.id)
  for (const [label, where] of [
    ['ER = 0', 'kd.engagement_rate = 0'], ['ER > 100', 'kd.engagement_rate > 100'],
    ['ER < 0', 'kd.engagement_rate < 0'], ['ER NULL', 'kd.engagement_rate IS NULL'],
  ] as const) {
    const ids = await pick(where)
    if (!ids.length) { console.log(`  (${label}: tidak ada di data saat ini)`); continue }
    const off = await listKolDirectory({ ids, pageSize: 60 })
    eq(`${label}: tetap muncul tanpa filter`, off.total, ids.length)
    ok(`${label}: erPct null`, off.rows.every(r => r.erPct === null))
    eq(`${label}: tidak pernah lolos filter ER`, (await listKolDirectory({ ids, minErPct: 0.0001, pageSize: 60 })).total, 0)
  }

  // Per platform dan AND dengan filter lain.
  for (const pl of facets.platforms.map(p => p.key)) {
    for (const t of [0.5, 3]) {
      eq(`minEr ${t} + platform=${pl} = SQL`,
        (await listKolDirectory({ minErPct: t, platform: pl, pageSize: 1 })).total,
        await count(`${ER_OK} AND kd.engagement_rate >= $1 AND ${PLATFORM(2)}`, [t, pl]))
    }
  }
  eq(`minEr 1 + category=${catA} = SQL (AND)`,
    (await listKolDirectory({ minErPct: 1, categories: [catA], pageSize: 1 })).total,
    await count(`${ER_OK} AND kd.engagement_rate >= 1 AND ${HAS_CATEGORY(1)}`, [[catA]]))
  if (member) {
    const kw = member.username.slice(1, 4)
    eq(`minEr 0.5 + q="${kw}" = SQL (AND)`,
      (await listKolDirectory({ minErPct: 0.5, q: kw, pageSize: 1 })).total,
      await count(`${ER_OK} AND kd.engagement_rate >= 0.5 AND ${SEARCH(1)}`, [lit(kw)]))
  }

  // Paging penuh: himpunan id = SQL, tanpa duplikat.
  const erIds: string[] = []
  const er3 = await listKolDirectory({ minErPct: 3, pageSize: 1 })
  for (let pg = 1; pg <= Math.ceil(er3.total / 60); pg++) {
    erIds.push(...(await listKolDirectory({ minErPct: 3, page: pg, pageSize: 60, sort: 'name', dir: 'asc' })).rows.map(r => r.id))
  }
  const { rows: er3Truth } = await db.query<{ id: string }>(`
    SELECT kd.id FROM public.kol_directory kd WHERE kd.directory_status = 'active' AND ${ER_OK} AND kd.engagement_rate >= 3`)
  const er3Set = new Set(er3Truth.map(r => r.id))
  eq('minEr 3: tidak ada creator ganda antarhalaman', new Set(erIds).size, erIds.length)
  ok('minEr 3: himpunan id dari semua halaman = SQL', erIds.length === er3Set.size && erIds.every(id => er3Set.has(id)),
    `${erIds.length} vs ${er3Set.size}`)

  // Urutan sort=engagement: per provenance, lalu erPct menurun, NULL di akhir.
  const byEr = await listKolDirectory({ sort: 'engagement', dir: 'desc', pageSize: 60 })
  const PROV_ER: Record<string, number> = { Live: 0, Calculated: 1 }
  ok('sort=engagement desc: per provenance, lalu erPct menurun (NULL di akhir)', byEr.rows.every((r, i) => {
    if (i === 0) return true
    const p = byEr.rows[i - 1]
    const gp = PROV_ER[p.status] ?? 2, gr = PROV_ER[r.status] ?? 2
    if (gp !== gr) return gp < gr
    if (p.erPct === null) return r.erPct === null
    return r.erPct === null || p.erPct >= r.erPct
  }), byEr.rows.slice(0, 3).map(r => `${r.status} ${r.erPct}`).join(', '))

  // Unit: slider UI dalam persen, dikirim apa adanya (tanpa dikali/dibagi 100),
  // karena kolomnya disimpan dalam poin persen.
  eq('erMin 3 (UI %) → minEr=3 (tanpa konversi)', filtersToParams({ ...KOL_FILTERS_DEFAULT, erMin: 3 }).minEr, '3')
  eq('erMin 0.5 → minEr=0.5', filtersToParams({ ...KOL_FILTERS_DEFAULT, erMin: 0.5 }).minEr, '0.5')
  eq('erMin 0 → tanpa parameter minEr', filtersToParams(KOL_FILTERS_DEFAULT).minEr, undefined)
  eq('activeFilterCount menghitung erMin', activeFilterCount({ ...KOL_FILTERS_DEFAULT, erMin: 3 }), 1)
  const erChip = appliedFilters({ ...KOL_FILTERS_DEFAULT, erMin: 3 }).find(c => c.key === 'erMin')
  ok('chip applied "ER ≥ 3.0%" menghapus hanya erMin', erChip?.label === 'ER ≥ 3.0%'
    && erChip.clear.erMin === 0 && Object.keys(erChip.clear).length === 1, erChip?.label)
  eq('default (Clear all) = erMin 0', KOL_FILTERS_DEFAULT.erMin, 0)

  /* ── No. 5 — Verified only → Connected creators only ─────────────────── */
  console.log('\n── No. 5 Connected creators only ──')

  // Aturan yang ditulis ulang: creator punya social_account dengan
  // platform_user_id DAN oauth_token (koneksi OAuth). Bukan centang biru
  // (`kol_directory.verified_status`), dan bukan `social_account.connected`.
  // NULL di salah satu kolom berarti tidak terhubung.
  const CONNECTED_SQL = `EXISTS (SELECT 1 FROM public.kol_social_account k
    JOIN public.social_account sa ON sa.id = k.social_account_id
    WHERE k.kol_id = kd.id AND sa.platform_user_id IS NOT NULL AND sa.oauth_token IS NOT NULL)`
  const connectedSql = await count(CONNECTED_SQL)
  console.log(`  ${connectedSql} creator terhubung menurut SQL (0 berarti connect flow belum berjalan)`)

  eq('OFF = seluruh roster', (await listKolDirectory({ connectedOnly: false, pageSize: 1 })).total, ROSTER)
  const conn = await listKolDirectory({ connectedOnly: true, pageSize: 60 })
  eq('ON = SQL (platform_user_id DAN oauth_token)', conn.total, connectedSql)
  ok('ON: setiap baris connected', conn.rows.every(r => r.connected === true))

  // Kelengkapan dan tanpa duplikat: himpunan id dari semua halaman = SQL.
  const connIds: string[] = []
  for (let pg = 1; pg <= Math.ceil(conn.total / 60); pg++) {
    connIds.push(...(await listKolDirectory({ connectedOnly: true, page: pg, pageSize: 60, sort: 'name', dir: 'asc' }))
      .rows.map(r => r.id))
  }
  const { rows: connTruth } = await db.query<{ id: string }>(`
    SELECT kd.id FROM public.kol_directory kd WHERE kd.directory_status = 'active' AND ${CONNECTED_SQL}`)
  eq('ON: tidak ada creator ganda antarhalaman', new Set(connIds).size, connIds.length)
  ok('ON: himpunan id = SQL (lengkap)', connIds.length === connTruth.length
    && connTruth.every(t => connIds.includes(t.id)), `${connIds.length} vs ${connTruth.length}`)

  // NULL tidak dianggap terhubung: nilai `connected` di setiap baris halaman
  // tanpa filter harus sama dengan aturan SQL untuk creator itu.
  const offPage = await listKolDirectory({ pageSize: 60, sort: 'name', dir: 'asc' })
  const { rows: offTruth } = await db.query<{ id: string; c: boolean }>(`
    SELECT kd.id, ${CONNECTED_SQL} AS c FROM public.kol_directory kd WHERE kd.id = ANY ($1::uuid[])`,
  [offPage.rows.map(r => r.id)])
  ok('flag connected di setiap baris = aturan SQL (NULL → tidak terhubung)',
    offPage.rows.every(r => r.connected === offTruth.find(t => t.id === r.id)?.c))
  const { rows: flagOnly } = await db.query<{ id: string }>(`
    SELECT kd.id FROM public.kol_directory kd
     WHERE kd.directory_status = 'active' AND NOT ${CONNECTED_SQL}
       AND EXISTS (SELECT 1 FROM public.kol_social_account k JOIN public.social_account sa ON sa.id = k.social_account_id
                    WHERE k.kol_id = kd.id AND sa.connected IS TRUE)`)
  ok('social_account.connected=true tanpa OAuth tidak ikut dihitung',
    !flagOnly.some(f => connIds.includes(f.id)), `${flagOnly.length} creator seperti itu di data`)

  // AND dengan filter lain.
  for (const pl of facets.platforms.map(p => p.key)) {
    eq(`connected + platform=${pl} = SQL (AND)`,
      (await listKolDirectory({ connectedOnly: true, platform: pl, pageSize: 1 })).total,
      await count(`${CONNECTED_SQL} AND ${PLATFORM(1)}`, [pl]))
  }
  eq(`connected + category=${catA} = SQL (AND)`,
    (await listKolDirectory({ connectedOnly: true, categories: [catA], pageSize: 1 })).total,
    await count(`${CONNECTED_SQL} AND ${HAS_CATEGORY(1)}`, [[catA]]))
  if (member) {
    const kw = member.username.slice(1, 4)
    eq(`connected + q="${kw}" = SQL (AND)`,
      (await listKolDirectory({ connectedOnly: true, q: kw, pageSize: 1 })).total,
      await count(`${CONNECTED_SQL} AND ${SEARCH(1)}`, [lit(kw)]))
  }

  // Kontrol UI: parameter, badge, chip, dan reset.
  eq('connectedOnly → parameter connected=1', filtersToParams({ ...KOL_FILTERS_DEFAULT, connectedOnly: true }).connected, '1')
  eq('tanpa connectedOnly: tidak ada parameter connected', filtersToParams(KOL_FILTERS_DEFAULT).connected, undefined)
  eq('activeFilterCount menghitung connectedOnly', activeFilterCount({ ...KOL_FILTERS_DEFAULT, connectedOnly: true }), 1)
  const connChip = appliedFilters({ ...KOL_FILTERS_DEFAULT, connectedOnly: true }).find(c => c.key === 'connectedOnly')
  ok('chip applied "Connected only" ada dan menghapus hanya flag ini',
    connChip?.clear.connectedOnly === false && Object.keys(connChip.clear).length === 1)
  eq('default (Clear all) = connectedOnly false', KOL_FILTERS_DEFAULT.connectedOnly, false)

  /* ── UI -> API -> DB ─────────────────────────────────────────────────── */
  console.log('')
  console.log('── UI -> API -> DB ──')

  // Sentinel di klien dan di server adalah dua konstanta terpisah (modul server
  // memuat `pg` dan tidak boleh masuk bundle browser). Kalau nilainya bergeser,
  // chip berhenti mencocokkan tanpa error — jadi kesetaraannya diuji.
  eq('sentinel uncategorized klien == server', UI_UNCATEGORIZED, UNCATEGORIZED)
  eq('sentinel untiered klien == server', UI_UNTIERED, UNTIERED)

  /** Meniru parsing route: `a,b` dipecah kembali jadi union. */
  const throughRoute = (f: KolFilters) => {
    const p = filtersToParams(f)
    return listKolDirectory({
      categories: (p.category || '').split(',').map(v => v.trim()).filter(Boolean),
      tiers: (p.tier || '').split(',').map(v => v.trim()).filter(Boolean),
      platform: p.platform || null,
      minErPct: p.minEr ? Number(p.minEr) : null,
      minFollowers: p.follMin ? Number(p.follMin) : null,
      connectedOnly: p.connected === '1',
      minGrowth: p.growthMin ? Number(p.growthMin) : null,
      maxGrowth: p.growthMax ? Number(p.growthMax) : null,
      pageSize: 1,
    })
  }

  const catASql = await count(HAS_CATEGORY(1), [[catA]])
  eq(`UI 1 kategori (${catA}) -> SQL`, (await throughRoute({ ...KOL_FILTERS_DEFAULT, categories: [catA] })).total, catASql)

  const uiUnion = await throughRoute({ ...KOL_FILTERS_DEFAULT, categories: [catA, catB] })
  eq('UI 2 kategori -> union yang sama dengan panggilan langsung', uiUnion.total, union.total)

  const uiUncat = await throughRoute({ ...KOL_FILTERS_DEFAULT, categories: [UI_UNCATEGORIZED] })
  eq('UI chip "Tanpa kategori" -> SQL', uiUncat.total, await count(NO_CATEGORY))

  const uiTiers = await throughRoute({ ...KOL_FILTERS_DEFAULT, tiers: ['Micro', 'Macro'] })
  eq('UI 2 tier -> gabungan', uiTiers.total, micro.total + macro.total)

  const uiUntiered = await throughRoute({ ...KOL_FILTERS_DEFAULT, tiers: [UI_UNTIERED] })
  eq('UI chip "Untiered" -> SQL', uiUntiered.total, await count(NO_BAND))

  const uiEmpty = await throughRoute(KOL_FILTERS_DEFAULT)
  eq('UI tanpa filter -> roster penuh', uiEmpty.total, ROSTER)

  // Badge "filter aktif" tidak boleh ikut menghitung kategori (punya chip sendiri
  // di toolbar), tapi harus menghitung tier.
  eq('activeFilterCount abaikan kategori',
    activeFilterCount({ ...KOL_FILTERS_DEFAULT, categories: [catA] }), 0)
  eq('activeFilterCount hitung tier',
    activeFilterCount({ ...KOL_FILTERS_DEFAULT, tiers: ['Micro', 'Macro'] }), 1)

  // Saved list yang dibuat sebelum multi-select menyimpan string, bukan array.
  const legacy = normalizeKolFilters({ category: catA, tier: 'Micro', erMin: 3, connectedOnly: true })
  ok('saved list lama (string) dinaikkan jadi array',
    Array.isArray(legacy.categories) && legacy.categories[0] === catA
    && Array.isArray(legacy.tiers) && legacy.tiers[0] === 'Micro',
    JSON.stringify(legacy))
  eq('saved list lama mempertahankan nilai numerik', legacy.erMin, 3)
  // Yang diuji adalah kesetaraan makna, bukan jumlah hasilnya: list lama tidak
  // boleh menyaring BERBEDA dari list baru yang isinya sama.
  const legacyTotal = await throughRoute(legacy)
  const sameModern = await throughRoute({
    ...KOL_FILTERS_DEFAULT,
    categories: [catA], tiers: ['Micro'], erMin: 3, connectedOnly: true,
  })
  eq('saved list lama menyaring sama persis dengan list baru yang setara',
    legacyTotal.total, sameModern.total)
  const legacyLoose = await throughRoute(normalizeKolFilters({ category: catA }))
  eq('saved list lama satu-kategori tetap menyaring = SQL', legacyLoose.total, catASql)
  const junk = normalizeKolFilters({ categories: 'bukan array', tiers: null, erMin: 'x' })
  ok('input rusak jatuh ke default, bukan melempar',
    junk.categories.length === 1 && junk.tiers.length === 0 && junk.erMin === 0,
    JSON.stringify(junk))
  // Verified -> Connected: list lama TIDAK boleh membawa flag lamanya. Keduanya
  // menjawab pertanyaan berbeda, jadi menerjemahkannya bisa mengosongkan list
  // yang tadinya berisi.
  const legacyVerified = normalizeKolFilters({ category: catA, verifiedOnly: true })
  ok('flag verified lama dibuang, bukan diterjemahkan jadi connected',
    legacyVerified.connectedOnly === false, JSON.stringify(legacyVerified))
  eq('list lama tanpa flag verified tetap mengembalikan kategorinya = SQL',
    (await throughRoute(legacyVerified)).total, catASql)
  // Band growth: preset tak dikenal jatuh ke "Any", bukan ke band acak.
  ok('growth preset tak dikenal jatuh ke Any',
    normalizeKolFilters({ growth: 'entah' }).growth === '', '')

  // Section tabs: ketiga tab memakai kunci sort yang benar-benar ada.
  for (const key of ['followers', 'created', 'recent'] as const) {
    const r = await listKolDirectory({ sort: key, dir: 'desc', pageSize: 3 })
    ok(`section tab sort=${key} mengembalikan baris`, r.rows.length === Math.min(3, ROSTER), `${r.total} total`)
  }

  await db.end()
  console.log(bad === 0
    ? `\nSemua assertion lolos (${ROSTER} baris roster).`
    : `\n${bad} GAGAL`)
  process.exit(bad === 0 ? 0 : 1)
}

main().catch(e => {
  console.error('\nGAGAL menjalankan verifikasi:', e instanceof Error ? e.message : e)
  console.error('Database KOL hanya bisa dijangkau lewat VPN kantor.')
  process.exit(1)
})
