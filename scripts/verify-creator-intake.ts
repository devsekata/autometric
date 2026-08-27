/**
 * Verifikasi alur Creator Intake: parsing input → deteksi lokasi → simpan →
 * duplicate check → run log → snapshot → smart discovery.
 *
 *   npm run verify:creators
 *
 * Kenapa skrip ini ada: alur intake menyentuh empat lapis sekaligus (parsing di
 * `creatorInput`, SQL di `creatorStore`, keputusan validasi di `creatorIntake`,
 * skoring di `creatorSimilar`), dan tiga di antaranya hanya bisa salah pada
 * runtime — tipe parameter Postgres, placeholder yang tidak tersubstitusi, dan
 * kolom DATE yang bergeser sehari saat dikonversi ke UTC. Semuanya pernah
 * terjadi, dan tidak satu pun tertangkap oleh `tsc`.
 *
 * Skrip ini MENULIS satu creator uji ke organisasi pertama lalu menghapusnya
 * lagi, termasuk run dan snapshot-nya. Tidak memanggil Apify dan tidak
 * mengeluarkan biaya; bagian yang butuh scraper diuji terpisah lewat alur
 * aslinya di UI.
 */

import 'dotenv/config'
import { parseCreatorInput } from '../src/lib/discover/creatorInput'
import {
  createCreator, deleteCreator, findCreatorByHandle, finishRun, getCreator,
  listCreatorFacets, listCreators, saveMeasurements, saveRunSteps, saveSnapshot,
  setMonitoring, setProfilingStatus, startRun,
} from '../src/lib/discover/creatorStore'
import { checkCreatorAccount } from '../src/lib/discover/creatorIntake'
import { identifyCity } from '../src/lib/discover/creatorProfiling'
import { findSimilarCreators } from '../src/lib/discover/creatorSimilar'
import pool from '../src/lib/db'

const ok = (label: string, cond: boolean, extra = '') =>
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)

async function main() {
  /* ── 1. input parsing ─────────────────────────────────────────────── */
  const cases: [string, string, boolean, string][] = [
    ['instagram', 'https://instagram.com/raditya_dika', true, 'raditya_dika'],
    ['instagram', '@raditya_dika', true, 'raditya_dika'],
    ['instagram', 'www.instagram.com/raditya_dika/?hl=en', true, 'raditya_dika'],
    ['instagram', 'https://tiktok.com/@radityadika', false, 'wrong_platform'],
    ['instagram', 'https://instagram.com/p/Cxyz123', false, 'not_a_profile'],
    ['instagram', 'ra dit ya', false, 'invalid_handle'],
    ['tiktok', 'https://www.tiktok.com/@radityadika?lang=id', true, 'radityadika'],
    ['facebook', 'https://facebook.com/profile.php?id=100064123456', true, '100064123456'],
    ['facebook', 'RadityaDika', true, 'RadityaDika'],
  ]
  for (const [platform, input, shouldPass, expect] of cases) {
    const r = parseCreatorInput(platform, input)
    ok(
      `parse ${platform} "${input}"`,
      r.ok === shouldPass && (r.ok ? r.username === expect : r.problem === expect),
      r.ok ? r.username : `${r.problem}: ${r.message}`,
    )
  }

  /* ── 2. deteksi lokasi ────────────────────────────────────────────── */
  /**
   * `identifyCity` mengisi kolom yang difilter Basic Discovery lewat Location,
   * dan satu-satunya buktinya adalah bio. Yang diuji di sini bukan kota yang
   * ketemu, melainkan kota yang TIDAK boleh ketemu: `balikpapan` bukan Bali,
   * `medannya` bukan Medan, dan `DIY` di bio creator hampir selalu berarti
   * do-it-yourself, bukan Yogyakarta. Salah di sini tidak bikin error — cuma
   * bikin filter Location diam-diam salah isi.
   */
  const cityCases: [string, string | null][] = [
    ['Content creator | 📍Jakarta Selatan | business: mail@x.com', 'Jakarta'],
    ['jaksel based • daily vlog', 'Jakarta'],
    ['Bandung 🌤️ | fashion & thrift', 'Bandung'],
    ['Anak Jogja | mahasiswa UGM', 'Yogyakarta'],
    ['Living in Canggu, Bali 🏝', 'Bali'],
    ['Kuliner Sby | review jujur', 'Surabaya'],
    ['Makassar food hunter', 'Makassar'],
    ['Medan punya!', 'Medan'],
    // jebakan: tidak boleh ada yang cocok
    ['DIY crafts and home decor tutorials', null],
    ['Aku balik lagi dengan konten baru', null],
    ['Explore Balikpapan bareng aku', null],
    ['Medannya enak banget', null],
    ['just vibes', null],
    ['', null],
    // dua kota dengan bukti sama kuat bukan jawaban
    ['Jakarta & Bandung — dua kota, satu channel', null],
  ]
  for (const [bio, expect] of cityCases) {
    const r = identifyCity(bio)
    ok(`city "${bio.slice(0, 42) || '(kosong)'}"`, r.city === expect, `${r.city ?? 'null'} — ${r.basis}`)
  }

  /* ── 3. store round trip ──────────────────────────────────────────── */
  const { rows: orgs } = await pool.query<{ id: string; name: string }>(
    'SELECT id, name FROM public.organizations WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1',
  )
  const org = orgs[0]
  if (!org) { console.log('SKIP  store round trip — no organization in the database'); return }
  console.log(`\n-- using org ${org.name} (${org.id})\n`)

  const username = `smoketest_${Date.now()}`
  const { creator, created } = await createCreator({
    orgId: org.id, userId: null, platform: 'instagram',
    username, profileUrl: `https://www.instagram.com/${username}`, visibility: 'unknown',
  })
  ok('createCreator inserts', created && creator.username === username)

  const again = await createCreator({
    orgId: org.id, userId: null, platform: 'instagram',
    username: username.toUpperCase(), profileUrl: 'x', visibility: 'unknown',
  })
  ok('duplicate handle is not re-created (case-insensitive)', !again.created && again.creator.id === creator.id)

  const dupe = await findCreatorByHandle(org.id, 'instagram', username.toUpperCase())
  ok('findCreatorByHandle matches case-insensitively', dupe?.id === creator.id)

  const run = await startRun(creator.id, 'initial', [
    { key: 'profile', label: 'Collecting profile information', state: 'running' },
  ])
  await saveRunSteps(run.id, [
    { key: 'profile', label: 'Collecting profile information', state: 'done', detail: 'public account' },
    { key: 'stats', label: 'Fetching account statistics', state: 'skipped', detail: 'no figures returned' },
  ])
  await saveMeasurements(creator.id, {
    displayName: 'Smoke Test', followers: 42_000, erPct: 3.25, tier: 'Micro',
    category: 'Tech', city: 'Bandung', visibility: 'public',
    content: {
      postsAnalyzed: 12, windowDays: 90,
      formats: [{ label: 'Reels', count: 8, share: 66.7 }],
      hashtags: [{ tag: '#tech', count: 5 }],
      postsPerWeek: 2.4, peakHour: 19, topPosts: [],
    },
  })
  await saveSnapshot(creator.id, { followers: 42_000, erPct: 3.25, avgLikes: 900 })
  await setProfilingStatus(creator.id, 'ready')
  await finishRun(run.id, 'done', [
    { key: 'profile', label: 'Collecting profile information', state: 'done' },
    { key: 'stats', label: 'Fetching account statistics', state: 'skipped' },
  ])

  const full = await getCreator(org.id, creator.id)
  ok('getCreator returns measurements', full?.followers === 42_000 && full?.erPct === 3.25)
  ok('numeric columns come back as numbers', typeof full?.followers === 'number' && typeof full?.erPct === 'number')
  ok('content JSONB round-trips', full?.content?.postsAnalyzed === 12)
  ok('run steps stored', full?.run?.status === 'done' && full.run.step === 2)
  ok('snapshot recorded', (full?.history.length ?? 0) === 1)
  ok('last_refreshed_at set on ready', !!full?.lastRefreshedAt)

  // A second snapshot on the same Jakarta day must correct, not duplicate.
  await saveSnapshot(creator.id, { followers: 42_500 })
  const afterSecond = await getCreator(org.id, creator.id)
  ok('same-day snapshot upserts', afterSecond?.history.length === 1 && afterSecond.history[0].followers === 42_500)
  ok('upsert keeps the fields it was not given', afterSecond?.history[0].erPct === 3.25)

  await setMonitoring(org.id, creator.id, false)
  ok('monitoring toggles', (await getCreator(org.id, creator.id))?.monitoringEnabled === false)

  const filteredIn = await listCreators(org.id, { q: 'smoketest', minFollowers: 1_000 })
  const filteredOut = await listCreators(org.id, { minFollowers: 1_000_000 })
  ok('list filters by follower floor', filteredIn.some(c => c.id === creator.id) && !filteredOut.some(c => c.id === creator.id))

  // Location is the newest predicate in listCreators and the only one whose
  // column nothing wrote until profiling learned to read it off the bio.
  const inCity = await listCreators(org.id, { q: 'smoketest', city: 'Bandung' })
  const wrongCity = await listCreators(org.id, { q: 'smoketest', city: 'Surabaya' })
  ok('list filters by location', inCity.some(c => c.id === creator.id) && !wrongCity.some(c => c.id === creator.id))

  const facets = await listCreatorFacets(org.id)
  ok('facets count the roster', facets.total >= 1 && facets.platforms.some(p => p.key === 'instagram'))
  ok('facets offer the cities on the roster', facets.cities.some(c => c.name === 'Bandung' && c.count >= 1))

  /* ── 4. duplicate check without touching the platform ─────────────── */
  const check = await checkCreatorAccount(org.id, 'instagram', `@${username}`)
  ok('check reports an existing creator', check.state === 'exists')
  if (check.state === 'exists') {
    const skipped = check.steps.filter(s => s.state === 'skipped').map(s => s.key)
    ok('platform steps are skipped for a duplicate', skipped.includes('account') && skipped.includes('access'),
      `skipped: ${skipped.join(', ')}`)
  }

  const bad = await checkCreatorAccount(org.id, 'instagram', 'https://tiktok.com/@someone')
  ok('check rejects a wrong-platform URL', bad.state === 'invalid_url')

  /* ── 5. smart discovery degrades without the KOL database ─────────── */
  const similar = await findSimilarCreators(org.id, creator.id, 'creator', {})
  ok('similar search returns a reference', similar?.reference.id === creator.id)
  ok('similar search notes the unreachable roster or has candidates',
    !!similar && (similar.notes.length > 0 || similar.candidates.length > 0),
    similar?.notes.join(' | '))

  /* ── 6. cleanup ───────────────────────────────────────────────────── */
  ok('deleteCreator removes the row', await deleteCreator(org.id, creator.id))
  ok('cascade removed the run and snapshots',
    (await pool.query('SELECT 1 FROM public.discover_creator_runs WHERE creator_id = $1', [creator.id])).rowCount === 0)

  await pool.end()
}

main().catch(async err => {
  console.error('SMOKE FAILED:', err)
  await pool.end().catch(() => {})
  process.exit(1)
})
