/**
 * TikTok roster ER written by Add New KOL (`kol_directory.engagement_rate`) — offline checks.
 *
 *   npx tsx scripts/verify-tt-roster-er.ts
 *
 * No database, no Apify: `ttEngagementRate` is pure, and the SQL the pipeline
 * runs is read from source. The definition has to stay the Instagram one:
 * average(likes + comments) / current followers x 100, shares excluded.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ApifyTiktokPost } from '../src/lib/apify/client'
import { igEngagementRate, ttEngagementRate } from '../src/lib/kolDirectory/addKolScrape'

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
let n = 0
const check = (name: string, fn: () => void) => { fn(); n++; console.log(`ok  ${name}`) }

const post = (diggCount?: number, commentCount?: number, shareCount?: number): ApifyTiktokPost =>
  ({ id: 'v', diggCount, commentCount, shareCount })

check('normal case: average(likes + comments) / followers x 100', () =>
  // (100+10 + 300+30) / 2 = 220 -> 220 / 10_000 x 100
  assert.equal(ttEngagementRate([post(100, 10), post(300, 30)], { fans: 10_000 }), 2.2))

check('likes only and comments only both count', () =>
  assert.equal(ttEngagementRate([post(500, 0), post(0, 100)], { fans: 10_000 }), 3))

check('followers 0 / missing / null -> null', () => {
  assert.equal(ttEngagementRate([post(100, 10)], { fans: 0 }), null)
  assert.equal(ttEngagementRate([post(100, 10)], {}), null)
  assert.equal(ttEngagementRate([post(100, 10)], { fans: null as unknown as number }), null)
})

check('no posts -> null', () =>
  assert.equal(ttEngagementRate([], { fans: 10_000 }), null))

check('posts without interaction are skipped, not averaged in as zero', () => {
  assert.equal(ttEngagementRate([post(100, 10), post(0, 0), post()], { fans: 10_000 }), 1.1)
  assert.equal(ttEngagementRate([post(0, 0), post()], { fans: 10_000 }), null)
})

check('negative likes count as 0, as they do for Instagram', () => {
  assert.equal(ttEngagementRate([post(-1, 50)], { fans: 10_000 }), 0.5)
  assert.equal(ttEngagementRate([post(-1, 0)], { fans: 10_000 }), null)
})

check('error items are skipped', () => {
  const errored = { ...post(900_000, 90_000), error: 'not_found', errorDescription: 'gone' } as ApifyTiktokPost
  assert.equal(ttEngagementRate([post(100, 10), errored], { fans: 10_000 }), 1.1)
  assert.equal(ttEngagementRate([errored], { fans: 10_000 }), null)
})

check('shares are not part of the numerator', () =>
  assert.equal(
    ttEngagementRate([post(100, 10, 5_000)], { fans: 10_000 }),
    ttEngagementRate([post(100, 10, 0)], { fans: 10_000 }),
  ))

check('rounded to 4 decimals, identically to Instagram', () => {
  // 1 / 3 x 100 = 33.3333...
  assert.equal(ttEngagementRate([post(1, 0)], { fans: 3 }), 33.3333)
  const samples: [number, number, number][] = [[1, 0, 3], [2, 0, 3], [123, 45, 7_919], [5_987_700, 12_951, 10_500_000]]
  for (const [likes, comments, followers] of samples) {
    assert.equal(
      ttEngagementRate([post(likes, comments)], { fans: followers }),
      igEngagementRate({ followersCount: followers, latestPosts: [{ likesCount: likes, commentsCount: comments }] }),
    )
  }
})

const scrape = src('src/lib/kolDirectory/addKolScrape.ts')
const ttUpdate = scrape.slice(scrape.indexOf('async function updateDirectoryFromTt('), scrape.indexOf('/* ── the pipeline'))
check('TikTok directory update writes the roster ER without clobbering an existing one', () =>
  assert.match(ttUpdate, /engagement_rate\s*=\s*COALESCE\(\$6, k\.engagement_rate\)/))
check('the roster ER comes from the posts already fetched, not a second query', () => {
  assert.match(ttUpdate, /ttEngagementRate\(posts, author\)/)
  assert.match(scrape, /updateDirectoryFromTt\(kolDirectoryId, author, posts\)/)
})

console.log(`\n${n} checks passed`)
