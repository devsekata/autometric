/**
 * Seeds the database from `users` down through the entire L0 layer:
 *   public  -> users, organizations, organization_members, brands,
 *              social_accounts, brand_social_accounts, brand_competitors
 *   l0_raw  -> own-account snapshots/posts/comments/stories + competitor data
 *   l0_harmonization -> per-platform profile/post/comment/story/audience/tagged
 *   l0_extra         -> per-post extra attributes
 *
 * Volume (per request): 3 orgs, 6 brands, 18 social accounts (IG/FB/TikTok),
 * 60 days of daily snapshots, ~30 posts per account, competitors included.
 * Images use placeholder services (ui-avatars / picsum). Fictional brands.
 *
 * Idempotent: truncates every data table (except platforms + pgmigrations)
 * before inserting, so it can be re-run safely. Runs in one transaction.
 *
 * Usage:  npm run seed:l0   (or)   node scripts/seed-l0.js
 */
const { Client } = require('pg')
const bcrypt = require('bcryptjs')
require('dotenv').config({ path: '.env.local' })

const DAYS = 60
const POSTS_PER_ACCOUNT = 30
const client = new Client({ connectionString: process.env.DATABASE_URL })

// ---------- helpers ----------
let SEED = 12345
const rnd = () => { SEED = (SEED * 1103515245 + 12345) & 0x7fffffff; return SEED / 0x7fffffff }
const ri = (min, max) => Math.floor(rnd() * (max - min + 1)) + min
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const chance = (p) => rnd() < p
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const dayDate = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d }
// hour-of-day pool weighted toward typical posting windows (midday + evening),
// so post timestamps spread across hours and the "Best Posting Times" heatmap shows a pattern
const HOUR_POOL = [7, 8, 9, 10, 11, 11, 12, 12, 12, 13, 13, 15, 16, 17, 18, 18, 19, 19, 20, 20, 20, 21, 21, 22]
const postDate = (maxDaysAgo) => { const d = dayDate(ri(0, maxDaysAgo)); d.setHours(pick(HOUR_POOL), ri(0, 59), 0, 0); return d }
const ymd = (d) => d.toISOString().slice(0, 10)
const avatar = (name, color) => `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${color}&color=fff&size=256&bold=true`
const cover = (seed) => `https://picsum.photos/seed/${encodeURIComponent(seed)}/800/800`

async function bulk(table, cols, rows) {
  if (!rows.length) return
  const CHUNK = 400
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const params = []
    const tuples = slice.map((r) => {
      const ph = cols.map((c) => { params.push(r[c] === undefined ? null : r[c]); return '$' + params.length })
      return '(' + ph.join(',') + ')'
    })
    // l0_harmonization / l0_extra ids are GENERATED ALWAYS AS IDENTITY;
    // we assign them manually, so override the identity sequence.
    const override = cols.includes('id') ? ' OVERRIDING SYSTEM VALUE' : ''
    await client.query(
      `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(',')})${override} VALUES ${tuples.join(',')}`,
      params,
    )
  }
}

// integer-PK counters for l0_extra / l0_harmonization (no sequences on these tables)
const counters = {}
const nextId = (k) => (counters[k] = (counters[k] || 0) + 1)

// ---------- static content pools ----------
const ORG_NAMES = ['Nimbus Group', 'Andalan Digital', 'Sahaja Media']
const BRANDS = [
  { name: 'Kopiku', color: '6F4E37' },
  { name: 'Rasawangi', color: 'C0392B' },
  { name: 'GerakFit', color: '27AE60' },
  { name: 'TaniMaju', color: '8E6E2A' },
  { name: 'BiruLaut', color: '2980B9' },
  { name: 'NusaWear', color: '8E44AD' },
]
const PILLARS = ['Awareness', 'Engagement', 'Promo', 'Education', 'Community', 'Behind The Scenes']
const OFFERINGS = ['Produk Utama', 'Produk Baru', 'Layanan', 'Kampanye Musiman', 'Kolaborasi']
const CAPTIONS = [
  'Mulai harimu bersama kami ☕️ #SemangatPagi',
  'Promo spesial minggu ini, jangan sampai kelewatan! 🔥',
  'Terima kasih atas dukungan kalian semua 🙏 #Komunitas',
  'Tips & trik biar makin produktif 💡',
  'Behind the scenes proses produksi kami 🎬',
  'Giveaway! Tag 3 temanmu untuk ikutan 🎁',
  'Produk baru sudah tersedia, cek sekarang juga! 🛍️',
  'Cerita di balik brand kami, dari nol sampai sekarang 🚀',
  'Kolaborasi seru bareng partner favorit kami ❤️',
  'Weekend vibes! Apa rencana kalian? 🌤️',
]
const COMMENTS = [
  'Keren banget!', 'Mantap 🔥', 'Pengen coba dong', 'Sukses terus ya!', 'Harganya berapa kak?',
  'Sudah langganan nih 😍', 'Ditunggu produk berikutnya', 'Bagus konsepnya', 'Lokasi dimana ya?',
  'Recommended banget!', 'Kualitasnya juara', 'Min, ada diskon ga?',
]
const USERNAMES_POOL = ['andi', 'budi', 'citra', 'dewi', 'eka', 'fajar', 'gita', 'hadi', 'indah', 'joko', 'kiki', 'lina']

const IG_POST_TYPES = ['IMAGE', 'CAROUSEL_ALBUM', 'VIDEO', 'REELS']
const FB_POST_TYPES = ['photo', 'video', 'link', 'status']
const TT_POST_TYPES = ['video', 'photo']
const IG_FORMATS = ['feed', 'reels', 'carousel', 'story']
const FB_FORMATS = ['photo', 'video', 'link']
const TT_FORMATS = ['video', 'photo']

const AGE_BUCKETS = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+']
const GENDERS = ['female', 'male', 'unknown']
const CITIES = ['Jakarta', 'Surabaya', 'Bandung', 'Medan', 'Semarang', 'Makassar', 'Yogyakarta', 'Denpasar', 'Palembang', 'Bekasi']
const COUNTRIES = ['ID', 'MY', 'SG', 'US', 'AU']

async function main() {
  await client.connect()
  console.log('Connected:', (await client.query('SELECT current_database() d')).rows[0].d)

  // platform map
  const { rows: plats } = await client.query('SELECT id, key FROM platforms')
  const PLAT = Object.fromEntries(plats.map((p) => [p.key, p.id]))

  await client.query('BEGIN')

  // ---- truncate all data tables except platforms + pgmigrations ----
  const { rows: tbls } = await client.query(`
    SELECT table_schema s, table_name t FROM information_schema.tables
    WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema')`)
  const keep = new Set(['public.platforms', 'public.pgmigrations'])
  const targets = tbls.map((r) => `"${r.s}"."${r.t}"`).filter((_, i) => !keep.has(`${tbls[i].s}.${tbls[i].t}`))
  await client.query(`TRUNCATE ${targets.join(', ')} RESTART IDENTITY CASCADE`)
  console.log(`Truncated ${targets.length} tables.`)

  // ---------- USERS ----------
  const pwHash = await bcrypt.hash('password123', 10)
  const users = []
  const userDefs = [
    { email: 'dev.sekata@gmail.com', name: 'Dev Sekata', role: 'ADMIN' },
    { email: 'owner1@autometric.test', name: 'Rina Owner', role: 'USER' },
    { email: 'owner2@autometric.test', name: 'Bayu Owner', role: 'USER' },
    { email: 'owner3@autometric.test', name: 'Sari Owner', role: 'USER' },
    { email: 'member1@autometric.test', name: 'Tio Member', role: 'USER' },
    { email: 'member2@autometric.test', name: 'Maya Member', role: 'USER' },
  ]
  for (const u of userDefs) {
    const { rows } = await client.query(
      `INSERT INTO users (email, name, password_hash, email_verified, role, avatar_url)
       VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [u.email, u.name, pwHash, u.role, avatar(u.name, '4A90D9')],
    )
    users.push({ ...u, id: rows[0].id })
  }
  console.log(`Users: ${users.length}`)

  // ---------- ORGANIZATIONS + MEMBERS ----------
  const orgs = []
  for (let i = 0; i < ORG_NAMES.length; i++) {
    const owner = users[i + 1] // owner1..3
    const { rows } = await client.query(
      `INSERT INTO organizations (name, slug, created_by) VALUES ($1,$2,$3) RETURNING id`,
      [ORG_NAMES[i], slug(ORG_NAMES[i]), owner.id],
    )
    const orgId = rows[0].id
    orgs.push({ id: orgId, name: ORG_NAMES[i], ownerId: owner.id })
    // owner as ADMIN/ACTIVE
    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, email, role, status, joined_at, invited_by)
       VALUES ($1,$2,$3,'ADMIN','ACTIVE',now(),$2)`,
      [orgId, owner.id, owner.email],
    )
    // one extra member
    const mem = users[4 + (i % 2)]
    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, email, role, status, joined_at, invited_by)
       VALUES ($1,$2,$3,'MEMBER','ACTIVE',now(),$4)`,
      [orgId, mem.id, mem.email, owner.id],
    )
  }
  console.log(`Organizations: ${orgs.length}`)

  // ---------- BRANDS + SOCIAL ACCOUNTS ----------
  // 6 brands across 3 orgs (2 per org); each brand: IG + FB + TikTok account
  const accounts = [] // { id, platformKey, brand, username }
  for (let b = 0; b < BRANDS.length; b++) {
    const org = orgs[Math.floor(b / 2)]
    const brandDef = BRANDS[b]
    const { rows: br } = await client.query(
      `INSERT INTO brands (organization_id, name, profile_url) VALUES ($1,$2,$3) RETURNING id`,
      [org.id, brandDef.name, avatar(brandDef.name, brandDef.color)],
    )
    const brandId = br[0].id
    const handle = slug(brandDef.name).replace(/-/g, '')

    for (const key of ['instagram', 'facebook', 'tiktok']) {
      const username = key === 'tiktok' ? `${handle}.id` : `${handle}.official`
      const { rows: sa } = await client.query(
        `INSERT INTO social_accounts (platform_id, platform_user_id, username, connected, connected_at, avatar_url, profile_url)
         VALUES ($1,$2,$3,true,now(),$4,$5) RETURNING id`,
        [PLAT[key], `${key}_${1000 + b}`, username, avatar(brandDef.name, brandDef.color),
         key === 'instagram' ? `https://instagram.com/${username}` : key === 'facebook' ? `https://facebook.com/${username}` : `https://tiktok.com/@${username}`],
      )
      const accId = sa[0].id
      await client.query(
        `INSERT INTO brand_social_accounts (brand_id, social_account_id, platform_id) VALUES ($1,$2,$3)`,
        [brandId, accId, PLAT[key]],
      )
      accounts.push({ id: accId, platformKey: key, brandName: brandDef.name, brandId, username, color: brandDef.color })
    }
  }
  console.log(`Brands: ${BRANDS.length}, Social accounts: ${accounts.length}`)

  // ---------- per-account L0 data ----------
  for (const acc of accounts) {
    if (acc.platformKey === 'instagram') await seedInstagram(acc)
    else if (acc.platformKey === 'facebook') await seedFacebook(acc)
    else if (acc.platformKey === 'tiktok') await seedTiktok(acc)
  }

  // ---------- COMPETITORS ----------
  await seedCompetitors(PLAT)

  await client.query('COMMIT')

  // ---------- summary ----------
  const { rows: counts } = await client.query(`
    SELECT table_schema||'.'||table_name name FROM information_schema.tables
    WHERE table_type='BASE TABLE' AND table_schema IN ('public','l0_raw','l0_extra','l0_harmonization')
    ORDER BY 1`)
  let total = 0
  console.log('\n=== Row counts ===')
  for (const r of counts) {
    const { rows } = await client.query(`SELECT count(*)::int c FROM ${r.name}`)
    if (rows[0].c > 0) { console.log(`  ${r.name}: ${rows[0].c}`); total += rows[0].c }
  }
  console.log(`\nTotal seeded rows: ${total}`)
  await client.end()
}

// =====================================================================
// INSTAGRAM
// =====================================================================
async function seedInstagram(acc) {
  const sid = acc.id
  let followers = ri(8000, 80000)

  // --- daily profile snapshots (raw + harmonization) ---
  const rawProf = [], harmProf = [], harmAud = []
  for (let d = DAYS - 1; d >= 0; d--) {
    const date = dayDate(d)
    followers += ri(-50, 350)
    const reach = ri(3000, 30000), engaged = ri(500, 6000)
    const likes = ri(800, 9000), comments = ri(50, 700), shares = ri(20, 400), saves = ri(30, 600)
    rawProf.push({
      social_account_id: sid, fetched_at: date, username: acc.username, name: acc.brandName,
      biography: `${acc.brandName} - akun resmi Instagram`, website: `https://${slug(acc.brandName)}.id`,
      followers_count: followers, follows_count: ri(200, 900), media_count: ri(120, 600),
      accounts_engaged: engaged, comments, likes, profile_links_taps: ri(50, 800), reach,
      replies: ri(10, 200), reposts: ri(5, 90), saves, shares,
      total_interactions: likes + comments + shares + saves, views: ri(5000, 60000),
      demographics_age: Object.fromEntries(AGE_BUCKETS.map((a) => [a, ri(100, 5000)])),
      demographics_gender: { female: ri(1000, 9000), male: ri(1000, 9000) },
      demographics_city: Object.fromEntries(CITIES.map((c) => [c, ri(100, 4000)])),
      demographics_country: Object.fromEntries(COUNTRIES.map((c) => [c, ri(50, 6000)])),
    })
    harmProf.push({
      id: nextId('ig_profile'), brand_id: sid, date: ymd(date), bio: `${acc.brandName} - akun resmi`,
      website: `https://${slug(acc.brandName)}.id`, follower_count: followers, following_count: ri(200, 900),
      account_total_post_count: ri(120, 600), followers_growth: ri(-50, 350), profile_reach: reach,
      profile_visit: ri(200, 3000), content_views: ri(5000, 60000), profile_link_taps: ri(50, 800),
      likes, comments, shares, saves, replies: ri(10, 200), repost: ri(5, 90),
      total_interactions: likes + comments + shares + saves, accounts_engaged: engaged,
    })
  }
  await bulk('l0_raw.ig_profile_snapshots', Object.keys(rawProf[0]), rawProf)
  await bulk('l0_harmonization.instagram_profile', Object.keys(harmProf[0]), harmProf)

  // --- audience (latest date only) ---
  const aDate = ymd(dayDate(0))
  const audType = (type, key, val) => harmAud.push({ id: nextId('ig_aud'), brand_id: sid, date: aDate, audience_type: type, dimension_key: key, dimension_value: val, value: ri(100, 8000) })
  AGE_BUCKETS.forEach((a) => audType('age', 'age', a))
  GENDERS.forEach((g) => audType('gender', 'gender', g))
  CITIES.forEach((c) => audType('city', 'city', c))
  COUNTRIES.forEach((c) => audType('country', 'country', c))
  await bulk('l0_harmonization.instagram_audience', Object.keys(harmAud[0]), harmAud)

  // --- posts (raw media + harmonization post + extra) ---
  const rawMedia = [], harmPost = [], extra = [], rawComments = [], harmComments = []
  for (let p = 0; p < POSTS_PER_ACCOUNT; p++) {
    const date = postDate(DAYS - 1)
    const mediaId = `ig_${sid.slice(0, 8)}_${p}`
    const ptype = pick(IG_POST_TYPES)
    const reach = ri(2000, 40000), likes = ri(200, 8000), comments = ri(5, 500)
    const shares = ri(5, 600), saves = ri(10, 900), views = ptype === 'REELS' || ptype === 'VIDEO' ? ri(5000, 120000) : 0
    const caption = pick(CAPTIONS)
    const permalink = `https://instagram.com/p/${mediaId}`
    const coverImg = cover(`${acc.brandName}-ig-${p}`)
    const dur = ptype === 'REELS' || ptype === 'VIDEO' ? ri(8, 90) : null
    const slides = ptype === 'CAROUSEL_ALBUM' ? ri(2, 8) : null

    rawMedia.push({
      social_account_id: sid, media_id: mediaId, fetched_at: dayDate(0), posted_at: date, caption,
      media_type: ptype, permalink, cover_image: coverImg, reach, saved: saves, comments, shares,
      total_interactions: likes + comments + shares + saves, likes, views,
      reposts: ri(0, 50), follows: ri(0, 120), profile_visits: ri(10, 800),
      reel_avg_watch_time: dur ? +(rnd() * dur).toFixed(2) : null,
      reel_video_view_total_time: views ? views * ri(3, 20) : null,
      video_duration: dur, carousel_media_count: slides,
    })
    const harmId = nextId('ig_post')
    harmPost.push({
      id: harmId, brand_id: sid, post_id: mediaId, post_date: date, caption, link: permalink, post_type: ptype,
      duration_s: dur, slide_count: slides, views, reach, likes, comments, shares, saves, repost: ri(0, 50),
      total_interactions: likes + comments + shares + saves, follows: ri(0, 120), profile_visits: ri(10, 800),
      reel_avg_watch_time: dur ? +(rnd() * dur).toFixed(2) : 0,
      reel_video_view_total_time: views ? views * ri(3, 20) : 0, cover_image: coverImg,
    })
    extra.push({
      id: nextId('ig_extra'), brand_id: sid, instagram_post_id: harmId, post_id: mediaId,
      content_pillar: pick(PILLARS), brand_offering: pick(OFFERINGS), format: pick(IG_FORMATS),
      is_collab: chance(0.2), is_aon: chance(0.5), is_campaign: chance(0.25), is_activity: chance(0.15),
      is_event: chance(0.1), is_boosted: chance(0.3), repost: chance(0.1),
    })
    // comments
    const nc = ri(1, 5)
    for (let c = 0; c < nc; c++) {
      const cid = `${mediaId}_c${c}`
      const ctime = new Date(date.getTime() + ri(1, 72) * 3600000)
      const cuser = `${pick(USERNAMES_POOL)}_${ri(1, 999)}`
      const ctext = pick(COMMENTS)
      const cl = ri(0, 200), rc = ri(0, 20)
      rawComments.push({ social_account_id: sid, media_id: mediaId, comment_id: cid, link_post: permalink, link_comment: `${permalink}/c/${cid}`, comment_time: ctime, comment_text: ctext, comment_username: cuser, likes_count: cl, replies_count: rc, hidden: false, parent_id: null })
      harmComments.push({ id: nextId('ig_comment'), brand_id: sid, post_id: mediaId, post_date: date, comment_id: cid, link_post: permalink, link_comment: `${permalink}/c/${cid}`, comment_time: ctime, comment_text: ctext, comment_username: cuser, likes_count: cl, replies_count: rc })
    }
  }
  await bulk('l0_raw.ig_media_snapshots', Object.keys(rawMedia[0]), rawMedia)
  await bulk('l0_harmonization.instagram_post', Object.keys(harmPost[0]), harmPost)
  await bulk('l0_extra.instagram_post_extra_attribute', Object.keys(extra[0]), extra)
  await bulk('l0_raw.ig_comments', Object.keys(rawComments[0]), rawComments)
  await bulk('l0_harmonization.instagram_comment', Object.keys(harmComments[0]), harmComments)

  // --- stories ---
  const rawStories = [], harmStories = []
  for (let s = 0; s < 18; s++) {
    const date = postDate(DAYS - 1)
    const stId = `ig_story_${sid.slice(0, 8)}_${s}`
    const stype = pick(['IMAGE', 'VIDEO'])
    const reach = ri(1000, 20000), views = ri(1200, 24000)
    const replies = ri(0, 150), shares = ri(0, 90), tf = ri(50, 2000), tb = ri(10, 500), exits = ri(20, 800)
    rawStories.push({ social_account_id: sid, media_id: stId, posted_at: date, media_type: stype, permalink: `https://instagram.com/stories/${acc.username}/${stId}`, media_url: cover(`${stId}`), thumbnail_url: cover(`${stId}-t`), username: acc.username, reach, replies, shares, follows: ri(0, 60), profile_visits: ri(0, 300), profile_activity: ri(0, 200), reposts: ri(0, 30), total_interactions: replies + shares, total_views: views, facebook_views: ri(0, 5000), navigation: { taps_forward: tf, taps_back: tb, exits }, video_duration: stype === 'VIDEO' ? ri(3, 15) : null, fetched_at: dayDate(0) })
    harmStories.push({ id: nextId('ig_story'), brand_id: sid, story_id: stId, date, link: `https://instagram.com/stories/${acc.username}/${stId}`, story_type: stype, reach, views, reposts: ri(0, 30), replies, shares, taps_forward: tf, taps_back: tb, exits, swipe_up: ri(0, 400), follows: ri(0, 60), total_interactions: replies + shares, profile_activity: ri(0, 200), profile_visit: ri(0, 300), link_video_story: stype === 'VIDEO' ? cover(`${stId}`) : null, cover_image: cover(`${stId}-t`) })
  }
  await bulk('l0_raw.ig_stories', Object.keys(rawStories[0]), rawStories)
  await bulk('l0_harmonization.instagram_story', Object.keys(harmStories[0]), harmStories)

  // --- tagged posts ---
  const rawTagged = [], harmTagged = []
  for (let t = 0; t < 6; t++) {
    const date = postDate(DAYS - 1)
    const mid = `ig_tag_${sid.slice(0, 8)}_${t}`
    const tagger = `${pick(USERNAMES_POOL)}_${ri(1, 999)}`
    const ptype = pick(['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM'])
    const lc = ri(10, 3000), cc = ri(0, 200)
    const link = `https://instagram.com/p/${mid}`
    rawTagged.push({ social_account_id: sid, media_id: mid, fetched_at: dayDate(0), posted_at: date, caption: pick(CAPTIONS), media_type: ptype, permalink: link, tagged_by: tagger, like_count: lc, comment_count: cc, cover_image: cover(`${mid}`) })
    harmTagged.push({ id: nextId('ig_tagged'), brand_id: sid, post_id: mid, post_date: date, caption: pick(CAPTIONS), post_type: ptype, link_post: link, like_count: lc, comment_count: cc, username: tagger })
  }
  await bulk('l0_raw.ig_tagged_posts', Object.keys(rawTagged[0]), rawTagged)
  await bulk('l0_harmonization.instagram_tagged_post', Object.keys(harmTagged[0]), harmTagged)
}

// =====================================================================
// FACEBOOK
// =====================================================================
async function seedFacebook(acc) {
  const sid = acc.id
  let followers = ri(5000, 60000)

  const rawProf = [], harmProf = [], harmAud = []
  for (let d = DAYS - 1; d >= 0; d--) {
    const date = dayDate(d)
    followers += ri(-30, 250)
    const reach = ri(2000, 25000), interactions = ri(300, 5000), linkClicks = ri(20, 900)
    rawProf.push({ social_account_id: sid, fetched_at: date, page_id: `fbpage_${sid.slice(0, 8)}`, name: acc.brandName, about: `${acc.brandName} - halaman resmi Facebook`, category: 'Brand', website: `https://${slug(acc.brandName)}.id`, fan_count: followers, followers_count: followers, cover_url: cover(`${acc.brandName}-fbcover`), avatar_url: avatar(acc.brandName, acc.color), page_link: `https://facebook.com/${acc.username}`, page_follows: followers, page_daily_follows_unique: ri(0, 200), page_media_view: ri(1000, 40000), page_total_media_view_unique: ri(800, 20000), page_video_views: ri(500, 30000), page_views_total: ri(1000, 20000), content_interactions: interactions, link_clicks: linkClicks, profile_reach: reach })
    harmProf.push({ id: nextId('fb_profile'), brand_id: sid, date: ymd(date), profile_photo: avatar(acc.brandName, acc.color), follower_count: followers, page_like_count: followers - ri(0, 2000), follows_increase: ri(-30, 250), content_interactions: interactions, link_clicks: linkClicks, profile_reach: reach, content_views: ri(1000, 40000), profile_visit: ri(100, 3000) })
  }
  await bulk('l0_raw.fb_profile_snapshots', Object.keys(rawProf[0]), rawProf)
  await bulk('l0_harmonization.facebook_profile', Object.keys(harmProf[0]), harmProf)

  const aDate = ymd(dayDate(0))
  const audType = (type, key, val) => harmAud.push({ id: nextId('fb_aud'), brand_id: sid, date: aDate, audience_type: type, dimension_key: key, dimension_value: val, value: ri(100, 7000) })
  AGE_BUCKETS.forEach((a) => audType('age', 'age', a))
  GENDERS.forEach((g) => audType('gender', 'gender', g))
  CITIES.forEach((c) => audType('city', 'city', c))
  COUNTRIES.forEach((c) => audType('country', 'country', c))
  await bulk('l0_harmonization.facebook_audience', Object.keys(harmAud[0]), harmAud)

  const rawPost = [], harmPost = [], extra = [], rawComments = [], harmComments = []
  for (let p = 0; p < POSTS_PER_ACCOUNT; p++) {
    const date = postDate(DAYS - 1)
    const postId = `fb_${sid.slice(0, 8)}_${p}`
    const ptype = pick(FB_POST_TYPES)
    const reactions = ri(50, 6000), likes = Math.floor(reactions * 0.8), comments = ri(2, 400), shares = ri(0, 500)
    const reach = ri(1500, 30000), impressions = reach + ri(500, 15000), clicks = ri(10, 1200)
    const vviews = ptype === 'video' ? ri(2000, 80000) : 0
    const caption = pick(CAPTIONS)
    const link = `https://facebook.com/${acc.username}/posts/${postId}`
    const coverImg = cover(`${acc.brandName}-fb-${p}`)
    rawPost.push({ social_account_id: sid, post_id: postId, fetched_at: dayDate(0), posted_at: date, message: caption, story: null, full_picture: coverImg, permalink_url: link, post_type: ptype, reactions_count: reactions, likes_count: likes, comments_count: comments, shares_count: shares, impressions, reach, clicks, reactions_by_type: { like: likes, love: ri(0, 800), haha: ri(0, 300), wow: ri(0, 200), sad: ri(0, 50), angry: ri(0, 30) }, video_views: vviews })
    const harmId = nextId('fb_post')
    harmPost.push({ id: harmId, brand_id: sid, post_id: postId, post_date: date, caption, link, post_type: ptype, reach, impressions, reactions, likes, comments, shares, link_click: clicks, video_views: vviews, cover_image: coverImg })
    extra.push({ id: nextId('fb_extra'), brand_id: sid, facebook_post_id: harmId, post_id: postId, content_pillar: pick(PILLARS), brand_offering: pick(OFFERINGS), format: pick(FB_FORMATS), is_collab: chance(0.15), is_aon: chance(0.5), is_campaign: chance(0.25), is_boosted: chance(0.35), is_activity: chance(0.15), is_event: chance(0.1) })
    const nc = ri(1, 5)
    for (let c = 0; c < nc; c++) {
      const cid = `${postId}_c${c}`
      const ctime = new Date(date.getTime() + ri(1, 72) * 3600000)
      const cuser = `${pick(USERNAMES_POOL)} ${pick(['Putra', 'Sari', 'Wijaya', 'Hidayat'])}`
      const ctext = pick(COMMENTS), cl = ri(0, 150), rc = ri(0, 15)
      rawComments.push({ social_account_id: sid, post_id: postId, comment_id: cid, fetched_at: dayDate(0), link_post: link, link_comment: `${link}?c=${cid}`, post_date: date, comment_time: ctime, comment_text: ctext, comment_username: cuser, comment_user_id: `fbu_${ri(10000, 99999)}`, likes_count: cl, replies_count: rc, reactions_count: cl, has_attachment: chance(0.1), parent_id: null })
      harmComments.push({ id: nextId('fb_comment'), brand_id: sid, post_id: postId, post_date: date, comment_id: cid, link_post: link, link_comment: `${link}?c=${cid}`, comment_time: ctime, comment_text: ctext, comment_username: cuser, likes_count: cl, replies_count: rc })
    }
  }
  await bulk('l0_raw.fb_post_snapshots', Object.keys(rawPost[0]), rawPost)
  await bulk('l0_harmonization.facebook_post', Object.keys(harmPost[0]), harmPost)
  await bulk('l0_extra.facebook_post_extra_attribute', Object.keys(extra[0]), extra)
  await bulk('l0_raw.fb_comments', Object.keys(rawComments[0]), rawComments)
  await bulk('l0_harmonization.facebook_comment', Object.keys(harmComments[0]), harmComments)
}

// =====================================================================
// TIKTOK
// =====================================================================
async function seedTiktok(acc) {
  const sid = acc.id
  let followers = ri(10000, 200000)
  let totalLikes = ri(50000, 2000000)

  const rawProf = [], harmProf = []
  for (let d = DAYS - 1; d >= 0; d--) {
    const date = dayDate(d)
    const newF = ri(0, 800), lostF = ri(0, 300)
    followers += newF - lostF
    totalLikes += ri(100, 8000)
    rawProf.push({ social_account_id: sid, fetched_at: date, open_id: `tt_${sid.slice(0, 8)}`, display_name: acc.brandName, bio_description: `${acc.brandName} ✨ akun resmi TikTok`, avatar_url: avatar(acc.brandName, acc.color), is_verified: chance(0.3), follower_count: followers, following_count: ri(50, 500), likes_count: totalLikes, video_count: ri(50, 400) })
    harmProf.push({ id: nextId('tt_profile'), brand_id: sid, date: ymd(date), bio: `${acc.brandName} akun resmi`, follower_count: followers, following_count: ri(50, 500), account_total_post_count: ri(50, 400), video_views: ri(20000, 500000), profile_reach: ri(10000, 200000), profile_views: ri(2000, 50000), likes: ri(1000, 60000), comments: ri(100, 5000), shares: ri(50, 4000), net_growth: newF - lostF, new_followers: newF, lost_followers: lostF, is_verified: chance(0.3), followers_growth: newF - lostF })
  }
  await bulk('l0_raw.tt_profile_snapshots', Object.keys(rawProf[0]), rawProf)
  await bulk('l0_harmonization.tiktok_profile', Object.keys(harmProf[0]), harmProf)

  const rawVid = [], harmPost = [], extra = [], harmComments = []
  for (let p = 0; p < POSTS_PER_ACCOUNT; p++) {
    const date = postDate(DAYS - 1)
    const vid = `tt_${sid.slice(0, 8)}_${p}`
    const views = ri(5000, 1500000), likes = Math.floor(views * (0.03 + rnd() * 0.1))
    const comments = ri(10, 4000), shares = ri(5, 8000), saves = ri(5, 5000), dur = ri(8, 120)
    const ptype = pick(TT_POST_TYPES)
    const caption = pick(CAPTIONS), title = `${acc.brandName} | ${caption.slice(0, 24)}`
    const link = `https://tiktok.com/@${acc.username}/video/${vid}`
    const coverImg = cover(`${acc.brandName}-tt-${p}`)
    rawVid.push({ social_account_id: sid, video_id: vid, fetched_at: dayDate(0), posted_at: date, title, description: caption, duration: dur, cover_image_url: coverImg, share_url: link, like_count: likes, comment_count: comments, share_count: shares, view_count: views, engagement_rate: +(((likes + comments + shares) / views) * 100).toFixed(2) })
    const harmId = nextId('tt_post')
    harmPost.push({ id: harmId, brand_id: sid, post_id: vid, post_date: date, title, caption, link, cover_image: coverImg, post_type: ptype, slide_count: ptype === 'photo' ? ri(2, 8) : null, video_duration: dur, views, likes, comments, shares, saves })
    extra.push({ id: nextId('tt_extra'), brand_id: sid, tiktok_post_id: harmId, post_id: vid, content_pillar: pick(PILLARS), brand_offering: pick(OFFERINGS), format: pick(TT_FORMATS), avg_watch_time: +(rnd() * dur).toFixed(2), reach_post: ri(5000, 800000), completion_rate: `${ri(20, 90)}%`, is_boosted: chance(0.3), is_collab: chance(0.2), is_aon: chance(0.5), is_campaign: chance(0.25), is_activity: chance(0.15), is_event: chance(0.1) })
    const nc = ri(1, 6)
    for (let c = 0; c < nc; c++) {
      const cid = `${vid}_c${c}`
      const ctime = new Date(date.getTime() + ri(1, 72) * 3600000)
      const cuser = `${pick(USERNAMES_POOL)}${ri(1, 9999)}`
      harmComments.push({ id: nextId('tt_comment'), brand_id: sid, post_id: vid, post_date: date, comment_id: cid, link_post: link, link_comment: `${link}?c=${cid}`, comment_time: ctime, comment_text: pick(COMMENTS), comment_username: cuser, likes_count: ri(0, 500), replies_count: ri(0, 50) })
    }
  }
  await bulk('l0_raw.tt_video_snapshots', Object.keys(rawVid[0]), rawVid)
  await bulk('l0_harmonization.tiktok_post', Object.keys(harmPost[0]), harmPost)
  await bulk('l0_extra.tiktok_post_extra_attribute', Object.keys(extra[0]), extra)
  await bulk('l0_harmonization.tiktok_comment', Object.keys(harmComments[0]), harmComments)
}

// =====================================================================
// COMPETITORS  (own raw competitor tables + brand_competitors links)
// =====================================================================
async function seedCompetitors(PLAT) {
  const comps = [
    { key: 'instagram', name: 'PesaingKopi', handle: 'pesaingkopi' },
    { key: 'instagram', name: 'RivalFit', handle: 'rivalfit' },
    { key: 'facebook', name: 'KompetitorFB', handle: 'kompetitorfb' },
    { key: 'facebook', name: 'SainganWear', handle: 'sainganwear' },
    { key: 'tiktok', name: 'TikRival', handle: 'tikrival' },
    { key: 'tiktok', name: 'PesaingTani', handle: 'pesaingtani' },
  ]
  const compAccounts = []
  for (const c of comps) {
    const username = c.key === 'tiktok' ? `${c.handle}.id` : `${c.handle}.official`
    const { rows } = await client.query(
      `INSERT INTO social_accounts (platform_id, platform_user_id, username, connected, avatar_url, profile_url)
       VALUES ($1,$2,$3,false,$4,$5) RETURNING id`,
      [PLAT[c.key], `comp_${c.handle}`, username, avatar(c.name, 'd35400'), `https://${c.key}.com/${username}`],
    )
    compAccounts.push({ ...c, id: rows[0].id, username })
  }

  // link each competitor to a real brand (round-robin)
  const { rows: brandRows } = await client.query('SELECT id FROM brands ORDER BY created_at')
  for (let i = 0; i < compAccounts.length; i++) {
    await client.query(
      `INSERT INTO brand_competitors (brand_id, social_account_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [brandRows[i % brandRows.length].id, compAccounts[i].id],
    )
  }

  for (const c of compAccounts) {
    if (c.key === 'instagram') await seedIgCompetitor(c)
    else if (c.key === 'facebook') await seedFbCompetitor(c)
    else await seedTtCompetitor(c)
  }
  console.log(`Competitors: ${compAccounts.length} accounts + media`)
}

async function seedIgCompetitor(c) {
  const sid = c.id
  await client.query(
    `INSERT INTO l0_raw.ig_competitor_snapshots
       (social_account_id, username, full_name, biography, is_verified, follower_count, following_count, media_count, is_private, is_business, account_category, external_url, bio_links)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,true,$9,$10,$11)`,
    [sid, c.username, c.name, `${c.name} - kompetitor IG`, chance(0.5), ri(20000, 500000), ri(100, 1000), ri(100, 800), 'Brand', `https://${c.handle}.id`, [`https://${c.handle}.id`, `https://linktr.ee/${c.handle}`]],
  )
  const media = []
  for (let m = 0; m < 24; m++) {
    const date = postDate(DAYS - 1)
    const mid = `igc_${sid.slice(0, 8)}_${m}`
    const mtype = pick(IG_POST_TYPES)
    media.push({ social_account_id: sid, media_id: mid, fetched_at: dayDate(0), posted_at: date, caption: pick(CAPTIONS), media_type: mtype, permalink: `https://instagram.com/p/${mid}`, cover_image: cover(mid), like_count: ri(100, 50000), comment_count: ri(5, 3000), view_count: mtype === 'REELS' ? ri(5000, 800000) : 0, shortcode: mid, slide_count: mtype === 'CAROUSEL_ALBUM' ? ri(2, 8) : null, video_duration: mtype === 'VIDEO' || mtype === 'REELS' ? ri(8, 90) : null, hashtags_list: ['#promo', `#${c.handle}`], hashtags_count: 2, mentions: [], is_collaborator: chance(0.2), is_sponsored: chance(0.15), is_comment_disabled: false, music_title: mtype === 'REELS' ? 'Original Sound' : null, music_author: mtype === 'REELS' ? c.name : null, is_pinned: m < 1 })
  }
  await bulk('l0_raw.ig_competitor_media', Object.keys(media[0]), media)
}

async function seedFbCompetitor(c) {
  const sid = c.id
  await client.query(
    `INSERT INTO l0_raw.fb_competitor_snapshots
       (social_account_id, username, account_id, page_id, page_name, page_title, follower_count, like_count, rating_count, email, creation_date, categories, info, intro, websites_link, page_url, profile_photo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [sid, c.username, `fbacc_${c.handle}`, `fbpage_${c.handle}`, c.name, `${c.name} Official`, ri(10000, 400000), ri(8000, 350000), ri(100, 5000), `info@${c.handle}.id`, ymd(dayDate(800)), ['Brand', 'Retail'], `${c.name} - kompetitor Facebook`, `Halaman resmi ${c.name}`, [`https://${c.handle}.id`], `https://facebook.com/${c.username}`, avatar(c.name, 'd35400')],
  )
  const media = []
  for (let m = 0; m < 22; m++) {
    const date = postDate(DAYS - 1)
    const pid = `fbc_${sid.slice(0, 8)}_${m}`
    media.push({ social_account_id: sid, post_id: pid, fetched_at: dayDate(0), post_date: date, caption: pick(CAPTIONS), url: `https://facebook.com/${c.username}/posts/${pid}`, page_name: c.name, like_count: ri(50, 30000), share_count: ri(0, 5000), top_reactions_count: ri(50, 20000), media_count: ri(1, 6), media: [cover(pid)], hashtags_list: ['#promo', `#${c.handle}`], hashtags_count: 2 })
  }
  await bulk('l0_raw.fb_competitor_media', Object.keys(media[0]), media)
}

async function seedTtCompetitor(c) {
  const sid = c.id
  await client.query(
    `INSERT INTO l0_raw.tiktok_competitor_snapshots
       (social_account_id, username, account_id, account_nickname, following_count, follower_count, video_count, like_count, is_verified, bio_signature, bio_link, is_private, is_seller, is_commerce_user, commerce_user_category, avatar)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,$12,$13,$14,$15)`,
    [sid, c.username, `ttacc_${c.handle}`, c.name, ri(50, 800), ri(50000, 3000000), ri(80, 600), ri(500000, 50000000), chance(0.6), `${c.name} ✨`, `https://${c.handle}.id`, chance(0.4), chance(0.3), 'Retail', avatar(c.name, 'd35400')],
  )
  const media = []
  for (let m = 0; m < 24; m++) {
    const date = postDate(DAYS - 1)
    const pid = `ttc_${sid.slice(0, 8)}_${m}`
    const views = ri(10000, 5000000), mtype = pick(TT_POST_TYPES)
    media.push({ social_account_id: sid, post_id: pid, fetched_at: dayDate(0), post_date: date, caption: pick(CAPTIONS), caption_language: 'id', media_type: mtype, slide_count: mtype === 'photo' ? ri(2, 8) : null, like_count: Math.floor(views * 0.08), comment_count: ri(10, 8000), play_count: views, saved_count: ri(10, 6000), share_count: ri(5, 10000), video_duration: ri(8, 120), hashtags_list: ['#fyp', `#${c.handle}`], hashtags_count: 2, mentions: [], url: `https://tiktok.com/@${c.username}/video/${pid}`, cover_image: cover(pid), is_pinned: m < 1, is_sponsored: chance(0.15), is_ad: chance(0.1), music_title: 'Original Sound', music_author: c.name })
  }
  await bulk('l0_raw.tiktok_competitor_media', Object.keys(media[0]), media)
}

main().catch(async (e) => {
  console.error('ERROR:', e.message)
  try { await client.query('ROLLBACK') } catch {}
  process.exit(1)
})
