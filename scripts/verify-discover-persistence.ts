/**
 * Verifikasi Favourites dan Saved Lists benar-benar tersimpan di database.
 *
 *   npm run verify:persistence
 *
 * Kenapa skrip ini ada: dua fitur ini sebelumnya hidup di `localStorage`, dan
 * satu-satunya cara membuktikan perpindahannya berhasil adalah menulis ke
 * tabel sungguhan lalu membacanya kembali lewat modul yang sama yang dipakai
 * route API. `tsc` bersih sepanjang query-nya sintaksis benar — termasuk kalau
 * `ON CONFLICT` menunjuk index yang salah, kalau scope tidak memisahkan dua
 * direktori, atau kalau kepemilikan (org, user) tidak benar-benar mengunci.
 * Tiga hal itu tidak menghasilkan error apa pun sampai dipakai.
 *
 * Skrip ini menulis ke database warehouse dan MEMBERSIHKAN dirinya sendiri di
 * akhir, termasuk kalau ada assertion yang gagal.
 */
import pool from '@/lib/db'
import {
  addFavorite, importFavorites, listFavorites, removeFavorite, toggleFavorite,
} from '@/lib/discover/favorites'
import {
  deleteSavedList, listSavedLists, saveList, setListMembership, updateSavedList,
} from '@/lib/discover/savedLists'

let failures = 0

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  ok    ${label}`)
  } else {
    failures++
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Dua UUID tetap yang tidak mungkin bentrok dengan creator sungguhan. */
const A = '00000000-0000-4000-8000-0000000000a1'
const B = '00000000-0000-4000-8000-0000000000b2'

async function main() {
  // Org dan user sungguhan: kedua tabel punya foreign key ke keduanya, jadi id
  // karangan akan ditolak — dan itu memang bagian dari yang diuji.
  const { rows } = await pool.query<{ org: string; usr: string }>(
    `SELECT o.id AS org, u.id AS usr
       FROM public.organizations o
       CROSS JOIN LATERAL (SELECT id FROM public.users LIMIT 1) u
      LIMIT 1`,
  )
  const seed = rows[0]
  if (!seed) {
    console.error('Tidak ada organizations/users di database — tidak bisa diuji.')
    process.exit(1)
  }
  const { org, usr } = seed
  console.log(`org=${org} user=${usr}\n`)

  try {
    /* ── favourites ───────────────────────────────────────────────────────── */
    console.log('Favourites')

    await addFavorite(org, usr, { source: 'roster', id: A })
    check('add tersimpan', (await listFavorites(org, usr)).includes(`roster:${A}`))

    // Idempoten: menandai dua kali adalah fakta yang sama, bukan dua baris.
    await addFavorite(org, usr, { source: 'roster', id: A })
    const afterDouble = (await listFavorites(org, usr)).filter(k => k === `roster:${A}`)
    check('add kedua tidak menduplikasi', afterDouble.length === 1, `dapat ${afterDouble.length}`)

    // Username sama di platform berbeda bukan duplikat — di sini: id sama pada
    // dua id-space berbeda harus jadi dua favorit terpisah.
    await addFavorite(org, usr, { source: 'account', id: A })
    const both = await listFavorites(org, usr)
    check('account dan roster terpisah', both.includes(A) && both.includes(`roster:${A}`))

    const off = await toggleFavorite(org, usr, { source: 'roster', id: A })
    check('toggle mematikan', off.favorited === false
      && !(await listFavorites(org, usr)).includes(`roster:${A}`))

    const on = await toggleFavorite(org, usr, { source: 'roster', id: A })
    check('toggle menyalakan lagi', on.favorited === true
      && (await listFavorites(org, usr)).includes(`roster:${A}`))

    // Migrasi localStorage: additive, dan entri rusak dilewati tanpa
    // menjatuhkan sisanya.
    const imported = await importFavorites(org, usr, [
      `roster:${B}`, 'bukan-uuid', `roster:${A}`,
    ])
    check('import melewati entri rusak, tidak menimpa', imported.imported === 1,
      `imported=${imported.imported}`)
    check('import menambahkan yang baru', (await listFavorites(org, usr)).includes(`roster:${B}`))

    await removeFavorite(org, usr, { source: 'roster', id: A })
    await removeFavorite(org, usr, { source: 'roster', id: B })
    await removeFavorite(org, usr, { source: 'account', id: A })
    check('remove membersihkan', (await listFavorites(org, usr)).length === 0)

    /* ── saved lists ──────────────────────────────────────────────────────── */
    console.log('\nSaved Lists')

    const created = await saveList(org, usr, {
      scope: 'database', name: 'Verify List', filters: { erMin: 4, categories: ['Beauty'] },
    })
    check('save membuat list', !!created.id && created.name === 'Verify List')
    check('filters tersimpan utuh',
      (created.filters as { erMin?: number }).erMin === 4,
      JSON.stringify(created.filters))

    // Nama yang sama menimpa, bukan menumpuk near-duplicate.
    await saveList(org, usr, {
      scope: 'database', name: 'verify list', filters: { erMin: 9 },
    })
    const dbLists = await listSavedLists(org, usr, 'database')
    const named = dbLists.filter(l => l.name.toLowerCase() === 'verify list')
    check('nama sama menimpa (case-insensitive)', named.length === 1, `dapat ${named.length}`)
    check('filters ikut terganti', (named[0]?.filters as { erMin?: number })?.erMin === 9)

    // Scope memisahkan dua direktori: nama yang sama boleh hidup di keduanya.
    const tracked = await saveList(org, usr, {
      scope: 'tracked', name: 'Verify List', filters: { platform: 'instagram' },
    })
    // Dicocokkan case-insensitive: langkah sebelumnya sengaja menyimpan dengan
    // ejaan "verify list", dan menimpa memang mengadopsi ejaan baru yang
    // diketik user — jadi nama tersimpan sekarang huruf kecil semua.
    const sameName = (l: { name: string }) => l.name.toLowerCase() === 'verify list'
    check('scope memisahkan namespace',
      (await listSavedLists(org, usr, 'tracked')).filter(sameName).length === 1
      && (await listSavedLists(org, usr, 'database')).filter(sameName).length === 1)

    const renamed = await updateSavedList(org, usr, named[0].id, { name: 'Verify Renamed' })
    check('rename bekerja', renamed?.name === 'Verify Renamed')
    check('rename tidak menghapus filters',
      (renamed?.filters as { erMin?: number })?.erMin === 9)

    const withMember = await setListMembership(org, usr, named[0].id, `roster:${A}`, true)
    check('tambah creator ke list', withMember?.items.includes(`roster:${A}`) === true)

    const withoutMember = await setListMembership(org, usr, named[0].id, `roster:${A}`, false)
    check('hapus creator dari list', withoutMember?.items.length === 0)

    // Kepemilikan: user lain tidak boleh menyentuh list ini.
    const otherUser = '00000000-0000-4000-8000-0000000000ff'
    const stolen = await updateSavedList(org, otherUser, named[0].id, { name: 'Hijacked' })
    check('user lain tidak bisa mengubah', stolen === null)
    check('nama tetap setelah percobaan itu',
      (await listSavedLists(org, usr, 'database'))
        .some(l => l.name === 'Verify Renamed'))

    check('delete bekerja', await deleteSavedList(org, usr, named[0].id))
    check('delete kedua mengembalikan false', !(await deleteSavedList(org, usr, named[0].id)))
    await deleteSavedList(org, usr, tracked.id)
    check('bersih', (await listSavedLists(org, usr, 'database')).filter(l => l.name.startsWith('Verify')).length === 0
      && (await listSavedLists(org, usr, 'tracked')).filter(l => l.name.startsWith('Verify')).length === 0)
  } finally {
    // Bersih-bersih tanpa syarat: assertion yang gagal tidak boleh meninggalkan
    // baris uji di database.
    await pool.query(
      `DELETE FROM public.discover_favorites
        WHERE organization_id = $1 AND user_id = $2 AND target_id IN ($3, $4)`,
      [org, usr, A, B],
    )
    await pool.query(
      `DELETE FROM public.discover_saved_lists
        WHERE organization_id = $1 AND user_id = $2 AND name LIKE 'Verify%'`,
      [org, usr],
    )
    await pool.end()
  }

  console.log(failures === 0 ? '\nSemua assertion lulus.' : `\n${failures} assertion gagal.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(err => {
  console.error('Verifikasi gagal dijalankan:', err)
  process.exit(1)
})
