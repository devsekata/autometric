/**
 * Apify actor calls specific to the "Add New KOL" pipeline.
 *
 * These are actors `@/lib/apify/client.ts` does not already wrap:
 *
 *   - `apify/instagram-profile-scraper`             — IG existence check + raw profile
 *   - `apify/instagram-followers-following-scraper`  — IG follower sample
 *   - `clockworks/tiktok-followers-scraper`          — TikTok follower sample
 *
 * They deliberately do NOT reuse `client.ts`'s `runActor` helper: that helper
 * starts a run with no `maxItems` / `maxTotalChargeUsd`, and the two follower
 * actors bill per item returned — an account can have hundreds of millions of
 * followers, so a run started without those two run-level caps is a run with
 * no ceiling on spend. See `scrapper-project/apify_followers.py` for the
 * Python original this ports (four cost-cap layers, kept identical here):
 *
 *   1. actor input        — `resultsLimit` (IG) / `maxFollowersPerProfile` (TT)
 *   2. run-level `maxItems`
 *   3. run-level `maxTotalChargeUsd`
 *   4. our own `.slice(0, limit)` after the dataset comes back
 *
 * `fetchIgProfileRaw` carries no such cap — one profile is one item — but it
 * is kept in this file rather than `client.ts` because it is a different actor
 * (`apify/instagram-profile-scraper`, not `apify~instagram-scraper`) with a
 * different input shape (`usernames: string[]`, no `directUrls`).
 */

const APIFY_BASE = 'https://api.apify.com/v2'

const IG_PROFILE_ACTOR = 'apify~instagram-profile-scraper'
const IG_FOLLOWERS_ACTOR = 'apify~instagram-followers-following-scraper'
const TT_FOLLOWERS_ACTOR = 'clockworks~tiktok-followers-scraper'

const POLL_INTERVAL_MS = 5_000
const MAX_WAIT_MS = 8 * 60_000

/** Hard bounds on how many followers a single "Add New KOL" run may pull. */
const LIMIT_MIN = 1
const LIMIT_MAX = 100
/** Default follower sample size, mirroring `apify_followers.py`. */
const DEFAULT_FOLLOWER_LIMIT = 100

/**
 * Per-account billing ceiling passed to Apify as `maxTotalChargeUsd`. A run
 * that would exceed this is stopped by Apify itself, regardless of what the
 * actor's own input limit says — the safety net for an actor behaving badly.
 */
const MAX_TOTAL_CHARGE_USD = 1

function apifyToken(): string {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw new Error('APIFY_API_TOKEN is not set')
  return token
}

/**
 * Reject any limit outside 1..100 before a single request is sent — the
 * fourth-from-last line of defence is validating the number itself.
 */
function validateFollowerLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < LIMIT_MIN || limit > LIMIT_MAX) {
    throw new Error(`Follower limit ${limit} is out of the safe range ${LIMIT_MIN}..${LIMIT_MAX}.`)
  }
  return limit
}

async function startActorRun(
  actorId: string,
  input: Record<string, unknown>,
  opts?: { maxItems?: number; maxTotalChargeUsd?: number },
): Promise<string> {
  const qs = new URLSearchParams()
  if (opts?.maxItems !== undefined) qs.set('maxItems', String(opts.maxItems))
  if (opts?.maxTotalChargeUsd !== undefined) qs.set('maxTotalChargeUsd', String(opts.maxTotalChargeUsd))
  const query = qs.toString() ? `?${qs.toString()}` : ''

  const res = await fetch(`${APIFY_BASE}/acts/${actorId}/runs${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apifyToken()}`,
    },
    body: JSON.stringify(input),
  })

  if (res.status === 401 || res.status === 403) {
    throw new Error('Apify token invalid atau tidak punya akses. Cek APIFY_API_TOKEN.')
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Apify start-run error ${res.status}: ${body}`)
  }

  const data = await res.json()
  const runId = data?.data?.id
  if (!runId) throw new Error('Apify start-run returned no run id')
  return runId
}

async function getRunStatus(runId: string): Promise<string> {
  const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}`, {
    headers: { Authorization: `Bearer ${apifyToken()}` },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Apify run-status error ${res.status}: ${body}`)
  }
  const data = await res.json()
  return data?.data?.status ?? 'UNKNOWN'
}

async function downloadDataset<T>(runId: string): Promise<T[]> {
  const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}/dataset/items`, {
    headers: { Authorization: `Bearer ${apifyToken()}` },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Apify dataset error ${res.status}: ${body}`)
  }
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function runActor<T>(
  actorId: string,
  input: Record<string, unknown>,
  opts?: { maxItems?: number; maxTotalChargeUsd?: number },
): Promise<T[]> {
  const runId = await startActorRun(actorId, input, opts)
  const start = Date.now()

  while (Date.now() - start < MAX_WAIT_MS) {
    const status = await getRunStatus(runId)
    if (status === 'SUCCEEDED') return downloadDataset<T>(runId)
    if (status === 'FAILED') throw new Error(`Apify run ${runId} failed`)
    if (status === 'ABORTED') throw new Error(`Apify run ${runId} aborted`)
    if (status === 'TIMED-OUT') throw new Error(`Apify run ${runId} timed out`)
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`Apify run ${runId} did not finish within ${MAX_WAIT_MS / 1000}s`)
}

function cleanHandle(username: string): string {
  return username.trim().replace(/^@/, '')
}

// --- Instagram profile (apify/instagram-profile-scraper) ---
//
// Same shape as `raw_store.py` / `apify_ig.py` in scrapper-project reads: one
// item per requested username, `not_found` error item when the account does
// not exist. Returned as-is (`unknown`-typed) — the two callers (existence
// check, raw-table insert) each read only the fields they need, and neither
// should force the other to agree on a shared interface for an actor whose
// full response shape we have not modelled field-by-field.
export async function fetchIgProfileRaw(username: string): Promise<Record<string, unknown> | null> {
  const items = await runActor<Record<string, unknown>>(IG_PROFILE_ACTOR, {
    usernames: [cleanHandle(username)],
    includeAboutSection: false,
  })
  return items[0] ?? null
}

// --- Instagram followers (apify/instagram-followers-following-scraper) ---
export async function fetchIgFollowers(
  username: string,
  limit: number = DEFAULT_FOLLOWER_LIMIT,
): Promise<Record<string, unknown>[]> {
  validateFollowerLimit(limit)
  const items = await runActor<Record<string, unknown>>(
    IG_FOLLOWERS_ACTOR,
    {
      usernames: [cleanHandle(username)],
      dataToScrape: 'followers',
      resultsLimit: limit,
    },
    { maxItems: limit, maxTotalChargeUsd: MAX_TOTAL_CHARGE_USD },
  )
  // Layer 4: cut to the limit even if the actor or the platform sent more.
  return items.slice(0, limit)
}

// --- TikTok followers (clockworks/tiktok-followers-scraper) ---
export async function fetchTiktokFollowers(
  username: string,
  limit: number = DEFAULT_FOLLOWER_LIMIT,
): Promise<Record<string, unknown>[]> {
  validateFollowerLimit(limit)
  const items = await runActor<Record<string, unknown>>(
    TT_FOLLOWERS_ACTOR,
    {
      profiles: [cleanHandle(username)],
      maxFollowersPerProfile: limit,
      // The actor requires this field; following is never scraped here, so it
      // is pinned to zero rather than left to the actor's own default.
      maxFollowingPerProfile: 0,
    },
    { maxItems: limit, maxTotalChargeUsd: MAX_TOTAL_CHARGE_USD },
  )
  return items.slice(0, limit)
}
