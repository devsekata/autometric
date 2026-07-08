/**
 * Creates a dedicated dummy brand ("Fibo Demo") in the user's org and fills its
 * L0 layer (l0_raw + l0_harmonization + l0_extra) for two months — May 2026
 * (previous) and June 2026 (current) — across Instagram, Facebook and TikTok.
 *
 * Values grow in a Fibonacci-ish shape, with the current month scaled up vs the
 * previous month so the report's Gap% is positive. A dedicated brand avoids any
 * collision with real data and is fully idempotent (its L0 is cleared + rebuilt).
 *
 * The medallion pipeline (L0 -> l1_silver -> l2_gold) is EXTERNAL and must be run
 * afterwards to surface this in the report. This script only writes L0 + the
 * brand/social-account rows it needs.
 *
 * Usage:  node scripts/seed-l0-dummy.js
 */
const { Client } = require('pg')
require('dotenv').config({ path: '.env.local' })

const client = new Client({ connectionString: process.env.DATABASE_URL })

// ── target: org "gg" (user is ADMIN) + platform ids ───────────────────────────
const ORG_ID = 'b33c9046-684b-420b-b581-7df1434a8854'
const BRAND_NAME = 'Fibo Demo'
const PLAT = {
  facebook: '1615369d-a93e-4e96-ad99-e439157898ef',
  instagram: 'bf74ed80-2742-43f5-9278-0b2bbdd14866',
  tiktok: '0026e801-805d-4027-948c-3046bf2b8ac8',
}
const PUID = { instagram: 'fibo-ig', facebook: 'fibo-fb', tiktok: 'fibo-tt' }

// previous vs current month; `scale` grows the current month for positive gaps
const MONTHS = [
  { y: 2026, m: 5, scale: 1.0 },    // May — previous
  { y: 2026, m: 6, scale: 1.618 },  // June — current
]
const POSTS_PER_MONTH = 10
const FIB = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]

// populated by setup()
const ACC = { instagram: null, facebook: null, tiktok: null }

// ── helpers ───────────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0')
const daysInMonth = (y, m) => new Date(y, m, 0).getDate()
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
const ts = (y, m, d, h = 12) => new Date(`${ymd(y, m, d)}T${pad(h)}:00:00`)
const R = (n) => Math.round(n)
const PILLARS = ['Awareness', 'Engagement', 'Promo', 'Education', 'Community', 'Behind The Scenes']
const OFFERINGS = ['Produk Utama', 'Produk Baru', 'Layanan', 'Kampanye Musiman', 'Kolaborasi']
const IG_TYPES = ['IMAGE', 'CAROUSEL_ALBUM', 'VIDEO', 'REELS']
const IG_FORMATS = ['feed', 'reels', 'carousel']
const FB_TYPES = ['photo', 'video', 'link']
const FB_FORMATS = ['photo', 'video', 'link']
const TT_FORMATS = ['video', 'photo']

async function bulk(table, cols, rows) {
  if (!rows.length) return
  const CHUNK = 300
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const params = []
    const tuples = slice.map((r) => {
      const ph = cols.map((c) => { params.push(r[c] === undefined ? null : r[c]); return '$' + params.length })
      return '(' + ph.join(',') + ')'
    })
    const override = cols.includes('id') ? ' OVERRIDING SYSTEM VALUE' : ''
    await client.query(
      `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(',')})${override} VALUES ${tuples.join(',')}`,
      params,
    )
  }
}

// manual id counters for l0_harmonization / l0_extra (GENERATED ALWAYS AS IDENTITY)
const idBase = {}
const HARM_TABLES = [
  'l0_harmonization.instagram_profile', 'l0_harmonization.instagram_post', 'l0_extra.instagram_post_extra_attribute',
  'l0_harmonization.facebook_profile', 'l0_harmonization.facebook_post', 'l0_extra.facebook_post_extra_attribute',
  'l0_harmonization.tiktok_profile', 'l0_harmonization.tiktok_post', 'l0_extra.tiktok_post_extra_attribute',
]
const nextId = (t) => { idBase[t] = Number(idBase[t]) + 1; return idBase[t] }

// ── setup: create/reuse dummy brand + social accounts ─────────────────────────
async function setup() {
  // brand
  let b = await client.query(`SELECT id FROM brands WHERE organization_id=$1 AND name=$2`, [ORG_ID, BRAND_NAME])
  let brandId = b.rows[0]?.id
  if (!brandId) {
    b = await client.query(
      `INSERT INTO brands (organization_id, name, profile_url) VALUES ($1,$2,$3) RETURNING id`,
      [ORG_ID, BRAND_NAME, 'dummy://brand'],
    )
    brandId = b.rows[0].id
  }
  // social accounts + links
  for (const key of ['instagram', 'facebook', 'tiktok']) {
    let sa = await client.query(`SELECT id FROM social_accounts WHERE platform_id=$1 AND platform_user_id=$2`, [PLAT[key], PUID[key]])
    let accId = sa.rows[0]?.id
    if (!accId) {
      const username = key === 'tiktok' ? 'fibodemo.id' : 'fibodemo.official'
      sa = await client.query(
        `INSERT INTO social_accounts (platform_id, platform_user_id, username, connected, connected_at, avatar_url, profile_url)
         VALUES ($1,$2,$3,true,now(),$4,$5) RETURNING id`,
        [PLAT[key], PUID[key], username, 'dummy://avatar', `dummy://${key}`],
      )
      accId = sa.rows[0].id
    }
    const link = await client.query(`SELECT 1 FROM brand_social_accounts WHERE brand_id=$1 AND social_account_id=$2`, [brandId, accId])
    if (!link.rows.length) {
      await client.query(`INSERT INTO brand_social_accounts (brand_id, social_account_id, platform_id) VALUES ($1,$2,$3)`, [brandId, accId, PLAT[key]])
    }
    ACC[key] = accId
  }
  return brandId
}

// ── cleanup: wipe this dummy brand's L0 (dedicated accounts → fully safe) ──────
async function cleanup() {
  const map = [
    ['l0_raw.ig_profile_snapshots', 'social_account_id', ACC.instagram],
    ['l0_harmonization.instagram_profile', 'brand_id', ACC.instagram],
    ['l0_raw.ig_media_snapshots', 'social_account_id', ACC.instagram],
    ['l0_harmonization.instagram_post', 'brand_id', ACC.instagram],
    ['l0_extra.instagram_post_extra_attribute', 'brand_id', ACC.instagram],
    ['l0_raw.fb_profile_snapshots', 'social_account_id', ACC.facebook],
    ['l0_harmonization.facebook_profile', 'brand_id', ACC.facebook],
    ['l0_raw.fb_post_snapshots', 'social_account_id', ACC.facebook],
    ['l0_harmonization.facebook_post', 'brand_id', ACC.facebook],
    ['l0_extra.facebook_post_extra_attribute', 'brand_id', ACC.facebook],
    ['l0_raw.tt_profile_snapshots', 'social_account_id', ACC.tiktok],
    ['l0_harmonization.tiktok_profile', 'brand_id', ACC.tiktok],
    ['l0_raw.tt_video_snapshots', 'social_account_id', ACC.tiktok],
    ['l0_harmonization.tiktok_post', 'brand_id', ACC.tiktok],
    ['l0_extra.tiktok_post_extra_attribute', 'brand_id', ACC.tiktok],
  ]
  for (const [tbl, col, val] of map) await client.query(`DELETE FROM ${tbl} WHERE ${col}=$1`, [val])
}

// ── Instagram ─────────────────────────────────────────────────────────────────
async function seedIG() {
  const sid = ACC.instagram
  const rawProf = [], harmProf = [], rawMedia = [], harmPost = [], extra = []
  let followers = 50000
  for (const mo of MONTHS) {
    const dim = daysInMonth(mo.y, mo.m)
    for (let d = 1; d <= dim; d++) {
      const s = mo.scale
      followers += R(30 * s)
      const reach = R((6000 + d * 180) * s), engaged = R((800 + d * 40) * s)
      const likes = R((1500 + d * 60) * s), comments = R((120 + d * 6) * s)
      const shares = R((60 + d * 4) * s), saves = R((80 + d * 5) * s)
      const date = ymd(mo.y, mo.m, d)
      rawProf.push({
        social_account_id: sid, fetched_at: ts(mo.y, mo.m, d), username: 'fibodemo.official', name: BRAND_NAME,
        biography: `${BRAND_NAME} IG`, website: 'https://fibodemo.id',
        followers_count: followers, follows_count: 500, media_count: 300,
        accounts_engaged: engaged, comments, likes, profile_links_taps: R(200 * s), reach,
        replies: R(60 * s), reposts: R(20 * s), saves, shares,
        total_interactions: likes + comments + shares + saves, views: R((9000 + d * 200) * s),
        demographics_age: { '18-24': R(3000 * s), '25-34': R(4000 * s), '35-44': R(1500 * s) },
        demographics_gender: { female: R(5000 * s), male: R(4000 * s) },
        demographics_city: { Jakarta: R(3000 * s), Surabaya: R(1500 * s), Bandung: R(1200 * s) },
        demographics_country: { ID: R(8000 * s), MY: R(1200 * s) },
      })
      harmProf.push({
        id: nextId('l0_harmonization.instagram_profile'), brand_id: sid, date, bio: `${BRAND_NAME}`,
        website: 'https://fibodemo.id', follower_count: followers, following_count: 500,
        account_total_post_count: 300, followers_growth: R(30 * s), profile_reach: reach,
        profile_visit: R((400 + d * 20) * s), content_views: R((12000 + d * 300) * s), profile_link_taps: R(200 * s),
        likes, comments, shares, saves, replies: R(60 * s), repost: R(20 * s),
        total_interactions: likes + comments + shares + saves, accounts_engaged: engaged,
      })
    }
    for (let p = 0; p < POSTS_PER_MONTH; p++) {
      const base = FIB[p] * mo.scale
      const day = 1 + Math.floor((p / POSTS_PER_MONTH) * (dim - 1))
      const date = ts(mo.y, mo.m, day, 9 + (p % 12))
      const mid = `dummy-ig-${mo.y}${pad(mo.m)}-${p}`
      const ptype = IG_TYPES[p % IG_TYPES.length]
      const isVideo = ptype === 'REELS' || ptype === 'VIDEO'
      const reach = R(base * 700), likes = R(base * 45), comments = R(base * 7)
      const shares = R(base * 5), saves = R(base * 4)
      const views = isVideo ? R(base * 1400) : 0
      const dur = isVideo ? 60 : null
      const watch = isVideo ? Math.min(55, R(8 + base * 0.8)) : null // seconds
      const slides = ptype === 'CAROUSEL_ALBUM' ? 4 : null
      const link = `https://instagram.com/p/${mid}`
      const total = likes + comments + shares + saves
      rawMedia.push({
        social_account_id: sid, media_id: mid, fetched_at: ts(mo.y, mo.m, dim), posted_at: date,
        caption: `IG post ${p}`, media_type: ptype, permalink: link, cover_image: 'dummy://cover',
        reach, saved: saves, comments, shares, total_interactions: total, likes, views,
        reposts: R(base * 0.5), follows: R(base * 3), profile_visits: R(base * 6),
        reel_avg_watch_time: watch, reel_video_view_total_time: views ? views * 8 : null,
        video_duration: dur, carousel_media_count: slides,
      })
      const harmId = nextId('l0_harmonization.instagram_post')
      harmPost.push({
        id: harmId, brand_id: sid, post_id: mid, post_date: date, caption: `IG post ${p}`, link,
        post_type: ptype, duration_s: dur, slide_count: slides, views, reach, likes, comments, shares, saves,
        repost: R(base * 0.5), total_interactions: total, follows: R(base * 3), profile_visits: R(base * 6),
        reel_avg_watch_time: watch ?? 0, reel_video_view_total_time: views ? views * 8 : 0, cover_image: 'dummy://cover',
      })
      extra.push({
        id: nextId('l0_extra.instagram_post_extra_attribute'), brand_id: sid, instagram_post_id: harmId, post_id: mid,
        content_pillar: PILLARS[p % PILLARS.length], brand_offering: OFFERINGS[p % OFFERINGS.length],
        format: IG_FORMATS[p % IG_FORMATS.length], is_collab: false, is_aon: true, is_campaign: p % 4 === 0,
        is_activity: false, is_event: false, is_boosted: p % 3 === 0, repost: false,
      })
    }
  }
  await bulk('l0_raw.ig_profile_snapshots', Object.keys(rawProf[0]), rawProf)
  await bulk('l0_harmonization.instagram_profile', Object.keys(harmProf[0]), harmProf)
  await bulk('l0_raw.ig_media_snapshots', Object.keys(rawMedia[0]), rawMedia)
  await bulk('l0_harmonization.instagram_post', Object.keys(harmPost[0]), harmPost)
  await bulk('l0_extra.instagram_post_extra_attribute', Object.keys(extra[0]), extra)
  return { profiles: harmProf.length, posts: harmPost.length }
}

// ── Facebook ──────────────────────────────────────────────────────────────────
async function seedFB() {
  const sid = ACC.facebook
  const rawProf = [], harmProf = [], rawPost = [], harmPost = [], extra = []
  let followers = 120000
  for (const mo of MONTHS) {
    const dim = daysInMonth(mo.y, mo.m)
    for (let d = 1; d <= dim; d++) {
      const s = mo.scale
      followers += R(25 * s)
      const reach = R((5000 + d * 150) * s), interactions = R((600 + d * 30) * s), clicks = R((150 + d * 8) * s)
      const date = ymd(mo.y, mo.m, d)
      rawProf.push({
        social_account_id: sid, fetched_at: ts(mo.y, mo.m, d), page_id: 'fbpage-fibo', name: BRAND_NAME,
        about: `${BRAND_NAME} FB`, category: 'Brand', website: 'https://fibodemo.id',
        fan_count: followers, followers_count: followers, cover_url: 'dummy://cover', avatar_url: 'dummy://avatar',
        page_link: 'https://facebook.com/fibodemo', page_follows: followers, page_daily_follows_unique: R(80 * s),
        page_media_view: R((12000 + d * 300) * s), page_total_media_view_unique: R((8000 + d * 200) * s),
        page_video_views: R((6000 + d * 200) * s), page_views_total: R((5000 + d * 150) * s),
        content_interactions: interactions, link_clicks: clicks, profile_reach: reach,
      })
      harmProf.push({
        id: nextId('l0_harmonization.facebook_profile'), brand_id: sid, date, profile_photo: 'dummy://avatar',
        follower_count: followers, page_like_count: followers - 1500, follows_increase: R(25 * s),
        content_interactions: interactions, link_clicks: clicks, profile_reach: reach,
        content_views: R((12000 + d * 300) * s), profile_visit: R((350 + d * 18) * s),
      })
    }
    for (let p = 0; p < POSTS_PER_MONTH; p++) {
      const base = FIB[p] * mo.scale
      const day = 1 + Math.floor((p / POSTS_PER_MONTH) * (dim - 1))
      const date = ts(mo.y, mo.m, day, 9 + (p % 12))
      const pid = `dummy-fb-${mo.y}${pad(mo.m)}-${p}`
      const ptype = FB_TYPES[p % FB_TYPES.length]
      const reactions = R(base * 40), likes = R(reactions * 0.8), comments = R(base * 6), shares = R(base * 4)
      const reach = R(base * 650), impressions = reach + R(base * 900), clicks = R(base * 8)
      const vviews = ptype === 'video' ? R(base * 1200) : 0
      const link = `https://facebook.com/fibodemo/posts/${pid}`
      rawPost.push({
        social_account_id: sid, post_id: pid, fetched_at: ts(mo.y, mo.m, dim), posted_at: date,
        message: `FB post ${p}`, story: null, full_picture: 'dummy://cover', permalink_url: link,
        post_type: ptype, reactions_count: reactions, likes_count: likes, comments_count: comments,
        shares_count: shares, impressions, reach, clicks,
        reactions_by_type: { like: likes, love: R(base * 3), haha: R(base), wow: R(base * 0.5), sad: 0, angry: 0 },
        video_views: vviews,
      })
      const harmId = nextId('l0_harmonization.facebook_post')
      harmPost.push({
        id: harmId, brand_id: sid, post_id: pid, post_date: date, caption: `FB post ${p}`, link,
        post_type: ptype, reach, impressions, reactions, likes, comments, shares, link_click: clicks,
        video_views: vviews, cover_image: 'dummy://cover',
      })
      extra.push({
        id: nextId('l0_extra.facebook_post_extra_attribute'), brand_id: sid, facebook_post_id: harmId, post_id: pid,
        content_pillar: PILLARS[p % PILLARS.length], brand_offering: OFFERINGS[p % OFFERINGS.length],
        format: FB_FORMATS[p % FB_FORMATS.length], is_collab: false, is_aon: true, is_campaign: p % 4 === 0,
        is_boosted: p % 3 === 0, is_activity: false, is_event: false,
      })
    }
  }
  await bulk('l0_raw.fb_profile_snapshots', Object.keys(rawProf[0]), rawProf)
  await bulk('l0_harmonization.facebook_profile', Object.keys(harmProf[0]), harmProf)
  await bulk('l0_raw.fb_post_snapshots', Object.keys(rawPost[0]), rawPost)
  await bulk('l0_harmonization.facebook_post', Object.keys(harmPost[0]), harmPost)
  await bulk('l0_extra.facebook_post_extra_attribute', Object.keys(extra[0]), extra)
  return { profiles: harmProf.length, posts: harmPost.length }
}

// ── TikTok ────────────────────────────────────────────────────────────────────
async function seedTT() {
  const sid = ACC.tiktok
  const rawProf = [], harmProf = [], rawVid = [], harmPost = [], extra = []
  let followers = 190000, totalLikes = 500000
  for (const mo of MONTHS) {
    const dim = daysInMonth(mo.y, mo.m)
    for (let d = 1; d <= dim; d++) {
      const s = mo.scale
      const newF = R((120 + d * 6) * s), lostF = R((30 + d * 2) * s)
      followers += newF - lostF
      totalLikes += R(3000 * s)
      const date = ymd(mo.y, mo.m, d)
      rawProf.push({
        social_account_id: sid, fetched_at: ts(mo.y, mo.m, d), open_id: 'tt-fibo', display_name: BRAND_NAME,
        bio_description: `${BRAND_NAME} TT`, avatar_url: 'dummy://avatar', is_verified: true,
        follower_count: followers, following_count: 200, likes_count: totalLikes, video_count: 300,
      })
      harmProf.push({
        id: nextId('l0_harmonization.tiktok_profile'), brand_id: sid, date, bio: `${BRAND_NAME}`,
        follower_count: followers, following_count: 200, account_total_post_count: 300,
        video_views: R((60000 + d * 1500) * s), profile_reach: R((20000 + d * 500) * s),
        profile_views: R((3000 + d * 120) * s), likes: R((8000 + d * 200) * s), comments: R((600 + d * 20) * s),
        shares: R((400 + d * 15) * s), net_growth: newF - lostF, new_followers: newF, lost_followers: lostF,
        is_verified: true, followers_growth: newF - lostF,
      })
    }
    for (let p = 0; p < POSTS_PER_MONTH; p++) {
      const base = FIB[p] * mo.scale
      const day = 1 + Math.floor((p / POSTS_PER_MONTH) * (dim - 1))
      const date = ts(mo.y, mo.m, day, 9 + (p % 12))
      const vid = `dummy-tt-${mo.y}${pad(mo.m)}-${p}`
      const views = R(base * 4000), likes = R(base * 200), comments = R(base * 12)
      const shares = R(base * 20), saves = R(base * 10), dur = 45
      const watch = Math.min(42, R(6 + base * 0.6)) // seconds
      const link = `https://tiktok.com/@fibodemo.id/video/${vid}`
      rawVid.push({
        social_account_id: sid, video_id: vid, fetched_at: ts(mo.y, mo.m, dim), posted_at: date,
        title: `TT ${p}`, description: `TT post ${p}`, duration: dur, cover_image_url: 'dummy://cover',
        share_url: link, like_count: likes, comment_count: comments, share_count: shares, view_count: views,
        engagement_rate: +(((likes + comments + shares) / views) * 100).toFixed(2),
      })
      const harmId = nextId('l0_harmonization.tiktok_post')
      harmPost.push({
        id: harmId, brand_id: sid, post_id: vid, post_date: date, title: `TT ${p}`,
        caption: `TT post ${p}`, link, cover_image: 'dummy://cover', post_type: 'video',
        slide_count: null, video_duration: dur, views, likes, comments, shares, saves,
      })
      extra.push({
        id: nextId('l0_extra.tiktok_post_extra_attribute'), brand_id: sid, tiktok_post_id: harmId, post_id: vid,
        content_pillar: PILLARS[p % PILLARS.length], brand_offering: OFFERINGS[p % OFFERINGS.length],
        format: TT_FORMATS[p % TT_FORMATS.length], avg_watch_time: watch, reach_post: R(base * 3500),
        completion_rate: `${Math.min(95, 40 + R(base))}%`, is_boosted: p % 3 === 0, is_collab: false,
        is_aon: true, is_campaign: p % 4 === 0, is_activity: false, is_event: false,
      })
    }
  }
  await bulk('l0_raw.tt_profile_snapshots', Object.keys(rawProf[0]), rawProf)
  await bulk('l0_harmonization.tiktok_profile', Object.keys(harmProf[0]), harmProf)
  await bulk('l0_raw.tt_video_snapshots', Object.keys(rawVid[0]), rawVid)
  await bulk('l0_harmonization.tiktok_post', Object.keys(harmPost[0]), harmPost)
  await bulk('l0_extra.tiktok_post_extra_attribute', Object.keys(extra[0]), extra)
  return { profiles: harmProf.length, posts: harmPost.length }
}

async function main() {
  await client.connect()
  console.log('Connected:', (await client.query('SELECT current_database() d')).rows[0].d)
  await client.query('BEGIN')

  const brandId = await setup()
  console.log(`Brand "${BRAND_NAME}" = ${brandId}`)
  console.log(`Accounts: IG=${ACC.instagram} FB=${ACC.facebook} TT=${ACC.tiktok}`)
  await cleanup()
  for (const t of HARM_TABLES) {
    idBase[t] = Number((await client.query(`SELECT COALESCE(MAX(id),0)::bigint m FROM ${t}`)).rows[0].m)
  }

  const ig = await seedIG()
  const fb = await seedFB()
  const tt = await seedTT()

  await client.query('COMMIT')
  console.log('\n=== Seeded L0 dummy (Fibo Demo, May + June 2026) ===')
  console.log(`  Instagram: ${ig.profiles} profile-days, ${ig.posts} posts`)
  console.log(`  Facebook:  ${fb.profiles} profile-days, ${fb.posts} posts`)
  console.log(`  TikTok:    ${tt.profiles} profile-days, ${tt.posts} posts`)
  console.log('\nNext: run the medallion pipeline (L0 -> l1_silver -> l2_gold),')
  console.log('then open org "gg" report, brand "Fibo Demo", period = June 2026 (vs May).')
  await client.end()
}

main().catch(async (e) => {
  console.error('ERROR:', e.message)
  try { await client.query('ROLLBACK') } catch {}
  process.exit(1)
})
