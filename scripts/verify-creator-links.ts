/**
 * Verifikasi My Creators dan tracking benar-benar tersimpan, dan bahwa satu
 * keputusan tidak menimpa keputusan yang lain.
 *
 *   npm run verify:links
 *
 * Kenapa skrip ini ada: `updateCreatorLink` adalah satu UPSERT dengan
 * `COALESCE` dan enam `CASE` di dalamnya. Semua cabang itu sintaksis benar, jadi
 * `tsc` maupun `npm run build` tidak akan pernah menyentuhnya — yang bisa salah
 * hanya terlihat saat dijalankan:
 *
 *   * Pause yang ikut mematikan `in_roster`, karena `COALESCE` menerima `false`
 *     alih-alih `NULL` untuk field yang tidak dikirim.
 *   * `tracking_started_at` yang di-reset tiap kali resume, sehingga "sudah
 *     dipantau tiga minggu" berubah jadi "baru saja".
 *   * `roster_added_at` lama yang bertahan setelah un-save lalu save lagi.
 *   * `ON CONFLICT` yang menunjuk index salah, sehingga dua penekanan tombol
 *     membuat dua baris dan hitungan jadi dobel.
 *
 * Skrip ini menulis ke database warehouse dan MEMBERSIHKAN dirinya sendiri di
 * akhir, termasuk kalau ada assertion yang gagal.
 */
import pool from '@/lib/db'
import {
  countCreatorLinks, getCreatorLink, listCreatorLinks, listRosterCreatorIds,
  listTrackedLinks, markCreatorChecked, updateCreatorLink,
} from '@/lib/discover/creatorLinks'

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
const A = '00000000-0000-4000-8000-0000000000c3'
const B = '00000000-0000-4000-8000-0000000000d4'

async function main() {
  // Org dan user sungguhan: tabelnya punya foreign key ke keduanya.
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

  const roster = { source: 'roster' as const, id: A }
  const account = { source: 'account' as const, id: B }

  try {
    /* ── My Creators ──────────────────────────────────────────────────────── */
    console.log('My Creators')

    const saved = await updateCreatorLink(org, usr, roster, { inRoster: true })
    check('save tersimpan', saved.inRoster && saved.tracking === 'none')
    check('roster_added_at terisi saat disimpan', saved.rosterAddedAt !== null)
    check('muncul di daftar roster', (await listRosterCreatorIds(org)).includes(A))

    // Menekan Save dua kali adalah fakta yang sama, bukan dua baris — dan
    // tanggalnya tidak boleh bergeser jadi penekanan yang kedua.
    const again = await updateCreatorLink(org, usr, roster, { inRoster: true })
    check('save kedua tidak menggeser tanggal', again.rosterAddedAt === saved.rosterAddedAt)
    check('tidak ada baris kembar',
      (await listCreatorLinks(org)).filter(l => l.id === A).length === 1)

    /* ── tracking, tanpa menyentuh My Creators ────────────────────────────── */
    console.log('\nTracking')

    const tracked = await updateCreatorLink(org, usr, roster, { tracking: 'active' })
    check('tracking menyala', tracked.tracking === 'active')
    // Inti dari partial update: mengirim hanya `tracking` tidak boleh
    // menjatuhkan `in_roster` ke false.
    check('save tidak ikut hilang saat tracking diubah', tracked.inRoster === true)
    check('tracking_started_at terisi', tracked.trackingStartedAt !== null)

    const paused = await updateCreatorLink(org, usr, roster, { tracking: 'paused' })
    check('pause tersimpan', paused.tracking === 'paused')
    check('pause tidak menyentuh My Creators', paused.inRoster === true)
    // Pause lalu resume adalah hubungan pemantauan yang sama; tanggal mulainya
    // tidak boleh ikut di-reset, karena itulah yang menjawab "sudah berapa lama".
    check('pause tidak me-reset tanggal mulai',
      paused.trackingStartedAt === tracked.trackingStartedAt)

    const resumed = await updateCreatorLink(org, usr, roster, { tracking: 'active' })
    check('resume tersimpan', resumed.tracking === 'active')
    check('resume tidak me-reset tanggal mulai',
      resumed.trackingStartedAt === tracked.trackingStartedAt)
    check('tracking_changed_at bergerak tiap perubahan',
      resumed.trackingChangedAt !== null && paused.trackingChangedAt !== null
      && resumed.trackingChangedAt !== tracked.trackingChangedAt)

    /* ── refresh menandai, bukan memutuskan ───────────────────────────────── */
    console.log('\nRefresh')

    await markCreatorChecked(org, roster)
    const checked = await getCreatorLink(org, roster)
    check('last_checked_at terisi', checked?.lastCheckedAt != null)
    check('refresh tidak mengubah status', checked?.tracking === 'active')

    // Creator yang tidak dipantau tidak boleh mendapat baris tracking hanya
    // karena seseorang menekan Refresh.
    await markCreatorChecked(org, account)
    check('refresh creator tak-terpantau tidak membuat baris',
      (await getCreatorLink(org, account)) === null)

    /* ── dua id-space terpisah ────────────────────────────────────────────── */
    console.log('\nDua sumber')

    const own = await updateCreatorLink(org, usr, account, { tracking: 'active' })
    check('creator milik org bisa dipantau', own.tracking === 'active' && own.source === 'account')
    const tracked2 = await listTrackedLinks(org)
    check('kedua sumber masuk daftar tracked',
      tracked2.some(l => l.id === A && l.source === 'roster')
      && tracked2.some(l => l.id === B && l.source === 'account'))

    const counts = await countCreatorLinks(org)
    check('hitungan roster hanya menghitung yang disimpan', counts.roster >= 1)
    check('hitungan tracked menghitung keduanya', counts.tracked >= 2, `tracked=${counts.tracked}`)

    /* ── melepas ──────────────────────────────────────────────────────────── */
    console.log('\nMelepas')

    const unsaved = await updateCreatorLink(org, usr, roster, { inRoster: false })
    check('un-save mengosongkan tanggalnya', unsaved.inRoster === false && unsaved.rosterAddedAt === null)
    check('un-save tidak menghentikan tracking', unsaved.tracking === 'active')

    const stopped = await updateCreatorLink(org, usr, roster, { tracking: 'none' })
    check('stop tersimpan', stopped.tracking === 'none')
    // Baris yang tidak lagi disimpan maupun dipantau adalah riwayat: tetap ada
    // di tabel, tapi bukan state yang digambar layar mana pun.
    check('baris kosong tidak lagi dikembalikan daftar',
      !(await listCreatorLinks(org)).some(l => l.id === A))
    check('riwayat tetap tersimpan', (await getCreatorLink(org, roster))?.trackingStartedAt !== null)

    // Menyimpan lagi setelah dilepas memberi tanggal baru, bukan tanggal lama.
    const resaved = await updateCreatorLink(org, usr, roster, { inRoster: true })
    check('save ulang memberi tanggal baru',
      resaved.rosterAddedAt !== null && resaved.rosterAddedAt !== saved.rosterAddedAt)
  } finally {
    // Bersih-bersih tanpa syarat: assertion yang gagal tidak boleh meninggalkan
    // baris uji di database.
    await pool.query(
      `DELETE FROM public.discover_creator_links
        WHERE organization_id = $1 AND target_id IN ($2, $3)`,
      [org, A, B],
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
