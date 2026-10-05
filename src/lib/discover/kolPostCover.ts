import kolDb from '@/lib/kolDb'
import type { KolCreatorPayload } from './kolDirectory'

/**
 * Getting a harvested post's cover picture back.
 *
 * `l1_silver.unified_post.cover_image` stores the platform's own signed CDN
 * link, and those links expire: Instagram stamps `oe=` (hex unix seconds) onto
 * every `fbcdn.net` URL, TikTok stamps `x-expires=` (decimal) onto every
 * `tiktokcdn.com` one. Every cover harvested so far has passed its stamp, so the
 * whole Content grid was rendering as empty tiles — the row was there, the
 * picture 403'd.
 *
 * The picture is still public, though; only that particular link died. Both
 * platforms expose an unauthenticated endpoint that mints a fresh one from the
 * post's permalink, which every harvested row also carries:
 *
 *   * Instagram — `https://www.instagram.com/p/<code>/media/?size=l` redirects
 *     to a newly signed `cdninstagram.com` URL.
 *   * TikTok — `https://www.tiktok.com/oembed?url=<permalink>` returns JSON with
 *     a freshly signed `thumbnail_url`, and its embed player at
 *     `https://www.tiktok.com/embed/v2/<id>` carries the same picture as the
 *     `poster` attribute. Both are tried, because oEmbed rate-limits by IP and
 *     answers 403 under any real load while the embed page keeps serving.
 *
 * Neither takes a token. Resolution happens here, once per post, and the result
 * is memoised for an hour so a page that shows twelve covers does not re-ask on
 * every render or every viewer. Failures are remembered too, for ten minutes, so
 * a post the platform will not give up does not cost an outbound round trip on
 * every render.
 *
 * Nothing here trusts a URL from the caller: the only input is a post id, and
 * the permalink it resolves to is checked against the two hosts below before a
 * request leaves the server. That is what keeps the cover route from being an
 * open proxy.
 */

/** Chrome's. Instagram's media endpoint answers 302 to a browser and 403 to a bare client. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const FETCH_TIMEOUT_MS = 8_000
/** A cover is a thumbnail; anything larger than this is not one, so it is refused. */
const MAX_BYTES = 8 * 1024 * 1024

const IG_CODE = /^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/
const TT_POST = /^https:\/\/(?:www\.)?tiktok\.com\/@[^/]+\/(?:video|photo)\/(\d+)/

export interface PostCoverImage {
  body: ArrayBuffer
  contentType: string
}

/* ── expiry ───────────────────────────────────────────────────────────────── */

/**
 * Whether a stored CDN link has already passed the expiry it carries.
 *
 * Checked before the link is used so the common case — every cover harvested so
 * far — costs no outbound request at all. A link whose expiry cannot be read is
 * treated as live: the request itself is then the test, and a 403 falls through
 * to the permalink path exactly the same way.
 */
export function cdnLinkExpired(url: string): boolean {
  let u: URL
  try { u = new URL(url) } catch { return true }

  const oe = u.searchParams.get('oe')
  if (oe && /^[0-9a-f]+$/i.test(oe)) {
    const at = parseInt(oe, 16)
    if (Number.isFinite(at) && at > 0) return at * 1000 <= Date.now()
  }

  const x = u.searchParams.get('x-expires')
  if (x && /^\d+$/.test(x)) return Number(x) * 1000 <= Date.now()

  return false
}

/* ── resolution ───────────────────────────────────────────────────────────── */

/** Resolved cover URLs, keyed by post id. */
const cache = new Map<string, { url: string; at: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_MAX = 500

function cacheGet(postId: string): string | null {
  const hit = cache.get(postId)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(postId); return null }
  return hit.url
}

/** Posts the platforms refused, so a dead cover is not re-chased every render. */
const misses = new Map<string, number>()
const MISS_TTL_MS = 10 * 60 * 1000

function missed(postId: string): boolean {
  const at = misses.get(postId)
  if (at === undefined) return false
  if (Date.now() - at > MISS_TTL_MS) { misses.delete(postId); return false }
  return true
}

function cacheSet(postId: string, url: string) {
  // Oldest-first eviction: `Map` iterates in insertion order, so the first key
  // is the coldest one and a bounded map needs no other bookkeeping.
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(postId, { url, at: Date.now() })
}

/**
 * A fresh, publicly signed cover URL for a permalink, or null when the platform
 * will not mint one — a deleted post, a private account, a permalink shape
 * neither pattern recognises.
 */
async function freshCoverUrl(permalink: string): Promise<string | null> {
  const ig = permalink.match(IG_CODE)
  if (ig) return `https://www.instagram.com/p/${ig[1]}/media/?size=l`

  const tt = permalink.match(TT_POST)
  if (!tt) return null

  return (await tiktokOembedCover(permalink)) ?? (await tiktokEmbedCover(tt[1]))
}

/** TikTok's documented oEmbed. Cheap, and the first thing to ask. */
async function tiktokOembedCover(permalink: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(permalink)}`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    )
    if (!res.ok) return null
    const body = await res.json() as { thumbnail_url?: unknown }
    const thumb = typeof body.thumbnail_url === 'string' ? body.thumbnail_url : null
    return thumb && thumb.startsWith('https://') ? thumb : null
  } catch {
    return null
  }
}

/**
 * The embed player's `poster`, which is the same picture by another route.
 *
 * Worth the larger page: oEmbed starts answering 403 well before this does — a
 * sweep of the whole harvest had oEmbed refusing 50 of 91 posts while the embed
 * page still handed over the cover for nearly all of them.
 */
async function tiktokEmbedCover(videoId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.tiktok.com/embed/v2/${videoId}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const html = await res.text()
    const poster = html.match(/poster="(https:\/\/[^"\\]+)"/)
    return poster ? poster[1].replace(/&amp;/g, '&') : null
  } catch {
    return null
  }
}

/** Downloads a cover, returning null for anything that is not an image we can serve. */
async function download(url: string): Promise<PostCoverImage | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) return null

    const body = await res.arrayBuffer()
    if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return null

    return { body, contentType: contentType.split(';')[0].trim() }
  } catch {
    return null
  }
}

/* ── the one entry point ──────────────────────────────────────────────────── */

/**
 * The cover for one harvested post, fetched through whichever link still works.
 *
 * `kolId` is not decoration: the post has to hang off an account this creator
 * owns, or the route would let any org member pull any post in the warehouse by
 * guessing ids. Returns null when the post is not this creator's, when it has no
 * usable link, or when every attempt fails — the caller answers 404 and the grid
 * falls back to its format tile.
 */
export async function getPostCover(kolId: string, postId: string): Promise<PostCoverImage | null> {
  if (missed(postId)) return null

  const cached = cacheGet(postId)
  if (cached) {
    const image = await download(cached)
    if (image) return image
    cache.delete(postId)
  }

  const { rows } = await kolDb().query<{ cover_image: string | null; permalink: string | null }>(
    `SELECT p.cover_image, p.permalink
       FROM public.kol_social_account ksa
       JOIN l1_silver.unified_post p ON p.social_account_id = ksa.social_account_id
      WHERE ksa.kol_id = $1 AND p.id = $2
      LIMIT 1`,
    [kolId, postId],
  )
  const row = rows[0]
  if (!row) return null

  /** Records the refusal before handing the caller its null. */
  const giveUp = () => { misses.set(postId, Date.now()); return null }

  // The stored link first, but only when it has not already announced its own
  // death — skipping an expired one saves an outbound 403 per tile.
  if (row.cover_image?.startsWith('https://') && !cdnLinkExpired(row.cover_image)) {
    const image = await download(row.cover_image)
    if (image) { cacheSet(postId, row.cover_image); return image }
  }

  if (!row.permalink) return giveUp()
  const fresh = await freshCoverUrl(row.permalink)
  if (!fresh) return giveUp()

  const image = await download(fresh)
  if (!image) return giveUp()

  cacheSet(postId, fresh)
  return image
}

/* ── wiring ───────────────────────────────────────────────────────────────── */

/**
 * Rewrites a creator payload so every harvested cover points at the cover route
 * instead of at the platform's own CDN.
 *
 * Done here, on the way out of the API, because this is the only layer that
 * knows the org the request came through — `getKolMeasured` has a post id and
 * nothing else. The client stays unchanged: it still reads `coverImage` and puts
 * it in an `<img>`.
 */
export function withProxiedCovers(
  data: KolCreatorPayload, orgId: string, kolId: string,
): KolCreatorPayload {
  if (!data.measured?.recent?.length) return data

  const base = `/api/organizations/${orgId}/discover/kol-directory/${kolId}/cover`
  return {
    ...data,
    measured: {
      ...data.measured,
      recent: data.measured.recent.map(p => ({
        ...p,
        // A post carrying neither a stored link nor a permalink has no picture
        // to recover, so it keeps its null instead of pointing at a certain 404.
        coverImage: (p.coverImage || p.permalink) ? `${base}/${p.id}` : null,
      })),
    },
  }
}
