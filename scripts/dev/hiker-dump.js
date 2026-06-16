/**
 * Panggil Hiker API sekali, simpan raw response ke JSON.
 * Jalankan: node scripts/hiker-dump.js <username>
 */
require('dotenv').config({ path: '.env.local' })
const fs   = require('fs')
const path = require('path')

const username = process.argv[2]
if (!username) { console.error('Usage: node scripts/hiker-dump.js <username>'); process.exit(1) }

const KEY     = process.env.HIKER_API_KEY
const BASE    = 'https://api.hikerapi.com'
const headers = { 'x-access-key': KEY }
const outDir  = path.join(__dirname, '../seeds/hiker')
fs.mkdirSync(outDir, { recursive: true })

async function main() {
  // 1. Profile
  console.log(`Fetching profile for @${username} ...`)
  const userRes  = await fetch(`${BASE}/v2/user/by/username?username=${username}`, { headers })
  const userRaw  = await userRes.json()
  // v2 wraps in { user: { ... } }
  const userJson = userRaw.user ?? userRaw
  const userFile = path.join(outDir, `${username}_profile.json`)
  fs.writeFileSync(userFile, JSON.stringify(userJson, null, 2))
  console.log(`  saved → ${userFile}`)

  if (!userJson.pk) {
    console.error('No pk in user response — check the JSON for errors.')
    console.error(JSON.stringify(userRaw).substring(0, 200))
    return
  }

  // 2. Medias — ambil 2 halaman saja untuk hemat kredit
  const mediaPages = []
  let pageId = null
  for (let i = 0; i < 2; i++) {
    const params = new URLSearchParams({ user_id: userJson.pk, flat: 'true' })
    if (pageId) params.set('next_page_id', pageId)
    console.log(`Fetching media page ${i + 1} ...`)
    const mediaRes  = await fetch(`${BASE}/g2/user/medias?${params}`, { headers })
    const mediaJson = await mediaRes.json()
    mediaPages.push(mediaJson)
    pageId = mediaJson.next_page_id
    if (!mediaJson.response?.more_available || !pageId) break
  }

  const mediaFile = path.join(outDir, `${username}_medias.json`)
  fs.writeFileSync(mediaFile, JSON.stringify(mediaPages, null, 2))
  console.log(`  saved → ${mediaFile}`)
  console.log(`  total items: ${mediaPages.reduce((s, p) => s + (p.response?.items?.length ?? 0), 0)}`)
}

main().catch(console.error)
