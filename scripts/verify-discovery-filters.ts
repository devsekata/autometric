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
 * Angka distribusi di sini diukur ulang pada 2026-09-08. Kalau distribusinya
 * bergeser, skrip ini akan gagal — itu memang yang diinginkan: angka yang
 * bergeser diam-diam lebih berbahaya daripada tes yang merah. Ukuran roster
 * sendiri dibaca saat runtime, karena "tanpa filter mengembalikan semuanya"
 * benar berapa pun isi roster-nya.
 *
 * MEMBUTUHKAN VPN kantor: seluruh assertion memanggil database KOL sungguhan
 * lewat `@/lib/kolDb`, sama seperti `verify:creators`.
 */

import {
  listKolDirectory, listKolFacets, UNCATEGORIZED, UNTIERED,
} from '../src/lib/discover/kolDirectory'
import {
  KOL_FILTERS_DEFAULT, activeFilterCount, filtersToParams, normalizeKolFilters,
  UNCATEGORIZED as UI_UNCATEGORIZED, UNTIERED as UI_UNTIERED,
  type KolFilters,
} from '../src/components/discover/KolDirectoryFilters'

let bad = 0
const ok = (label: string, cond: boolean, extra = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
}
const eq = (label: string, got: unknown, want: unknown) =>
  ok(label, got === want, got === want ? '' : `dapat ${got}, harusnya ${want}`)

/**
 * Ukuran roster aktif, dibaca dari database saat skrip jalan — bukan angka
 * tetap.
 *
 * Dulu ini `const ROSTER = 7720`, hasil pengukuran 2026-09-06. Begitu satu
 * creator ditambahkan lewat Add KOL (8 Sep 2026, `bobbykertanegara`), dua belas
 * assertion langsung merah — padahal tidak satu pun filter berubah perilaku.
 * Assertion yang berbunyi "tanpa filter = seluruh roster" adalah invariant
 * struktural: benar berapa pun isinya. Yang tetap literal di bawah hanyalah
 * angka *distribusi* — berapa yang punya ER, berapa yang tanpa kategori — karena
 * di situlah pergeseran diam-diam justru perlu ketahuan.
 */
let ROSTER = 0

async function main() {
  ROSTER = (await listKolDirectory({ pageSize: 1 })).total
  console.log(`Roster aktif saat ini: ${ROSTER.toLocaleString('id-ID')}`)

  /* ── BE-05 — Engagement Rate ──────────────────────────────────────────── */
  console.log('\n── BE-05 Engagement Rate ──')

  // Ambil seluruh baris ber-ER lewat filter minEr terkecil yang masih di atas 0.
  // Tidak bisa memakai minEr=0: predikatnya `>=`, jadi 0 akan ikut menarik baris
  // yang ER-nya justru sudah dibuang.
  const erAll = await listKolDirectory({ minErPct: 0.0001, pageSize: 60, sort: 'engagement' })
  // 1.756 terisi − 7 mustahil (>100%) − 6 nilai nol. Nol dibuang oleh aturan yang
  // sama: kolom ini tidak pernah menuliskan nol yang benar-benar terukur.
  // Distribusi, diukur ulang 2026-09-08 (naik 1 dari 1.743 karena satu creator
  // baru masuk lewat Add KOL dengan ER 4,00%).
  eq('total ER bersih = 1.744', erAll.total, 1744)

  const top = erAll.rows
  ok('tidak ada erPct > 100 di halaman teratas sort=engagement',
    top.every(r => r.erPct === null || r.erPct <= 100),
    `maks ${Math.max(...top.map(r => r.erPct ?? 0))}`)

  const outliers = ['rhasiebatara', 'nikma.rahmaa', 'faniaelizaa', 'winnylieyantii',
    'bjawato', 'skupingg', 'putrikurniads_']
  const leakedNames = top.filter(r => outliers.includes(r.username)).map(r => r.username)
  ok('7 outlier >100% tidak muncul di baris teratas', leakedNames.length === 0,
    leakedNames.join(', '))

  // Outlier tetap bisa ditemukan lewat search, dan nilai mentahnya tetap ada —
  // dibuang dari metrik, bukan dari database.
  const one = await listKolDirectory({ q: 'rhasiebatara', pageSize: 5 })
  const r0 = one.rows[0]
  ok('outlier masih ada di roster', !!r0, r0?.username)
  eq('erPct outlier null (dibuang)', r0?.erPct ?? null, null)
  eq('erRaw outlier tetap 223.41 (auditable)', r0?.erRaw ?? null, 223.41)
  eq('erQuality outlier null', r0?.erQuality ?? null, null)

  // Hitungan suspect atas seluruh roster, bukan cuma halaman ini: epsilon di atas
  // 20 supaya predikat `>=` milik minEr menirukan `> 20` milik erQualityOf.
  const suspectAll = await listKolDirectory({ minErPct: 20.0000001, pageSize: 1 })
  eq('erQuality suspect tepat 46 baris', suspectAll.total, 46)

  const suspect = erAll.rows.filter(r => r.erQuality === 'suspect')
  ok('erQuality suspect terisi untuk ER tinggi',
    suspect.length > 0 && suspect.every(r => (r.erPct ?? 0) > 20),
    `${suspect.length} dari ${erAll.rows.length} baris halaman ini`)
  ok('erQuality measured untuk ER wajar',
    erAll.rows.filter(r => r.erQuality === 'measured').every(r => (r.erPct ?? 0) <= 20))

  // minEr kosong ≠ minEr 0: yang pertama tidak memfilter apa pun.
  const noEr = await listKolDirectory({ pageSize: 1 })
  eq('minEr absent = tanpa filter (roster penuh)', noEr.total, ROSTER)

  /* ── BE-03 — Keyword Search ───────────────────────────────────────────── */
  console.log('\n── BE-03 Keyword Search ──')

  const byName = async (q: string) => (await listKolDirectory({ q, pageSize: 20 })).rows
  const finds = async (q: string, username: string) => {
    const rows = await byName(q)
    ok(`q="${q}" menemukan @${username}`,
      rows.some(r => r.username === username),
      rows.length ? `dapat ${rows.slice(0, 3).map(r => '@' + r.username).join(', ')}` : 'kosong')
  }
  await finds('Raffi Ahmad', 'raffinagita1717')
  await finds('Cristiano Ronaldo', 'cristiano')
  await finds('Messi', 'leomessi')

  // Regresi: pencarian username lama tidak boleh kehilangan hasil.
  const raffi = await listKolDirectory({ q: 'raffi', pageSize: 60 })
  ok('q="raffi" masih mengembalikan hasil username lama',
    raffi.rows.some(r => r.username.includes('raffi')), `${raffi.total} hasil`)
  ok('q="raffi" tidak menghasilkan baris duplikat (semi-join, bukan join)',
    new Set(raffi.rows.map(r => r.id)).size === raffi.rows.length)

  // displayName ikut terisi, karena hasil yang bisa dicari lewat nama harus bisa
  // menampilkan nama itu.
  const ronaldo = (await byName('Cristiano Ronaldo')).find(r => r.username === 'cristiano')
  eq('displayName terisi dari agency_kol_accounts.label',
    ronaldo?.displayName ?? null, 'Cristiano Ronaldo')

  // Wildcard harus literal.
  const pct = await listKolDirectory({ q: '100%', pageSize: 5 })
  ok('% diperlakukan literal, bukan wildcard', pct.total < ROSTER, `${pct.total} hasil`)
  const und = await listKolDirectory({ q: '_', pageSize: 5 })
  ok('_ diperlakukan literal, bukan wildcard', und.total < ROSTER, `${und.total} hasil`)

  // Ranking: exact match harus di depan prefix.
  const rank = await listKolDirectory({ q: 'cristiano', pageSize: 20 })
  ok('exact match berada di atas prefix match',
    rank.rows[0]?.username === 'cristiano',
    rank.rows.slice(0, 3).map(r => '@' + r.username).join(', '))

  /* ── BE-02 — Tier ─────────────────────────────────────────────────────── */
  console.log('\n── BE-02 Tier ──')

  const facets = await listKolFacets()
  const tierSum = facets.tiers.reduce((n, t) => n + t.count, 0)
  eq('SUM(tiers.count) + untiered = seluruh roster', tierSum + facets.untiered, ROSTER)
  eq('untiered = 526', facets.untiered, 526)
  eq('5 band dari kol_tiers', facets.tiers.length, 5)
  ok('batas band datang dari tabel, bukan hardcode',
    facets.tiers.some(t => t.name === 'Nano' && t.min === 1000 && t.max === 9999)
    && facets.tiers.some(t => t.name === 'Mega' && t.min === 1_000_000 && t.max === null),
    facets.tiers.map(t => `${t.name} ${t.min}-${t.max ?? '∞'}`).join(' | '))

  const micro = await listKolDirectory({ tiers: ['Micro'], pageSize: 60 })
  const microBand = facets.tiers.find(t => t.name === 'Micro')!
  eq('filter Micro cocok dengan count facet', micro.total, microBand.count)
  ok('semua baris Micro berada dalam range Micro',
    micro.rows.every(r => r.followers !== null
      && r.followers >= microBand.min && r.followers <= (microBand.max ?? Infinity)),
    `min ${Math.min(...micro.rows.map(r => r.followers ?? 0))}`)

  const macro = await listKolDirectory({ tiers: ['Macro'], pageSize: 1 })
  const both = await listKolDirectory({ tiers: ['Micro', 'Macro'], pageSize: 1 })
  eq('tier=Micro,Macro = gabungan keduanya', both.total, micro.total + macro.total)

  const untiered = await listKolDirectory({ tiers: [UNTIERED], pageSize: 5 })
  eq('tier=__untiered = 526', untiered.total, 526)
  ok('baris untiered tidak punya tier',
    untiered.rows.every(r => r.tier === null))

  // Facet mengikuti platform, dan tidak boleh melebihi roster platform itu.
  const igFacets = await listKolFacets({ platform: 'instagram' })
  const igTotal = facets.platforms.find(p => p.key === 'instagram')?.count ?? 0
  const igTierSum = igFacets.tiers.reduce((n, t) => n + t.count, 0)
  ok('count tier per-platform tidak melebihi roster platform',
    igTierSum + igFacets.untiered <= igTotal + 1,
    `${igTierSum} + ${igFacets.untiered} vs roster IG ${igTotal}`)
  ok('setiap band Instagram <= band roster-wide',
    igFacets.tiers.every(t => t.count <= (facets.tiers.find(x => x.name === t.name)?.count ?? 0)))

  /* ── BE-01 — Kategori ─────────────────────────────────────────────────── */
  console.log('\n── BE-01 Kategori ──')

  const beauty = await listKolDirectory({ categories: ['Beauty'], pageSize: 60 })
  eq('category=Beauty = 1.271', beauty.total, 1271)
  ok('setiap baris Beauty benar-benar bertag Beauty',
    beauty.rows.every(r => r.categories.includes('Beauty')))

  const lifestyle = await listKolDirectory({ categories: ['Lifestyle'], pageSize: 1 })
  eq('category=Lifestyle = 2.522', lifestyle.total, 2522)

  const union = await listKolDirectory({ categories: ['Beauty', 'Lifestyle'], pageSize: 1 })
  ok('Beauty,Lifestyle memakai union, bukan irisan',
    union.total > Math.max(beauty.total, lifestyle.total), `${union.total}`)
  ok('union lebih kecil dari penjumlahan (ada creator yang punya keduanya)',
    union.total < beauty.total + lifestyle.total,
    `${union.total} < ${beauty.total} + ${lifestyle.total}`)

  // Creator multi-kategori tidak boleh hilang dari chip manapun yang ia bawa.
  const multi = beauty.rows.find(r => r.categories.length > 1)
  if (multi) {
    for (const cat of multi.categories) {
      const hit = await listKolDirectory({ categories: [cat], ids: [multi.id], pageSize: 5 })
      ok(`@${multi.username} (${multi.categories.length} kategori) muncul di chip "${cat}"`,
        hit.rows.some(r => r.id === multi.id))
    }
  } else {
    ok('ada creator multi-kategori di halaman Beauty untuk diuji', false, 'tidak ketemu')
  }

  const uncat = await listKolDirectory({ categories: [UNCATEGORIZED], pageSize: 5 })
  eq('category=__uncategorized = 3.547', uncat.total, 3547)
  ok('baris uncategorized memang tanpa kategori',
    uncat.rows.every(r => r.categories.length === 0))
  eq('facets.uncategorized = 3.547', facets.uncategorized, 3547)
  eq('28 master category muncul di facet', facets.categories.length, 28)
  ok('setiap kategori di facet punya count > 0',
    facets.categories.every(c => c.count > 0))

  const mixed = await listKolDirectory({ categories: ['Beauty', UNCATEGORIZED], pageSize: 1 })
  eq('Beauty + __uncategorized = union keduanya', mixed.total, beauty.total + uncat.total)

  /* ── BE-04 — Section Tabs ─────────────────────────────────────────────── */
  console.log('\n── BE-04 Section Tabs ──')

  const WINDOW = new Date('2026-08-07T00:00:00Z')
  const created = await listKolDirectory({ createdAfter: WINDOW, pageSize: 5 })
  eq('createdAfter=2026-08-07 = 3', created.total, 3)
  const refreshed = await listKolDirectory({ refreshedAfter: WINDOW, pageSize: 5 })
  eq('refreshedAfter=2026-08-07 = 1.004', refreshed.total, 1004)
  ok('Recently Added dan Recently Updated bukan dataset yang sama',
    created.total !== refreshed.total)

  const none = await listKolDirectory({ createdAfter: null, refreshedAfter: null, pageSize: 1 })
  eq('parameter tanggal kosong = tanpa filter', none.total, ROSTER)

  const sortCreated = await listKolDirectory({ sort: 'created', dir: 'desc', pageSize: 5 })
  ok('sort=created masih jalan (backward compatible)', sortCreated.rows.length > 0)
  const sortUpdated = await listKolDirectory({ sort: 'updated', dir: 'desc', pageSize: 5 })
  const sortRecent = await listKolDirectory({ sort: 'recent', dir: 'desc', pageSize: 5 })
  ok('sort=updated adalah alias sort=recent, bukan implementasi kedua',
    JSON.stringify(sortUpdated.rows.map(r => r.id)) === JSON.stringify(sortRecent.rows.map(r => r.id)))

  /* ── Kombinasi, paging, input kosong ──────────────────────────────────── */
  console.log('\n── Kombinasi & paging ──')

  const combo = await listKolDirectory({
    categories: ['Beauty'], tiers: ['Micro'], platform: 'instagram',
    minErPct: 1, pageSize: 20,
  })
  ok('kombinasi 4 filter menyempit, tidak error',
    combo.total <= beauty.total && combo.total <= micro.total, `${combo.total} hasil`)
  ok('setiap baris kombinasi memenuhi keempat syarat',
    combo.rows.every(r => r.categories.includes('Beauty') && r.tier === 'Micro'
      && r.platform === 'instagram' && (r.erPct ?? 0) >= 1))

  const p1 = await listKolDirectory({ categories: ['Beauty'], page: 1, pageSize: 10, sort: 'name', dir: 'asc' })
  const p2 = await listKolDirectory({ categories: ['Beauty'], page: 2, pageSize: 10, sort: 'name', dir: 'asc' })
  eq('total sama di setiap halaman', p1.total, p2.total)
  ok('halaman 2 tidak mengulang halaman 1',
    !p1.rows.some(a => p2.rows.some(b => b.id === a.id)))
  eq('pageSize dihormati', p1.rows.length, 10)

  const empty = await listKolDirectory({
    q: '', categories: [], tiers: [], platform: '', minErPct: null, pageSize: 1,
  })
  eq('semua filter kosong = roster penuh', empty.total, ROSTER)

  const idsEmpty = await listKolDirectory({ ids: [], pageSize: 1 })
  eq('ids kosong = bukan "tidak ada hasil"', idsEmpty.total, ROSTER)

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

  const uiBeauty = await throughRoute({ ...KOL_FILTERS_DEFAULT, categories: ['Beauty'] })
  eq('UI 1 kategori -> 1.271', uiBeauty.total, 1271)

  const uiUnion = await throughRoute({ ...KOL_FILTERS_DEFAULT, categories: ['Beauty', 'Lifestyle'] })
  eq('UI 2 kategori -> union yang sama dengan panggilan langsung', uiUnion.total, union.total)

  const uiUncat = await throughRoute({ ...KOL_FILTERS_DEFAULT, categories: [UI_UNCATEGORIZED] })
  eq('UI chip "Tanpa kategori" -> 3.547', uiUncat.total, 3547)

  const uiTiers = await throughRoute({ ...KOL_FILTERS_DEFAULT, tiers: ['Micro', 'Macro'] })
  eq('UI 2 tier -> gabungan', uiTiers.total, micro.total + macro.total)

  const uiUntiered = await throughRoute({ ...KOL_FILTERS_DEFAULT, tiers: [UI_UNTIERED] })
  eq('UI chip "Untiered" -> 526', uiUntiered.total, 526)

  const uiEmpty = await throughRoute(KOL_FILTERS_DEFAULT)
  eq('UI tanpa filter -> roster penuh', uiEmpty.total, ROSTER)

  // Badge "filter aktif" tidak boleh ikut menghitung kategori (punya chip sendiri
  // di toolbar), tapi harus menghitung tier.
  eq('activeFilterCount abaikan kategori',
    activeFilterCount({ ...KOL_FILTERS_DEFAULT, categories: ['Beauty'] }), 0)
  eq('activeFilterCount hitung tier',
    activeFilterCount({ ...KOL_FILTERS_DEFAULT, tiers: ['Micro', 'Macro'] }), 1)

  // Saved list yang dibuat sebelum multi-select menyimpan string, bukan array.
  const legacy = normalizeKolFilters({ category: 'Beauty', tier: 'Micro', erMin: 3, connectedOnly: true })
  ok('saved list lama (string) dinaikkan jadi array',
    Array.isArray(legacy.categories) && legacy.categories[0] === 'Beauty'
    && Array.isArray(legacy.tiers) && legacy.tiers[0] === 'Micro',
    JSON.stringify(legacy))
  eq('saved list lama mempertahankan nilai numerik', legacy.erMin, 3)
  // Yang diuji adalah kesetaraan makna, bukan jumlah hasilnya: kombinasi ini
  // kebetulan nol (Beauty + Micro + ER>=3 + connected), dan itu jawaban yang
  // benar. Yang salah adalah kalau list lama menyaring BERBEDA dari list baru
  // yang isinya sama.
  const legacyTotal = await throughRoute(legacy)
  const sameModern = await throughRoute({
    ...KOL_FILTERS_DEFAULT,
    categories: ['Beauty'], tiers: ['Micro'], erMin: 3, connectedOnly: true,
  })
  eq('saved list lama menyaring sama persis dengan list baru yang setara',
    legacyTotal.total, sameModern.total)
  const legacyLoose = await throughRoute(normalizeKolFilters({ category: 'Beauty' }))
  eq('saved list lama satu-kategori tetap menyaring', legacyLoose.total, 1271)
  const junk = normalizeKolFilters({ categories: 'bukan array', tiers: null, erMin: 'x' })
  ok('input rusak jatuh ke default, bukan melempar',
    junk.categories.length === 1 && junk.tiers.length === 0 && junk.erMin === 0,
    JSON.stringify(junk))
  // Verified -> Connected: list lama TIDAK boleh membawa flag lamanya. Keduanya
  // menjawab pertanyaan berbeda dan `connected` masih false untuk seluruh
  // roster, jadi menerjemahkannya akan mengosongkan list yang tadinya berisi.
  const legacyVerified = normalizeKolFilters({ category: 'Beauty', verifiedOnly: true })
  ok('flag verified lama dibuang, bukan diterjemahkan jadi connected',
    legacyVerified.connectedOnly === false, JSON.stringify(legacyVerified))
  eq('list lama tanpa flag verified tetap mengembalikan kategorinya',
    (await throughRoute(legacyVerified)).total, 1271)
  // Band growth: preset tak dikenal jatuh ke "Any", bukan ke band acak.
  ok('growth preset tak dikenal jatuh ke Any',
    normalizeKolFilters({ growth: 'entah' }).growth === '', '')

  // Section tabs: ketiga tab memakai kunci sort yang benar-benar ada.
  for (const key of ['followers', 'created', 'recent'] as const) {
    const r = await listKolDirectory({ sort: key, dir: 'desc', pageSize: 3 })
    ok(`section tab sort=${key} mengembalikan baris`, r.rows.length === 3, `${r.total} total`)
  }

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
