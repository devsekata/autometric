require('dotenv').config({ path: '.env.local' })
const { Client } = require('pg')

const GRAPH = 'https://graph.facebook.com/v21.0'

const TAGGED_DETAIL_FIELDS = [
  'id', 'caption', 'media_type', 'permalink', 'timestamp',
  'username', 'like_count', 'comments_count', 'thumbnail_url',
].join(',')

async function fetchAllIgTaggedPosts(igUserId, accessToken, daysSince = 30, maxItems = 200) {
  const cutoff = Date.now() - daysSince * 24 * 60 * 60 * 1000
  const all = []

  // Single-pass: request all fields directly from /tags
  // Follow 'next' URL directly to avoid cursor version mismatch (API returns v25.0 cursors)
  const firstParams = new URLSearchParams({
    fields:       TAGGED_DETAIL_FIELDS,
    limit:        '5',
    access_token: accessToken,
  })
  let nextUrl = `${GRAPH}/${igUserId}/tags?${firstParams}`

  while (nextUrl && all.length < maxItems) {
    console.log(`[tags] GET ${nextUrl.replace(accessToken, '***')}`)
    const res  = await fetch(nextUrl)
    console.log(`[tags] HTTP ${res.status}`)

    const data = await res.json()
    console.log(`[tags] response:`, JSON.stringify(data).slice(0, 600))

    if (data.error) {
      console.error(`[tags] error:`, JSON.stringify(data.error))
      break
    }

    let reachedCutoff = false
    for (const item of data.data ?? []) {
      if (item.timestamp && new Date(item.timestamp).getTime() < cutoff) {
        reachedCutoff = true
        break
      }
      all.push(item)
      if (all.length >= maxItems) break
    }

    // Follow next URL directly — avoids cursor version mismatch
    nextUrl = (!reachedCutoff && data.paging?.next) ? data.paging.next : null
  }

  return all
}

async function main() {
  const client = new Client({
    host: 'localhost', port: 5432,
    database: 'autometric', user: 'postgres', password: 'postgres',
  })
  await client.connect()

  const { rows } = await client.query(`
    SELECT sa.platform_user_id, sa.oauth_token, bsa.brand_id, p.key
    FROM public.social_accounts sa
    JOIN public.brand_social_accounts bsa ON bsa.social_account_id = sa.id
    JOIN public.platforms p ON p.id = sa.platform_id
    WHERE p.key = 'instagram'
  `)
  console.log('All IG accounts:', rows.map(r => ({ brand_id: r.brand_id, platform_user_id: r.platform_user_id })))

  const igRows = await client.query(`
    SELECT sa.platform_user_id, sa.oauth_token
    FROM public.social_accounts sa
    JOIN public.brand_social_accounts bsa ON bsa.social_account_id = sa.id
    JOIN public.platforms p ON p.id = sa.platform_id
    WHERE p.key = 'instagram'
    LIMIT 1
  `)
  await client.end()

  if (!igRows.rows.length) { console.error('No IG account found'); return }

  const { platform_user_id, oauth_token } = igRows.rows[0]
  console.log(`igUserId: ${platform_user_id}`)

  const posts = await fetchAllIgTaggedPosts(platform_user_id, oauth_token)
  console.log(`\nResult: ${posts.length} tagged posts`)
  if (posts.length > 0) console.log(JSON.stringify(posts[0], null, 2))
}

main().catch(console.error)
