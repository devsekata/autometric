/**
 * Completes ALL data for the "Fibo Demo" brand end-to-end (except competitors),
 * then runs the existing medallion stored procedures so every dashboard is live.
 *
 * Fibo already has L0 profiles + posts + extra (from seed-l0-dummy.js). This script
 * fills the MISSING L0 (comments, stories, tagged posts + TikTok comments), seeds the
 * NLP `feature` layer + word cloud, and CALLs the existing procedures:
 *   Phase 1  l0_raw comments/stories/tagged + l0_harmonization.tiktok_comment
 *   Phase 2  CALL sp_sync_all_from_raw() + l1_silver.sp_sync_unified_* (skip competitor)
 *   Phase 3  seed feature.* (sentiment/relevance/word_frequencies) + l2_gold.post_wordcloud
 *   Phase 4  CALL l2_gold.sp_build_* (skip competitor)
 *
 * Idempotent for Fibo (its comments/stories/tagged/feature/wordcloud are wiped + rebuilt).
 * All procedures are upsert or truncate-rebuild-from-source, so Passeo/tes are unaffected.
 *
 * Usage:  node scripts/seed-fibo-complete.js
 */
const { Client } = require('pg')
require('dotenv').config({ path: '.env.local' })

const client = new Client({ connectionString: process.env.DATABASE_URL })
const BRAND_NAME = 'Fibo Demo'

// deterministic RNG so re-runs are stable
let SEED = 987654321
const rnd = () => { SEED = (SEED * 1103515245 + 12345) & 0x7fffffff; return SEED / 0x7fffffff }
const ri = (a, b) => Math.floor(rnd() * (b - a + 1)) + a
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const R = (n) => Math.round(n)

const USERNAMES = ['andi', 'budi', 'citra', 'dewi', 'eka', 'fajar', 'gita', 'hadi', 'indah', 'joko', 'kiki', 'lina', 'maya', 'nanda', 'oki', 'putri', 'rizki', 'sari', 'tio', 'umi']
const POS = ['Keren banget kontennya!', 'Mantap 🔥 selalu ditunggu', 'Suka banget sama ini 😍', 'Recommended parah sih', 'Kualitasnya juara terus', 'Bikin semangat! terima kasih', 'Aesthetic banget vibe-nya', 'Bagus konsepnya, konsisten']
const NEU = ['Harganya berapa ya kak?', 'Lokasinya di mana?', 'Buka jam berapa?', 'Ada cabang di Bandung ga?', 'Info promo dong min', 'Cara ordernya gimana?']
const NEG = ['Pelayanan agak lama', 'Kurang sesuai ekspektasi', 'Agak mahal menurutku', 'Semoga next lebih baik']
const WORD_POOL = ['fibo', 'kopi', 'nongki', 'aesthetic', 'promo', 'diskon', 'seru', 'nyaman', 'rekomendasi', 'enak', 'suasana', 'workspace', 'jaksel', 'weekend', 'vibes', 'komunitas', 'menu', 'kualitas', 'pelayanan', 'ramah', 'instagramable', 'cozy', 'terbaik', 'favorit', 'konten', 'edukasi', 'tips', 'produk']

async function q(sql, params) { return (await client.query(sql, params)).rows }
async function bulk(table, cols, rows) {
  if (!rows.length) return 0
  const CHUNK = 400
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK), params = []
    const tuples = slice.map((r) => '(' + cols.map((c) => { params.push(r[c] === undefined ? null : r[c]); return '$' + params.length }).join(',') + ')')
    const override = cols.includes('id') ? ' OVERRIDING SYSTEM VALUE' : ''
    await client.query(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(',')})${override} VALUES ${tuples.join(',')}`, params)
  }
  return rows.length
}

async function main() {
  await client.connect()
  console.log('Connected:', (await q('SELECT current_database() d'))[0].d)

  // ── resolve Fibo brand + accounts ──
  const brand = (await q(`SELECT id FROM public.brands WHERE name=$1`, [BRAND_NAME]))[0]
  if (!brand) throw new Error(`Brand "${BRAND_NAME}" not found — run seed-l0-dummy.js first`)
  const brandId = brand.id
  const accts = await q(
    `SELECT p.key platform, sa.id account_id, sa.username
       FROM public.brand_social_accounts bsa
       JOIN public.social_accounts sa ON sa.id=bsa.social_account_id
       JOIN public.platforms p ON p.id=bsa.platform_id
      WHERE bsa.brand_id=$1`, [brandId])
  const ACC = Object.fromEntries(accts.map(a => [a.platform, a]))
  console.log(`Brand ${BRAND_NAME}=${brandId}  IG=${ACC.instagram?.account_id} FB=${ACC.facebook?.account_id} TT=${ACC.tiktok?.account_id}`)

  // existing Fibo posts (harmonization brand_id = social_account_id)
  const igPosts = await q(`SELECT post_id, post_date, link FROM l0_harmonization.instagram_post WHERE brand_id=$1 ORDER BY post_date`, [ACC.instagram.account_id])
  const fbPosts = await q(`SELECT post_id, post_date, link FROM l0_harmonization.facebook_post WHERE brand_id=$1 ORDER BY post_date`, [ACC.facebook.account_id])
  const ttPosts = await q(`SELECT post_id, post_date, link FROM l0_harmonization.tiktok_post WHERE brand_id=$1 ORDER BY post_date`, [ACC.tiktok.account_id])
  console.log(`Existing Fibo posts: IG=${igPosts.length} FB=${fbPosts.length} TT=${ttPosts.length}`)

  // ══════════ PHASE 1 — complete L0_raw (comments/stories/tagged) + tt_comment harm ══════════
  await client.query('BEGIN')
  // FB post proc does split_part(post_id,'_',2); seed-l0-dummy raw ids use hyphens (no '_'),
  // so the proc mangles them all to '' (collapsed to one junk row). Prefix once so the proc
  // recovers the real id and matches the direct-written harmonization (idempotent).
  await client.query(`UPDATE l0_raw.fb_post_snapshots SET post_id = 'fbpost_' || post_id
                        WHERE social_account_id=$1 AND post_id NOT LIKE '%\\_%'`, [ACC.facebook.account_id])
  // idempotent wipe (dedicated accounts → safe)
  await client.query(`DELETE FROM l0_raw.ig_comments WHERE social_account_id=$1`, [ACC.instagram.account_id])
  await client.query(`DELETE FROM l0_raw.fb_comments WHERE social_account_id=$1`, [ACC.facebook.account_id])
  await client.query(`DELETE FROM l0_raw.ig_stories WHERE social_account_id=$1`, [ACC.instagram.account_id])
  await client.query(`DELETE FROM l0_raw.ig_tagged_posts WHERE social_account_id=$1`, [ACC.instagram.account_id])
  await client.query(`DELETE FROM l0_harmonization.tiktok_comment WHERE brand_id=$1`, [ACC.tiktok.account_id])
  await client.query(`DELETE FROM l0_harmonization.instagram_comment WHERE brand_id=$1`, [ACC.instagram.account_id])
  await client.query(`DELETE FROM l0_harmonization.facebook_comment WHERE brand_id=$1`, [ACC.facebook.account_id])
  await client.query(`DELETE FROM l0_harmonization.instagram_story WHERE brand_id=$1`, [ACC.instagram.account_id])
  await client.query(`DELETE FROM l0_harmonization.instagram_tagged_post WHERE brand_id=$1`, [ACC.instagram.account_id])
  await client.query(`DELETE FROM l0_harmonization.instagram_audience WHERE brand_id=$1`, [ACC.instagram.account_id])
  // purge junk empty/null post_id rows for Fibo (a post with no id breaks the timeline proc's
  // brand-agnostic join). Silver procs are upsert (won't delete), so remove explicitly at every layer.
  for (const acc of [ACC.instagram.account_id, ACC.facebook.account_id, ACC.tiktok.account_id]) {
    await client.query(`DELETE FROM l1_silver.unified_comment WHERE brand_id=$1 AND (post_id IS NULL OR post_id='')`, [acc])
    await client.query(`DELETE FROM l1_silver.unified_post WHERE brand_id=$1 AND (post_id IS NULL OR post_id='')`, [acc])
  }
  await client.query(`DELETE FROM l0_harmonization.facebook_post WHERE brand_id=$1 AND (post_id IS NULL OR post_id='')`, [ACC.facebook.account_id])
  await client.query(`DELETE FROM l0_raw.fb_post_snapshots WHERE social_account_id=$1 AND (post_id IS NULL OR post_id='')`, [ACC.facebook.account_id])

  const igCom = [], fbCom = [], ttCom = []
  const mkText = () => { const r = rnd(); return r < 0.6 ? pick(POS) : r < 0.85 ? pick(NEU) : pick(NEG) }
  const uname = () => `${pick(USERNAMES)}_${ri(1, 999)}`

  // IG comments (raw) — 3..6 per post
  for (const p of igPosts) {
    if (!p.post_id) continue
    const n = ri(3, 6)
    for (let c = 0; c < n; c++) {
      const cid = `${p.post_id}_c${c}`
      const ctime = new Date(new Date(p.post_date).getTime() + ri(1, 96) * 3600000)
      igCom.push({ social_account_id: ACC.instagram.account_id, media_id: p.post_id, comment_id: cid, link_post: p.link, link_comment: `${p.link}/c/${cid}`, comment_time: ctime, comment_text: mkText(), comment_username: uname(), likes_count: ri(0, 220), replies_count: ri(0, 18), hidden: false, parent_id: null })
    }
  }
  // FB comments (raw)
  for (const p of fbPosts) {
    if (!p.post_id) continue
    const n = ri(3, 6)
    for (let c = 0; c < n; c++) {
      const cid = `${p.post_id}_c${c}`
      const ctime = new Date(new Date(p.post_date).getTime() + ri(1, 96) * 3600000)
      fbCom.push({ social_account_id: ACC.facebook.account_id, post_id: p.post_id, comment_id: cid, fetched_at: ctime, link_post: p.link, link_comment: `${p.link}?c=${cid}`, post_date: p.post_date, comment_time: ctime, comment_text: mkText(), comment_username: `${pick(USERNAMES)} ${pick(['Putra', 'Sari', 'Wijaya', 'Hidayat', 'Pratama'])}`, comment_user_id: `fbu_${ri(10000, 99999)}`, likes_count: ri(0, 160), replies_count: ri(0, 14), reactions_count: ri(0, 160), has_attachment: false, parent_id: null })
    }
  }
  // TikTok comments (harmonization directly — no raw table / sync proc for TT comments)
  let ttCid = Number((await q(`SELECT COALESCE(MAX(id),0)::bigint m FROM l0_harmonization.tiktok_comment`))[0].m)
  for (const p of ttPosts) {
    if (!p.post_id) continue
    const n = ri(4, 7)
    for (let c = 0; c < n; c++) {
      const cid = `${p.post_id}_c${c}`
      const ctime = new Date(new Date(p.post_date).getTime() + ri(1, 96) * 3600000)
      ttCom.push({ id: ++ttCid, brand_id: ACC.tiktok.account_id, post_id: p.post_id, post_date: p.post_date, comment_id: cid, link_post: p.link, link_comment: `${p.link}?c=${cid}`, comment_time: ctime, comment_text: mkText(), comment_username: `${pick(USERNAMES)}${ri(1, 9999)}`, likes_count: ri(0, 500), replies_count: ri(0, 40) })
    }
  }
  // IG stories (raw) — 9 per month across the post window
  const stories = []
  const monthAnchors = [...new Set(igPosts.map(p => new Date(p.post_date).toISOString().slice(0, 7)))]
  for (const ym of monthAnchors) {
    for (let s = 0; s < 9; s++) {
      const day = 2 + s * 3
      const posted = new Date(`${ym}-${String(Math.min(28, day)).padStart(2, '0')}T${String(8 + (s % 12)).padStart(2, '0')}:00:00Z`)
      const stId = `fibo-story-${ym}-${s}`
      const stype = pick(['IMAGE', 'VIDEO'])
      const reach = ri(4000, 22000), views = reach + ri(200, 4000)
      const replies = ri(2, 120), shares = ri(1, 70), tf = ri(200, 3000), tb = ri(20, 400), exits = ri(50, 800)
      stories.push({ social_account_id: ACC.instagram.account_id, media_id: stId, posted_at: posted, media_type: stype, permalink: `https://instagram.com/stories/${ACC.instagram.username}/${stId}`, media_url: 'dummy://story', thumbnail_url: 'dummy://story-t', username: ACC.instagram.username, reach, replies, shares, follows: ri(0, 80), profile_visits: ri(10, 400), profile_activity: ri(5, 250), reposts: ri(0, 40), total_interactions: replies + shares, total_views: views, facebook_views: ri(0, 3000), navigation: JSON.stringify({ taps_forward: tf, taps_back: tb, exits }), video_duration: stype === 'VIDEO' ? ri(5, 15) : null, fetched_at: posted })
    }
  }
  // IG tagged posts (raw) — 5 per month (UGC)
  const tagged = []
  for (const ym of monthAnchors) {
    for (let t = 0; t < 5; t++) {
      const day = 4 + t * 5
      const posted = new Date(`${ym}-${String(Math.min(28, day)).padStart(2, '0')}T${String(10 + t).padStart(2, '0')}:30:00Z`)
      const mid = `fibo-ugc-${ym}-${t}`
      const tagger = uname()
      const lc = ri(80, 3200), cc = ri(5, 260)
      tagged.push({ social_account_id: ACC.instagram.account_id, media_id: mid, fetched_at: posted, posted_at: posted, caption: `Seru banget di Fibo! ${pick(['#fibospace', '#jaksel', '#nongki'])} @${ACC.instagram.username}`, media_type: pick(['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM']), permalink: `https://instagram.com/p/${mid}`, tagged_by: tagger, like_count: lc, comment_count: cc, cover_image: 'dummy://ugc' })
    }
  }

  const n1 = await bulk('l0_raw.ig_comments', Object.keys(igCom[0] || { social_account_id: 0 }), igCom)
  const n2 = await bulk('l0_raw.fb_comments', Object.keys(fbCom[0] || { social_account_id: 0 }), fbCom)
  const n3 = await bulk('l0_harmonization.tiktok_comment', Object.keys(ttCom[0] || { id: 0 }), ttCom)
  const n4 = await bulk('l0_raw.ig_stories', Object.keys(stories[0] || { social_account_id: 0 }), stories)
  const n5 = await bulk('l0_raw.ig_tagged_posts', Object.keys(tagged[0] || { social_account_id: 0 }), tagged)
  await client.query('COMMIT')
  console.log(`\n[Phase 1] L0_raw seeded — IG comments=${n1} FB comments=${n2} TT comments=${n3} stories=${n4} tagged=${n5}`)

  // ══════════ PHASE 2 — harmonization + silver procedures ══════════
  console.log('\n[Phase 2] Running harmonization + silver procedures…')
  await client.query('CALL l0_harmonization.sp_sync_all_from_raw()')
  console.log('  ✓ sp_sync_all_from_raw')

  // Seed IG audience demographics AFTER the raw→harm audience proc runs (it deletes+upserts and
  // yields nothing from seed-l0-dummy's flat JSON, so our rows would be wiped if seeded earlier).
  // Shape matches what sp_sync_unified_audience pivots: audience_type × dimension_key.
  {
    const IGACC = ACC.instagram.account_id
    const audDate = igPosts.length ? new Date(igPosts[igPosts.length - 1].post_date).toISOString().slice(0, 10) : '2026-06-30'
    await client.query(`DELETE FROM l0_harmonization.instagram_audience WHERE brand_id=$1`, [IGACC])
    let audId = Number((await q(`SELECT COALESCE(MAX(id),0)::bigint m FROM l0_harmonization.instagram_audience`))[0].m)
    const AGE = [['13-17', 6], ['18-24', 34], ['25-34', 32], ['35-44', 16], ['45-54', 8], ['55-64', 3], ['65+', 1]]
    const CITY = [['Jakarta', 30], ['Surabaya', 14], ['Bandung', 12], ['Medan', 9], ['Semarang', 8], ['Yogyakarta', 7], ['Denpasar', 6]]
    const CTRY = [['ID', 82], ['MY', 10], ['SG', 8]]
    const audRows = []
    const addAud = (atype, key, val, value) => audRows.push({ id: ++audId, brand_id: IGACC, date: audDate, audience_type: atype, dimension_key: key, dimension_value: val, value })
    for (const [atype, base, fem] of [['follower_demographics', 52400, 0.58], ['engaged_audience_demographics', 8600, 0.36]]) {
      for (const [b, pctv] of AGE) addAud(atype, 'age', b, R(base * pctv / 100))
      addAud(atype, 'gender', 'female', R(base * fem))
      addAud(atype, 'gender', 'male', R(base * (0.98 - fem)))
      addAud(atype, 'gender', 'unknown', R(base * 0.02))
      for (const [c, pctv] of CITY) addAud(atype, 'city', c, R(base * pctv / 100))
      for (const [c, pctv] of CTRY) addAud(atype, 'country', c, R(base * pctv / 100))
    }
    const nAud = await bulk('l0_harmonization.instagram_audience', ['id', 'brand_id', 'date', 'audience_type', 'dimension_key', 'dimension_value', 'value'], audRows)
    console.log(`  ✓ seeded instagram_audience=${nAud}`)
  }

  const silver = ['sp_sync_unified_profile', 'sp_sync_unified_post', 'sp_sync_unified_comment', 'sp_sync_unified_story', 'sp_sync_unified_tagged_post', 'sp_sync_unified_audience']
  for (const p of silver) { await client.query(`CALL l1_silver.${p}()`); console.log(`  ✓ ${p}`) }

  // ══════════ PHASE 3 — feature (NLP) + word cloud ══════════
  console.log('\n[Phase 3] Seeding feature.* + post_wordcloud for Fibo…')
  const acctIds = [ACC.instagram.account_id, ACC.facebook.account_id, ACC.tiktok.account_id]
  await client.query('BEGIN')
  // comments now in silver — dedupe by (comment_id, platform) so feature PK holds
  const comments = await q(`SELECT DISTINCT ON (comment_id, platform) comment_id, platform, brand_id, comment_text
                              FROM l1_silver.unified_comment WHERE brand_id = ANY($1) ORDER BY comment_id, platform`, [acctIds])
  const cids = comments.map(c => c.comment_id)
  // clear any prior feature rows for these comments (regardless of stored brand_id grain)
  await client.query(`DELETE FROM feature.comment_sentiment_scores WHERE comment_id = ANY($1) OR brand_id = ANY($2)`, [cids, acctIds])
  await client.query(`DELETE FROM feature.comment_relevance_scores WHERE comment_id = ANY($1) OR brand_id = ANY($2)`, [cids, acctIds])
  await client.query(`DELETE FROM feature.word_frequencies WHERE brand_id = ANY($1)`, [acctIds])
  const sent = [], rel = []
  for (const c of comments) {
    const r = rnd()
    const label = r < 0.6 ? 'positive' : r < 0.85 ? 'neutral' : 'negative'
    const score = label === 'positive' ? +(0.6 + rnd() * 0.4).toFixed(4) : label === 'neutral' ? +(0.4 + rnd() * 0.2).toFixed(4) : +(rnd() * 0.4).toFixed(4)
    sent.push({ comment_id: c.comment_id, platform: c.platform, brand_id: c.brand_id, sentiment_label: label, sentiment_score: score, model_name: 'demo-nlp-v1', scored_at: new Date('2026-07-01T00:00:00Z') })
    // relevance 0..100 — mix of high/mid/low
    const rr = rnd()
    const relScore = rr < 0.5 ? ri(76, 98) : rr < 0.8 ? ri(45, 74) : ri(5, 38)
    rel.push({ comment_id: c.comment_id, platform: c.platform, brand_id: c.brand_id, relevance_score: relScore, scored_at: new Date('2026-07-01T00:00:00Z') })
  }
  await bulk('feature.comment_sentiment_scores', ['comment_id', 'platform', 'brand_id', 'sentiment_label', 'sentiment_score', 'model_name', 'scored_at'], sent)
  await bulk('feature.comment_relevance_scores', ['comment_id', 'platform', 'brand_id', 'relevance_score', 'scored_at'], rel)

  // per-brand word frequencies (feature) + per-post word cloud (gold, no proc)
  const posts = await q(`SELECT post_id, platform, brand_id FROM l1_silver.unified_post WHERE brand_id = ANY($1)`, [acctIds])
  await client.query(`DELETE FROM l2_gold.post_wordcloud WHERE post_id = ANY($1)`, [posts.map(p => p.post_id)])
  const pw = []
  const freqByBrandPlat = new Map()
  for (const p of posts) {
    const k = Math.min(WORD_POOL.length, ri(8, 14))
    const words = [...WORD_POOL].sort(() => rnd() - 0.5).slice(0, k)
    for (const w of words) {
      const f = ri(1, 9)
      pw.push({ post_id: p.post_id, platform: p.platform, word: w, frequency: f })
      const bk = `${p.brand_id}|${p.platform}|${w}`
      freqByBrandPlat.set(bk, (freqByBrandPlat.get(bk) || 0) + f)
    }
  }
  const wf = [...freqByBrandPlat.entries()].map(([bk, f]) => { const [brand_id, platform, word] = bk.split('|'); return { brand_id, platform, word, frequency: f, scored_at: new Date('2026-07-01T00:00:00Z') } })
  await bulk('l2_gold.post_wordcloud', ['post_id', 'platform', 'word', 'frequency'], pw)
  await bulk('feature.word_frequencies', ['brand_id', 'platform', 'word', 'frequency', 'scored_at'], wf)
  await client.query('COMMIT')
  console.log(`  ✓ sentiment=${sent.length} relevance=${rel.length} post_wordcloud=${pw.length} word_freq=${wf.length}`)

  // ══════════ PHASE 4 — gold build procedures (skip competitor) ══════════
  console.log('\n[Phase 4] Running gold build procedures…')
  // clear Fibo's earlier hand-seeded sentiment (umbrella grain) so the procs rebuild cleanly
  await client.query(`DELETE FROM l2_gold.comment_sentiment_daily WHERE brand_id=$1`, [brandId])
  await client.query(`DELETE FROM l2_gold.comment_sentiment_post WHERE brand_id=$1`, [brandId])
  const gold = [
    'sp_build_post_metric', 'sp_build_brand_metric_daily', 'sp_build_posting_time_heatmap',
    'sp_build_content_attribute_daily', 'sp_build_dim_content_pillar', 'sp_build_pillar_performance',
    'sp_build_tiktok_churn', 'sp_build_audience_demographics_daily', 'sp_build_audience_geo_daily',
    'sp_build_story_funnel', 'sp_build_comment_activity', 'sp_build_community_contributors',
    'sp_build_comment_sentiment_daily', 'sp_build_comment_sentiment_post', 'sp_build_comment_relevance_distribution',
    'sp_build_post_comment_timeline', 'sp_build_ugc_tagged_posts',
  ]
  for (const p of gold) { await client.query(`CALL l2_gold.${p}()`); console.log(`  ✓ ${p}`) }

  // drop any stale empty-post_id rows left by earlier runs (post_metric/sentiment_post are upsert)
  await client.query(`DELETE FROM l2_gold.post_metric WHERE brand_id = ANY($1) AND (post_id IS NULL OR post_id='')`, [acctIds])
  await client.query(`DELETE FROM l2_gold.comment_sentiment_post WHERE brand_id=$1 AND (post_id IS NULL OR post_id='')`, [brandId])

  console.log('\n=== DONE. Fibo Demo completed end-to-end (competitors skipped). ===')
  await client.end()
}

main().catch(async (e) => {
  console.error('\nERROR:', e.message)
  try { await client.query('ROLLBACK') } catch {}
  await client.end().catch(() => {})
  process.exit(1)
})
