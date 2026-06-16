/**
 * Panggil Apify Facebook actors (profile + posts) sekali, simpan raw response ke JSON.
 * Jalankan: node scripts/apify-fb-dump.js <username-atau-url> [days]
 */
require('dotenv').config({ path: '.env.local' })
const fs   = require('fs')
const path = require('path')

const username = process.argv[2]
const days     = process.argv[3] ? parseInt(process.argv[3], 10) : 30
if (!username) { console.error('Usage: node scripts/apify-fb-dump.js <username|url> [days]'); process.exit(1) }

const TOKEN = process.env.APIFY_API_TOKEN
if (!TOKEN) { console.error('APIFY_API_TOKEN is not set in .env.local'); process.exit(1) }

const BASE   = 'https://api.apify.com/v2'
const outDir = path.join(__dirname, '../seeds/apify')
fs.mkdirSync(outDir, { recursive: true })

const fbUrl = /^https?:\/\//i.test(username)
  ? username
  : `https://www.facebook.com/${username.replace(/^@/, '')}/`

const sleep = ms => new Promise(r => setTimeout(r, ms))

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
  const slug = username.replace(/^@/, '').replace(/[^\w.-]/g, '_')

  console.log(`Fetching FB profile for ${fbUrl} ...`)
  const profile = await runActor('apify~facebook-pages-scraper', {
    startUrls: [{ url: fbUrl, method: 'GET' }],
  })
  const profFile = path.join(outDir, `${slug}_fb_profile.json`)
  fs.writeFileSync(profFile, JSON.stringify(profile, null, 2))
  console.log(`  saved → ${profFile} (${profile.length} item)`)

  console.log(`Fetching FB posts (${days} days) for ${fbUrl} ...`)
  const posts = await runActor('apify~facebook-posts-scraper', {
    startUrls:          [{ url: fbUrl, method: 'GET' }],
    onlyPostsNewerThan: `${days} days`,
    resultsLimit:       500,
    captionText:        false,
  })
  const postFile = path.join(outDir, `${slug}_fb_posts.json`)
  fs.writeFileSync(postFile, JSON.stringify(posts, null, 2))
  console.log(`  saved → ${postFile} (${posts.length} item)`)
}

main().catch(err => { console.error(err); process.exit(1) })
