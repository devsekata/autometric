/**
 * Verifikasi pengurutan "Match Score · halaman ini".
 *
 *   npm run verify:match-sort
 *
 * Kenapa skrip ini ada: `rankByMatch` adalah satu comparator dengan tiga cabang
 * null di dalamnya. Ketiganya sintaksis benar, jadi `tsc` maupun `npm run build`
 * tidak akan pernah menyentuhnya — yang bisa salah hanya terlihat saat
 * dijalankan, dan semuanya adalah kegagalan yang MENGHASILKAN ANGKA, bukan
 * error:
 *
 *   * `null` diperlakukan sebagai 0 atau -1, sehingga creator yang belum
 *     terukur naik ke atas pada urutan "Low to High" dan terbaca sebagai
 *     "paling tidak cocok".
 *   * `null` ikut dibalik arah, sehingga bagian bawah daftar berarti dua hal
 *     berbeda tergantung arah sort.
 *   * Urutan seri tidak stabil, sehingga halaman yang sama menghasilkan urutan
 *     berbeda tiap request. Ini BUKAN kasus tepi di roster ini: 3.430 creator
 *     tanpa category semuanya mendarat di skor netral yang sama.
 *   * Input ikut termutasi, sehingga `data.rows` yang sama terurut dua kali.
 *
 * Murni in-memory: tidak menyentuh database, tidak menulis apa pun, dan aman
 * dijalankan kapan saja. Fixture di bawah adalah data uji, bukan data produksi —
 * tidak ada satu pun yang masuk ke database.
 */
import { MATCH_SORT, KOL_SORT_KEYS, rankByMatch } from '@/lib/discover/kolDirectory'
import {
  SORTOPTS, shouldDefaultToMatch, type SortKey,
} from '@/components/discover/KolDirectoryPage'

let failures = 0

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  ok    ${label}`)
  } else {
    failures++
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/**
 * Satu halaman tiruan, dalam urutan yang dikembalikan SQL (followers DESC).
 *
 * `score: null` dipakai dua kali dengan sengaja, supaya urutan relatif antar
 * baris yang belum terukur ikut teruji — bukan hanya posisinya di bawah.
 * Tiga baris bernilai 50 meniru kasus paling umum di roster: creator tanpa
 * category yang mendarat di skor netral yang sama.
 */
type Row = { id: string; score: number | null }
const PAGE: Row[] = [
  { id: 'a', score: 72 },
  { id: 'b', score: null },
  { id: 'c', score: 50 },
  { id: 'd', score: 91 },
  { id: 'e', score: 50 },
  { id: 'f', score: null },
  { id: 'g', score: 50 },
  { id: 'h', score: 12 },
]
const scoreOf = (r: Row) => r.score
const ids = (rows: Row[]) => rows.map(r => r.id).join('')

function main() {
  console.log('\nMatch sort — urutan halaman\n')

  const desc = rankByMatch(PAGE, scoreOf, 'desc')
  const asc = rankByMatch(PAGE, scoreOf, 'asc')

  check('High to Low: skor menurun, belum terukur di bawah',
    ids(desc) === 'daceghbf', `dapat ${ids(desc)}`)
  check('Low to High: skor menaik, belum terukur TETAP di bawah',
    ids(asc) === 'hcegadbf', `dapat ${ids(asc)}`)

  console.log('\nBelum terukur (null)\n')

  // Inti dari kontraknya: null tidak ikut dibalik. Kalau null diperlakukan
  // sebagai angka, salah satu dari dua arah pasti menaikkannya ke atas.
  const tailDesc = desc.slice(-2).map(r => r.score)
  const tailAsc = asc.slice(-2).map(r => r.score)
  check('null berada di bawah pada arah desc',
    tailDesc.every(s => s === null), JSON.stringify(tailDesc))
  check('null berada di bawah pada arah asc',
    tailAsc.every(s => s === null), JSON.stringify(tailAsc))
  check('null tidak pernah dijadikan 0',
    !desc.some(r => r.score === 0) && !asc.some(r => r.score === 0))
  check('urutan relatif antar null stabil (b sebelum f)',
    ids(desc).indexOf('b') < ids(desc).indexOf('f')
    && ids(asc).indexOf('b') < ids(asc).indexOf('f'))

  // Halaman yang SELURUHNYA belum terukur harus kembali apa adanya, bukan
  // diacak — ini yang terjadi pada workspace yang Brand Profile-nya baru
  // diisi sebagian.
  const allNull: Row[] = [{ id: 'x', score: null }, { id: 'y', score: null }]
  check('halaman yang seluruhnya null mempertahankan urutan SQL',
    ids(rankByMatch(allNull, scoreOf, 'desc')) === 'xy'
    && ids(rankByMatch(allNull, scoreOf, 'asc')) === 'xy')

  console.log('\nSeri dan determinisme\n')

  // c, e, g semuanya 50 dan masuk dalam urutan itu. Stabilitas berarti mereka
  // keluar dalam urutan itu juga, di kedua arah.
  const tieDesc = desc.filter(r => r.score === 50).map(r => r.id).join('')
  const tieAsc = asc.filter(r => r.score === 50).map(r => r.id).join('')
  check('seri mempertahankan urutan SQL pada desc', tieDesc === 'ceg', tieDesc)
  check('seri mempertahankan urutan SQL pada asc', tieAsc === 'ceg', tieAsc)
  check('dua panggilan menghasilkan urutan identik',
    ids(rankByMatch(PAGE, scoreOf, 'desc')) === ids(desc)
    && ids(rankByMatch(PAGE, scoreOf, 'asc')) === ids(asc))

  console.log('\nEfek samping\n')

  check('input tidak dimutasi', ids(PAGE) === 'abcdefgh', ids(PAGE))
  check('jumlah baris tidak berubah — tidak ada baris hilang atau dobel',
    desc.length === PAGE.length && asc.length === PAGE.length
    && new Set(desc.map(r => r.id)).size === PAGE.length)
  check('halaman kosong aman', rankByMatch([], scoreOf, 'desc').length === 0)

  console.log('\nKontrak sort key\n')

  // Arah selain 'asc' berarti desc, sama seperti `orderBy` di kolDirectory.
  check("arah null/tak dikenal diperlakukan sebagai desc",
    ids(rankByMatch(PAGE, scoreOf, null)) === ids(desc)
    && ids(rankByMatch(PAGE, scoreOf, 'apa saja')) === ids(desc))
  check(`'${MATCH_SORT}' dikenali sort key whitelist`,
    KOL_SORT_KEYS.includes(MATCH_SORT), KOL_SORT_KEYS.join(','))
  check('sort key lama tetap ada — tidak ada yang tergantikan',
    ['followers', 'engagement', 'recent', 'updated', 'created', 'name', 'growth']
      .every(k => KOL_SORT_KEYS.includes(k)), KOL_SORT_KEYS.join(','))

  console.log('\nDefault sort saat Brand Profile aktif\n')

  const OTHERS: SortKey[] = [
    'followers', 'engagement', 'recent', 'created', 'growth', 'name',
  ]

  check('Brand Profile aktif + belum ada pilihan user → pakai Match Score',
    shouldDefaultToMatch(true, false, 'followers'))
  check('tanpa Brand Profile → JANGAN pakai Match Score',
    OTHERS.every(k => !shouldDefaultToMatch(false, false, k)))

  // Aturan yang paling mudah rusak: begitu user memilih, default tidak boleh
  // memaksa balik pada response berikutnya.
  check('user sudah memilih sort lain → JANGAN dipaksa balik ke Match Score',
    OTHERS.every(k => !shouldDefaultToMatch(true, true, k)))
  check('user sengaja memilih Match Score → tidak di-set ulang',
    !shouldDefaultToMatch(true, true, 'match'))
  check('sudah di Match Score → tidak di-set ulang (tidak ada loop)',
    !shouldDefaultToMatch(true, false, 'match'))

  // Setiap sort lama harus bisa dipilih dan bertahan, bukan hanya `followers`.
  const offered = SORTOPTS.map(([k]) => k)
  check('ketujuh sort ditawarkan di dropdown dan bertahan setelah dipilih',
    [...OTHERS, 'match' as SortKey].every(k =>
      offered.includes(k) && !shouldDefaultToMatch(true, true, k)),
    offered.join(','))
  check('Match Score ada di dropdown dan labelnya menyebut cakupannya',
    (SORTOPTS.find(([k]) => k === 'match')?.[1] ?? '').includes('halaman ini'),
    SORTOPTS.find(([k]) => k === 'match')?.[1])

  console.log(
    failures === 0
      ? '\nSemua pemeriksaan lulus.\n'
      : `\n${failures} pemeriksaan gagal.\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main()
