#!/usr/bin/env node
/**
 * Verifikasi rantai FPK: l0_extra.*_fpk → l0_harmonization → l1_silver → l2_gold.
 *
 *   node scripts/verify-fpk-wiring.js
 *
 * Kenapa skrip ini ada: stored procedure medallion TIDAK ada di repo — hanya
 * hidup di database. Migrasi 041 menyisipkan satu `CALL sp_sync_fpk_extras()`
 * ke dalam `sp_sync_all_from_raw`. Siapa pun yang mengedit procedure itu dari
 * DBeaver bisa menghapus CALL tersebut tanpa sadar, dan gejalanya diam-diam:
 * metrik CSV berhenti terisi, tidak ada error di mana pun. Jalankan skrip ini
 * setelah ada perubahan pada layer medallion.
 *
 * Hanya membaca. Tidak menulis, tidak memanggil procedure apa pun.
 */
require('dotenv').config({ path: '.env.local' })
const { Client } = require('pg')

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const problems = []
const ok   = (m, d = '') => console.log(`  OK     ${m}${d ? `  — ${d}` : ''}`)
const bad  = (m, d = '') => { console.log(`  GAGAL  ${m}${d ? `  — ${d}` : ''}`); problems.push(m) }
const warn = (m, d = '') => console.log(`  catat  ${m}${d ? `  — ${d}` : ''}`)

async function one(sql, params = []) {
  return (await client.query(sql, params)).rows[0]
}

async function checkWiring() {
  console.log('\n1. PROCEDURE')

  const proc = await one(
    `SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'l0_harmonization' AND p.proname = 'sp_sync_fpk_extras'`)
  proc.n ? ok('sp_sync_fpk_extras ada')
         : bad('sp_sync_fpk_extras HILANG', 'jalankan ulang migrasi 041')

  const wired = await one(
    `SELECT prosrc LIKE '%sp_sync_fpk_extras%' AS w FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'l0_harmonization' AND p.proname = 'sp_sync_all_from_raw'`)
  wired?.w ? ok('sp_sync_all_from_raw memanggilnya')
           : bad('CALL sp_sync_fpk_extras() TIDAK ADA di sp_sync_all_from_raw',
                 'metrik CSV akan berhenti terisi tanpa error apa pun')

  const log = await one(
    `SELECT status, message, executed_at FROM l0_harmonization.sync_log
     WHERE procedure_name = 'sp_sync_fpk_extras' ORDER BY log_id DESC LIMIT 1`)
  if (!log) warn('belum pernah tercatat jalan di sync_log')
  else if (log.status === 'SUCCESS') ok('jalan terakhir SUCCESS', String(log.executed_at))
  else bad(`jalan terakhir ${log.status}`, log.message)
}

async function checkChain() {
  console.log('\n2. RANTAI NILAI (per akun bersumber CSV)')

  // Akun yang punya baris di salah satu tabel _fpk.
  const { rows: accounts } = await client.query(
    `SELECT DISTINCT sa.id, sa.username, p.key platform, sa.data_source
     FROM public.social_accounts sa
     JOIN public.platforms p ON p.id = sa.platform_id
     WHERE sa.id IN (SELECT social_account_id FROM l0_extra.ig_profile_fpk
                     UNION SELECT social_account_id FROM l0_extra.tt_profile_fpk
                     UNION SELECT social_account_id FROM l0_extra.tt_post_fpk)
     ORDER BY p.key, sa.username`)

  if (!accounts.length) {
    warn('belum ada akun dengan data di tabel _fpk', 'tidak ada yang bisa dibandingkan')
    return
  }

  for (const a of accounts) {
    console.log(`\n  ${a.username} [${a.platform}] data_source=${a.data_source}`)

    if (a.platform === 'instagram') {
      const src = await one(
        `SELECT COALESCE(sum(profile_visit), 0)::bigint v FROM l0_extra.ig_profile_fpk
         WHERE social_account_id = $1`, [a.id])
      const harm = await one(
        `SELECT COALESCE(sum(profile_visit), 0)::bigint v FROM l0_harmonization.instagram_profile
         WHERE brand_id = $1`, [a.id])
      const silver = await one(
        `SELECT COALESCE(sum(profile_visit), 0)::bigint v FROM l1_silver.unified_profile
         WHERE brand_id = $1`, [a.id])
      // CATATAN: di l2_gold.brand_metric_daily, brand_id = public.brands.id dan
      // account_id = social_accounts.id — kebalikan dari layer lain.
      const gold = await one(
        `SELECT COALESCE(sum(profile_visit_sum), 0)::bigint v FROM l2_gold.brand_metric_daily
         WHERE account_id = $1`, [a.id])
      compare('profile_visit', src.v, harm.v, silver.v, gold.v)
    }

    if (a.platform === 'tiktok') {
      const src = await one(
        `SELECT COALESCE(sum(video_views), 0)::bigint vv,
                COALESCE(sum(profile_views), 0)::bigint pv,
                COALESCE(sum(shares), 0)::bigint sh
         FROM l0_extra.tt_profile_fpk WHERE social_account_id = $1`, [a.id])
      const harm = await one(
        `SELECT COALESCE(sum(video_views), 0)::bigint vv,
                COALESCE(sum(profile_views), 0)::bigint pv,
                COALESCE(sum(shares), 0)::bigint sh
         FROM l0_harmonization.tiktok_profile WHERE brand_id = $1`, [a.id])
      const silver = await one(
        `SELECT COALESCE(sum(content_views), 0)::bigint vv,
                COALESCE(sum(profile_visit), 0)::bigint pv
         FROM l1_silver.unified_profile WHERE brand_id = $1`, [a.id])
      // harmonization menampung nilai dari API DAN dari FPK, jadi jumlahnya bisa
      // LEBIH BESAR dari sumber _fpk. Yang tidak boleh: lebih kecil.
      atLeast('video_views  fpk→harmonization', src.vv, harm.vv)
      atLeast('video_views  harmonization→silver (content_views)', src.vv, silver.vv)
      atLeast('profile_views fpk→harmonization', src.pv, harm.pv)
      atLeast('profile_views harmonization→silver (profile_visit)', src.pv, silver.pv)
      atLeast('shares       fpk→harmonization', src.sh, harm.sh)

      const psrc = await one(
        `SELECT COALESCE(sum(saves), 0)::bigint s FROM l0_extra.tt_post_fpk
         WHERE social_account_id = $1`, [a.id])
      const pharm = await one(
        `SELECT COALESCE(sum(saves), 0)::bigint s FROM l0_harmonization.tiktok_post
         WHERE brand_id = $1`, [a.id])
      const psilver = await one(
        `SELECT COALESCE(sum(saves), 0)::bigint s FROM l1_silver.unified_post
         WHERE brand_id = $1`, [a.id])
      atLeast('post saves   fpk→harmonization', psrc.s, pharm.s)
      atLeast('post saves   harmonization→silver', psrc.s, psilver.s)
    }
  }
}

function compare(label, src, harm, silver, gold) {
  const s = BigInt(src)
  if (s === 0n) { warn(`${label}: sumber kosong, tidak ada yang dibandingkan`); return }
  const trail = `fpk=${src} harmonization=${harm} silver=${silver} gold=${gold}`
  if (BigInt(harm) >= s && BigInt(silver) >= s && BigInt(gold) >= s) ok(label, trail)
  else bad(`${label} terputus di rantai`, trail)
}

function atLeast(label, src, downstream) {
  const s = BigInt(src)
  if (s === 0n) { warn(`${label}: sumber kosong`); return }
  BigInt(downstream) >= s
    ? ok(label, `${src} → ${downstream}`)
    : bad(`${label} terputus`, `sumber ${src} tapi hilir hanya ${downstream}`)
}

async function checkKnownGaps() {
  console.log('\n3. GAP YANG MEMANG BELUM DITUTUP (bukan kegagalan)')

  const fbAudienceWired = await one(
    `SELECT prosrc LIKE '%facebook_audience%' AS w FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'l1_silver' AND p.proname = 'sp_sync_unified_audience'`)
  warn('demografi Facebook',
       fbAudienceWired?.w
         ? 'sp_sync_unified_audience SUDAH membacanya — gap ini tertutup'
         : 'sp_sync_unified_audience hanya membaca instagram_audience')

  const deep = await one(
    `SELECT count(total_watch_time)::int n FROM l0_extra.tt_post_fpk`)
  warn('11 metrik terdalam tt_post_fpk',
       `${deep.n} baris punya total_watch_time; belum ada kolom di harmonization`)
}

;(async () => {
  await client.connect()
  const db = await one('SELECT current_database() d')
  console.log(`Database: ${db.d}`)

  try {
    await checkWiring()
    await checkChain()
    await checkKnownGaps()
  } finally {
    await client.end()
  }

  console.log()
  if (problems.length) {
    console.log(`${problems.length} masalah:`)
    for (const p of problems) console.log(`  - ${p}`)
    process.exit(1)
  }
  console.log('Rantai FPK utuh.')
})().catch(err => {
  console.error('ERROR:', err.message)
  process.exit(1)
})
