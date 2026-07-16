/**
 * Panggil Apify Instagram actor (apify~instagram-scraper) untuk profile + posts,
 * simpan raw response ke JSON.
 * Jalankan: node scripts/dev/apify-ig-dump.js <username-atau-url> [days]
 */
require('dotenv').config({ path: '.env.local' })
const fs   = require('fs')
const path = require('path')

const username = process.argv[2]
const days     = process.argv[3] ? parseInt(process.argv[3], 10) : 30
if (!username) { console.error('Usage: node scripts/dev/apify-ig-dump.js <username|url> [days]'); process.exit(1) }

const TOKEN = process.env.APIFY_API_TOKEN
if (!TOKEN) { console.error('APIFY_API_TOKEN is not set in .env.local'); process.exit(1) }

const BASE   = 'https://api.apify.com/v2'
const ACTOR  = 'apify~instagram-scraper'
const outDir = path.join(__dirname, '../../seeds/apify')
fs.mkdirSync(outDir, { recursive: true })

const igUrl = /^https?:\/\//i.test(username)
  ? username
  : `https://www.instagram.com/${username.replace(/^@/, '')}/`

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function runActor(input) {
  const startRes = await fetch(`${BASE}/acts/${ACTOR}/runs`, {
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

const common = {
  addParentData:                     false,
  enhanceUserSearchWithFacebookPage: false,
  isUserReelFeedURL:                 false,
  isUserTaggedFeedURL:               false,
  searchType:                        'user',
  searchLimit:                       1,
}

async function main() {
  const slug = username.replace(/^@/, '').replace(/[^\w.-]/g, '_')

  console.log(`Fetching IG profile for ${igUrl} ...`)
  const profile = await runActor({ ...common, directUrls: [igUrl], resultsType: 'details', resultsLimit: 1 })
  const profFile = path.join(outDir, `${slug}_ig_profile.json`)
  fs.writeFileSync(profFile, JSON.stringify(profile, null, 2))
  console.log(`  saved → ${profFile} (${profile.length} item)`)

  console.log(`Fetching IG posts (${days} days) for ${igUrl} ...`)
  const posts = await runActor({ ...common, directUrls: [igUrl], resultsType: 'posts', onlyPostsNewerThan: `${days} days`, resultsLimit: 1000 })
  const postFile = path.join(outDir, `${slug}_ig_posts.json`)
  fs.writeFileSync(postFile, JSON.stringify(posts, null, 2))
  console.log(`  saved → ${postFile} (${posts.length} item)`)
}

main().catch(err => { console.error(err); process.exit(1) })
