/**
 * Panggil Apify TikTok actor (clockworks~tiktok-scraper) sekali, simpan raw response ke JSON.
 * Satu run mengembalikan posts; profile (authorMeta) ada di dalam tiap post.
 * Jalankan: node scripts/apify-tiktok-dump.js <username> [days]
 */
require('dotenv').config({ path: '.env.local' })
const fs   = require('fs')
const path = require('path')

const username = process.argv[2]
const days     = process.argv[3] ? parseInt(process.argv[3], 10) : 30
if (!username) { console.error('Usage: node scripts/apify-tiktok-dump.js <username> [days]'); process.exit(1) }

const TOKEN = process.env.APIFY_API_TOKEN
if (!TOKEN) { console.error('APIFY_API_TOKEN is not set in .env.local'); process.exit(1) }

const BASE   = 'https://api.apify.com/v2'
const outDir = path.join(__dirname, '../seeds/apify')
fs.mkdirSync(outDir, { recursive: true })

const handle = username.replace(/^@/, '')
const sleep  = ms => new Promise(r => setTimeout(r, ms))

async function runActor(actorId, input) {
  const startRes = await fetch(`${BASE}/acts/${actorId}/runs`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body:    JSON.stringify(input),
  })
  const startJson = await startRes.json()
  const runId = startJson?.data?.id
  if (!runId) throw new Error(`No run id: ${JSON.stringify(startJson).slice(0, 200)}`)
  console.log(`  run ${runId} started, polling...`)

  while (true) {
    await sleep(5000)
    const stRes  = await fetch(`${BASE}/actor-runs/${runId}`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    const status = (await stRes.json())?.data?.status
    console.log(`    status: ${status}`)
    if (status === 'SUCCEEDED') break
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) throw new Error(`run ${status}`)
  }

  const dsRes = await fetch(`${BASE}/actor-runs/${runId}/dataset/items`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  return dsRes.json()
}

async function main() {
  const slug   = handle.replace(/[^\w.-]/g, '_')
  const oldest = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

  console.log(`Fetching TikTok posts (${days} days) for @${handle} ...`)
  const posts = await runActor('clockworks~tiktok-scraper', {
    profiles:              [handle],
    profileScrapeSections: ['videos'],
    profileSorting:        'latest',
    excludePinnedPosts:    false,
    scrapeRelatedVideos:   false,
    shouldDownloadAvatars: false,
    shouldDownloadCovers:  false,
    shouldDownloadVideos:  false,
    oldestPostDateUnified: oldest,
    newestPostDate:        new Date().toISOString().slice(0, 10),
    maxProfilesPerQuery:   1,
    resultsPerPage:        200,
  })
  const postFile = path.join(outDir, `${slug}_tiktok_posts.json`)
  fs.writeFileSync(postFile, JSON.stringify(posts, null, 2))
  console.log(`  saved → ${postFile} (${posts.length} item)`)

  const author = posts.find(p => p.authorMeta)?.authorMeta ?? null
  if (author) {
    const profFile = path.join(outDir, `${slug}_tiktok_profile.json`)
    fs.writeFileSync(profFile, JSON.stringify(author, null, 2))
    console.log(`  saved → ${profFile} (authorMeta)`)
  } else {
    console.log('  no authorMeta found in posts (account may have no posts in window)')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
