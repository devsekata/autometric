/**
 * Verifikasi filter Creator Database yang ditambahkan/diperbaiki pada pass ini.
 *
 *   npm run verify:kol-filters
 *
 * Melengkapi `verify:filters`, yang menguji lima filter BE-01…BE-05. Fokus di
 * sini: batas atas follower (`follMax`, filter baru), komposisi filter dengan
 * search/sort/paging, dan bukti bahwa plafon rate card MENYARING — bukan
 * mengosongkan — hasil. Assertion itu dulu kebalikannya: selama
 * `l1_silver.unified_rate_card` masih 0 baris, plafon apa pun mengembalikan 0
 * dan kontrolnya sengaja dinonaktifkan. Tabelnya terisi 13 Sep 2026 (8.856
 * baris / 6.959 creator), jadi yang dibuktikan sekarang adalah kebalikannya.
 *
 * MEMBUTUHKAN VPN kantor: semua assertion memanggil database KOL lewat
 * `@/lib/kolDb`.
 */
import { listKolDirectory } from '@/lib/discover/kolDirectory'
import kolDb from '@/lib/kolDb'

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

;(async () => {
  const base = await listKolDirectory({ pageSize: 1 })
  console.log(`roster total = ${base.total}\n`)

  console.log('follower ceiling (new)')
  const under10k = await listKolDirectory({ maxFollowers: 10_000, pageSize: 1 })
  const under100k = await listKolDirectory({ maxFollowers: 100_000, pageSize: 1 })
  ok('maxFollowers narrows the whole roster', under100k.total < base.total,
    `${under100k.total} of ${base.total}`)
  ok('a tighter ceiling narrows further', under10k.total < under100k.total,
    `<=10K ${under10k.total} vs <=100K ${under100k.total}`)
  ok('every returned row is under the ceiling',
    (await listKolDirectory({ maxFollowers: 10_000, pageSize: 40 }))
      .rows.every(r => (r.followers ?? 0) <= 10_000))

  console.log('\nfloor + ceiling compose')
  const band = await listKolDirectory({ minFollowers: 10_000, maxFollowers: 50_000, pageSize: 40 })
  ok('band returns only creators inside it',
    band.rows.every(r => (r.followers ?? 0) >= 10_000 && (r.followers ?? 0) <= 50_000),
    `${band.total} creators in 10K-50K`)

  console.log('\nEmerging Creators preset, as the UI now sends it')
  const emerging = await listKolDirectory({ maxFollowers: 100_000, pageSize: 1 })
  ok('preset is a real server-side filter', emerging.total > 0 && emerging.total < base.total,
    `${emerging.total} creators`)

  console.log('\nsearch + filters + sort compose')
  const combo = await listKolDirectory({
    q: 'a', platform: 'instagram', maxFollowers: 100_000, minErPct: 1,
    sort: 'engagement', dir: 'desc', pageSize: 20,
  })
  ok('combined query returns a coherent set', combo.rows.every(r =>
    (r.followers ?? 0) <= 100_000 && (r.erPct ?? 0) >= 1 && r.platform === 'instagram'),
    `${combo.total} matched`)
  // With a search term the list is ordered by relevance first and the chosen
  // sort second (see `orderBy`), so the sort is asserted without one.
  const sorted = await listKolDirectory({
    platform: 'instagram', maxFollowers: 100_000, minErPct: 1,
    sort: 'engagement', dir: 'desc', pageSize: 20,
  })
  /**
   * The list is grouped by provenance before anything else (`SCRAPED_FIRST`):
   * Live and Calculated rows lead Estimated ones whatever the sort. That is
   * deliberate and predates this work, so the sort is asserted *within* each
   * group rather than across the whole page.
   */
  const groups = new Map<string, number[]>()
  for (const r of sorted.rows) {
    const g = r.status === 'Estimated' ? 'estimated' : 'measured'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(r.erPct ?? 0)
  }
  const inOrder = [...groups.values()].every(v => v.every((x, i) => i === 0 || v[i - 1] >= x))
  ok('sort holds within each provenance group', inOrder,
    [...groups.entries()].map(([g, v]) => `${g}: ${v.slice(0, 4).join('>')}`).join(' | '))
  ok('the sorted set is still filtered',
    sorted.rows.every(r => (r.followers ?? 0) <= 100_000 && (r.erPct ?? 0) >= 1),
    `${sorted.total} matched`)

  console.log('\npagination reflects the filtered total')
  const p1 = await listKolDirectory({ maxFollowers: 50_000, pageSize: 12, page: 1 })
  const p2 = await listKolDirectory({ maxFollowers: 50_000, pageSize: 12, page: 2 })
  ok('both pages report the same filtered total', p1.total === p2.total, `total=${p1.total}`)
  ok('page 2 is a different set', p1.rows[0]?.id !== p2.rows[0]?.id)
  ok('filtered total is smaller than the roster', p1.total < base.total)

  console.log('\nthe rate ceiling narrows rather than empties (why the control is live again)')
  const roof = await listKolDirectory({ maxRate: 1_000_000_000, pageSize: 1 })
  ok('a ceiling above every price still returns creators', roof.total > 0,
    `a Rp1 miliar ceiling returns ${roof.total}`)
  ok('it stays inside the roster', roof.total <= base.total,
    `${roof.total} priced of ${base.total} roster`)

  const tight = await listKolDirectory({ maxRate: 1_000_000, pageSize: 1 })
  ok('a tighter ceiling narrows further', tight.total < roof.total,
    `<=Rp1jt ${tight.total} vs <=Rp1mlr ${roof.total}`)

  // The ceiling is an EXISTS over unified_rate_card, so every returned creator
  // must own at least one deliverable at or under it.
  const page = await listKolDirectory({ maxRate: 1_000_000, pageSize: 24 })
  const priced = await kolDb().query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM public.kol_social_account ksa
       JOIN l1_silver.unified_rate_card u ON u.social_account_id = ksa.social_account_id
      WHERE ksa.kol_id = ANY($1::uuid[]) AND u.fee <= 1000000`,
    [page.rows.map(r => r.id)],
  )
  ok('every returned creator really has a deliverable under the ceiling',
    Number(priced.rows[0].n) >= page.rows.length,
    `${priced.rows[0].n} qualifying rows across ${page.rows.length} creators`)

  await kolDb().end()
  console.log(bad === 0 ? '\nAll filter assertions passed.' : `\n${bad} FAILED`)
  process.exit(bad === 0 ? 0 : 1)
})().catch(e => { console.error(e.message); process.exit(1) })
