/**
 * Verifikasi navigasi Discover: setiap layar harus bisa dicapai lewat URL-nya
 * sendiri, dan setiap link lama harus tetap mendarat di tempat yang benar.
 *
 *   npm run verify:nav
 *
 * Kenapa skrip ini ada: `tabHref` dan `resolveTabParams` adalah sepasang fungsi
 * yang harus saling membalik, dan tidak ada di TypeScript yang memaksa itu.
 * Waktu dibuat, `tabHref` menghilangkan `?tab=` untuk tab default sementara
 * `resolveTabParams` menyerah begitu `tab` tidak ada — jadi setiap URL menuju
 * My Creators, Tracked Accounts, Smart Discovery, layar profiling dan tujuh
 * layar analisis per-creator diam-diam mendarat di layar pertama. Tidak ada
 * error, tidak ada 404, cuma layar yang salah. `tsc` bersih sepanjang itu.
 *
 * Tidak menyentuh database dan tidak butuh env.
 */

import {
  DISCOVER_TABS, DEFAULT_TAB, resolveTabParams, tabHref, visibleViews,
} from '../src/lib/discover/tabs'

let bad = 0
const ok = (label: string, cond: boolean, extra = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
}

/* ── 1. tiap pasangan tab/view harus selamat pulang-pergi lewat URL ────── */
for (const t of DISCOVER_TABS) {
  const views = [...(t.views ?? []), ...(t.creatorViews ?? [])]
  const pairs: (string | null)[] = views.length ? views.map(v => v.id) : [null]
  for (const v of pairs) {
    const href = tabHref('org', t.id, v)
    const sp = new URLSearchParams(href.includes('?') ? href.split('?')[1] : '')
    const back = resolveTabParams(sp.get('tab'), sp.get('view'))
    // View landing tidak ditulis di URL, tapi harus resolve balik ke dirinya.
    const want = v ?? (visibleViews(t)[0]?.id ?? null)
    const pass = back.tab === t.id && back.view === want
    ok(`${t.id}/${v ?? '(none)'} -> ${href.replace('/organizations/org/discover', '') || '/'}`,
      pass, pass ? '' : `dapat ${back.tab}/${back.view}`)
  }
}

/* ── 2. pintu depan modul ─────────────────────────────────────────────── */
const landing = visibleViews(DISCOVER_TABS.find(t => t.id === DEFAULT_TAB))[0]?.id ?? null
ok('URL tab default adalah /discover polos',
  tabHref('org', DEFAULT_TAB, landing) === '/organizations/org/discover')
const home = resolveTabParams(null, null)
ok('tanpa parameter mendarat di landing tab default',
  home.tab === DEFAULT_TAB && home.view === landing, `${home.tab}/${home.view}`)

/* ── 3. link dari setiap bentuk modul ini sebelumnya ──────────────────── */
const legacy: [string | null, string | null, string, string | null][] = [
  ['kol', null, 'directory', 'database'],
  ['accounts', null, 'directory', 'tracked'],
  ['creators', 'roster', 'directory', 'mine'],
  ['directory', 'roster', 'directory', 'database'],
  // dashboard yang sempat berdiri di depan direktori
  ['directory', 'hub', 'directory', 'database'],
  ['cart', null, 'order', 'cart'],
  ['ratecard', null, 'directory', 'ratecard'],
  ['campaigns', null, 'campaign', null],
  ['content', null, 'directory', 'content'],
  // nilai yang tidak dikenal mendarat di depan, bukan 404
  ['nonsense', null, 'directory', 'database'],
]
for (const [rt, rv, wt, wv] of legacy) {
  const r = resolveTabParams(rt, rv)
  ok(`?tab=${rt}${rv ? `&view=${rv}` : ''} -> ${wt}/${wv}`,
    r.tab === wt && r.view === wv, `dapat ${r.tab}/${r.view}`)
}

console.log(bad === 0 ? '\nSemua kasus navigasi lolos.' : `\n${bad} GAGAL`)
process.exit(bad === 0 ? 0 : 1)
