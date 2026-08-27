import kolDb from '@/lib/kolDb'
import {
  apifyItemError, fetchFbPosts, fetchFbProfile,
  type ApifyFbPost,
} from '@/lib/apify/client'
import { scrapeNewKol } from '@/lib/kolDirectory/addKolScrape'
import { profileUrlFor } from './creatorInput'
import { CATEGORIES, LOCATIONS, tierOf } from './vocab'
import {
  finishRun, getCreator, saveMeasurements, saveRunSteps, saveSnapshot, setProfilingStatus,
  startRun, type CreatorMeasurements,
} from './creatorStore'
import {
  PROFILING_STEPS, type CreatorContent, type CreatorProfile, type CreatorVisibility, type FlowStep,
} from './creatorFlow'

/**
 * Profiling — the six steps that turn a validated handle into a creator profile.
 *
 * It runs in the background, fire-and-forget from the route that starts it, the
 * same shape the competitor initial sync uses (`@/lib/apify/sync`). It has to:
 * an Apify run takes anywhere from twenty seconds to several minutes, which is
 * far longer than a request can be held open, and the user is meant to watch the
 * progress screen rather than a frozen modal.
 *
 * State lives in `discover_creator_runs`, written after every step. That is what
 * makes the progress screen honest — it renders stored outcomes, not a timer —
 * and it is what lets the screen be closed and reopened, or opened on another
 * device, without losing the run.
 *
 * Nothing here fabricates a measurement. A step that cannot run is marked
 * `skipped` with the reason (a private account has no readable posts; an account
 * with nothing published in the window has nothing to average), and the columns
 * it would have filled stay null. A creator profiled while Apify is down is a
 * real creator with a real handle and no numbers — which is the truth, and is
 * recoverable with a refresh.
 */

/** How far back the content sample reaches. */
const WINDOW_DAYS = 90
/** Enough to characterise a creator; more costs time without changing the shape. */
const MAX_POSTS = 30

/* ── step bookkeeping ─────────────────────────────────────────────────────── */

class Steps {
  readonly list: FlowStep[]
  constructor(private runId: number) {
    this.list = PROFILING_STEPS.map(s => ({ key: s.key, label: s.label, state: 'pending', detail: null, at: null }))
  }

  private find(key: string) { return this.list.find(s => s.key === key) }

  /**
   * Mark the step the pipeline is entering, so the screen can show it working.
   *
   * The detail matters most here, not on the finished step: the first step is
   * the Apify run, which is a minute or more of nothing visibly happening, and a
   * progress list that says what is being waited on reads as working rather than
   * as stuck.
   */
  async begin(key: string, detail?: string): Promise<void> {
    const step = this.find(key)
    if (step) {
      step.state = 'running'
      step.detail = detail ?? null
    }
    await this.persist()
  }

  async done(key: string, detail?: string | null): Promise<void> { await this.set(key, 'done', detail) }
  async skip(key: string, detail: string): Promise<void> { await this.set(key, 'skipped', detail) }
  async fail(key: string, detail: string): Promise<void> { await this.set(key, 'failed', detail) }

  private async set(key: string, state: FlowStep['state'], detail?: string | null): Promise<void> {
    const step = this.find(key)
    if (step) {
      step.state = state
      step.detail = detail ?? null
      step.at = new Date().toISOString()
    }
    await this.persist()
  }

  /**
   * A write that fails must not take the run down with it. The step log is how
   * the run is *observed*; losing one line of it is not a reason to abandon
   * profiling that is otherwise working.
   */
  private async persist(): Promise<void> {
    try {
      await saveRunSteps(this.runId, this.list)
    } catch (err) {
      console.error('[creator profiling] step write failed:', err)
    }
  }
}

/* ── platform harvests ────────────────────────────────────────────────────── */

interface Harvest {
  displayName?: string | null
  avatarUrl?: string | null
  bio?: string | null
  verified?: boolean
  visibility: CreatorVisibility
  followers: number | null
  following: number | null
  postsCount: number | null
  /** Platform categories, when the platform states them (Facebook pages do). */
  categories?: string[]
  /** Normalised posts, newest first. Empty when none could be read. */
  posts: SamplePost[]
  /** Why the post sample is empty, when it is. */
  postsNote?: string | null
}

interface SamplePost {
  url: string | null
  caption: string | null
  likes: number | null
  comments: number | null
  views: number | null
  shares: number | null
  date: string | null
  format: string
  hashtags: string[]
}

const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu

/** Hashtags out of a caption, lower-cased and de-duplicated within the post. */
function hashtagsOf(caption: string | null | undefined, given?: string[]): string[] {
  const fromField = (given ?? []).map(h => `#${String(h).replace(/^#/, '')}`.toLowerCase())
  const fromText = (caption?.match(HASHTAG_RE) ?? []).map(h => h.toLowerCase())
  return [...new Set([...fromField, ...fromText])]
}

const numOrNull = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function harvestFacebook(username: string): Promise<Harvest> {
  const profile = await fetchFbProfile(username)
  const err = apifyItemError(profile)
  if (err?.gone) throw new Error(`Facebook no longer serves /${username}: ${err.description || err.code}`)

  const posts = await fetchFbPosts(username, WINDOW_DAYS)
  return {
    displayName: profile?.title ?? profile?.pageName ?? null,
    avatarUrl: profile?.profilePhoto ?? profile?.profilePictureUrl ?? null,
    bio: profile?.intro ?? null,
    // Facebook exposes no verification flag through this actor, so the column
    // keeps whatever validation recorded rather than being reset to false.
    visibility: 'public',
    followers: numOrNull(profile?.followers),
    following: null,
    postsCount: null,
    categories: Array.isArray(profile?.categories) ? profile!.categories! : [],
    posts: posts.slice(0, MAX_POSTS).map((p: ApifyFbPost) => ({
      url: p.topLevelUrl ?? p.url ?? null,
      caption: p.text ?? null,
      likes: numOrNull(p.likes),
      comments: null,
      views: null,
      shares: numOrNull(p.shares),
      date: p.time ?? null,
      format: 'Post',
      hashtags: hashtagsOf(p.text),
    })),
  }
}

/* ── the kol_directory pipeline (Instagram & TikTok) ─────────────────────── */

/**
 * Instagram and TikTok no longer run their own Apify harvest here. Both
 * platforms are handled by the "Add New KOL" pipeline (`@/lib/kolDirectory`),
 * which writes into `public.kol_directory` — the commercial roster shared
 * with `scrapper-project`, in the separate `kol` database. Profiling's job
 * for these two platforms shrinks to: find the roster row (or create it),
 * wait for it to be scraped, then read the result into the same `Harvest`
 * shape the old direct-Apify harvests produced — never scrape independently,
 * so a creator added here and one added through "Add New KOL" end up as the
 * exact same roster row instead of two competing scrapes of one account.
 *
 * Facebook is untouched: the roster pipeline does not support it, so
 * `harvestFacebook` above still calls Apify directly.
 */

type KolPipelinePlatform = 'instagram' | 'tiktok'

/** How often, and for how long, this waits on a scrape it did not start
 *  itself finishing (an in-progress one) or one it just started. */
const KOL_SCRAPE_POLL_INTERVAL_MS = 5_000
const KOL_SCRAPE_POLL_TIMEOUT_MS = 120_000

interface DirectoryHit { id: string; scrapeStatus: string | null }

/**
 * Is this handle already a `kol_directory` row, from any org's intake or from
 * "Add New KOL" directly? Looked up by handle every time, so two creators
 * (this org's and another org's, or this one added twice under different
 * platforms) resolve to the one roster row rather than each minting their
 * own — `scrapeNewKol` always inserts a fresh row with no de-duplication of
 * its own, so calling it for a handle that already has one would fork the
 * roster.
 */
async function findDirectoryRow(platform: KolPipelinePlatform, username: string): Promise<DirectoryHit | null> {
  const { rows } = await kolDb().query<{ id: string; scrape_status: string | null }>(
    `SELECT kd.id, kd.scrape_status
       FROM public.kol_directory kd
       JOIN public.platforms pl ON pl.id = kd.platform_id
      WHERE pl.key = $1 AND LOWER(kd.username_normalized) = LOWER($2)
      LIMIT 1`,
    [platform, username],
  )
  return rows[0] ? { id: rows[0].id, scrapeStatus: rows[0].scrape_status } : null
}

async function waitForScrape(kolDirectoryId: string): Promise<'success' | 'failed' | 'timeout'> {
  const deadline = Date.now() + KOL_SCRAPE_POLL_TIMEOUT_MS
  for (;;) {
    const { rows } = await kolDb().query<{ scrape_status: string | null }>(
      `SELECT scrape_status FROM public.kol_directory WHERE id = $1`, [kolDirectoryId],
    )
    const status = rows[0]?.scrape_status ?? null
    if (status === 'success' || status === 'failed') return status
    if (Date.now() >= deadline) return 'timeout'
    await new Promise(resolve => setTimeout(resolve, KOL_SCRAPE_POLL_INTERVAL_MS))
  }
}

const numOrNullDb = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** `l1_silver.unified_post.media_type` values seen from both platforms'
 *  harmonisation, folded into the same labels the old Apify harvests used. */
function formatOfMediaType(mediaType: string | null): string {
  const t = (mediaType ?? '').toLowerCase()
  if (t === 'clips' || t === 'reel' || t === 'reels') return 'Reels'
  if (t.includes('carousel') || t === 'sidecar') return 'Carousel'
  if (t === 'video') return 'Video'
  return 'Feed Post'
}

interface DirectoryProfileRow {
  display_name: string | null
  avatar_url: string | null
  bio: string | null
  followers_count: number | null
  verified_status: string | null
  is_private: boolean | null
  following_count: string | number | null
  media_count: number | null
  social_account_id: string | null
}

interface DirectoryPostRow {
  permalink: string | null
  caption: string | null
  likes: string | number | null
  comments: string | number | null
  views: string | number | null
  shares: string | number | null
  posted_at: Date | string | null
  media_type: string | null
  hashtags: string[] | null
}

/**
 * Read a scraped roster row (`kol_directory` joined to `l1_silver`) into the
 * same `Harvest` shape the Apify-backed harvests produce, so everything
 * downstream — `analyse`, `identifyCategory`, `identifyCity`, saving — runs
 * completely unmodified.
 *
 * Whatever the roster does not carry (platform-declared categories; this
 * pipeline's `kol_directory.category_id` uses a different taxonomy than
 * `identifyCategory`'s labels and is not translated here) is left at its
 * neutral default rather than guessed — the discipline `identifyCategory` and
 * `identifyCity` already document for their own gaps.
 */
async function harvestFromDirectory(kolDirectoryId: string): Promise<Harvest> {
  const { rows } = await kolDb().query<DirectoryProfileRow>(
    `SELECT up.display_name, kd.avatar_url, kd.bio, kd.followers_count, kd.verified_status,
            up.is_private, up.following_count, up.media_count, ksa.social_account_id
       FROM public.kol_directory kd
       LEFT JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
       LEFT JOIN l1_silver.unified_profile up ON up.social_account_id = ksa.social_account_id
      WHERE kd.id = $1
      LIMIT 1`,
    [kolDirectoryId],
  )
  const r = rows[0]
  if (!r) throw new Error(`kol_directory row ${kolDirectoryId} vanished before it could be read.`)

  const isPrivate = r.is_private === true
  const posts: SamplePost[] = []
  if (r.social_account_id && !isPrivate) {
    const { rows: postRows } = await kolDb().query<DirectoryPostRow>(
      `SELECT permalink, caption, likes, comments, views, shares, posted_at, media_type, hashtags
         FROM l1_silver.unified_post
        WHERE social_account_id = $1
          AND posted_at >= now() - ($2 || ' days')::interval
        ORDER BY posted_at DESC
        LIMIT $3`,
      [r.social_account_id, WINDOW_DAYS, MAX_POSTS],
    )
    for (const p of postRows) {
      posts.push({
        url: p.permalink,
        caption: p.caption,
        likes: numOrNullDb(p.likes),
        comments: numOrNullDb(p.comments),
        views: numOrNullDb(p.views),
        shares: numOrNullDb(p.shares),
        date: p.posted_at ? new Date(p.posted_at).toISOString() : null,
        format: formatOfMediaType(p.media_type),
        hashtags: hashtagsOf(p.caption, p.hashtags ?? undefined),
      })
    }
  }

  return {
    displayName: r.display_name ?? null,
    avatarUrl: r.avatar_url ?? null,
    bio: r.bio ?? null,
    verified: r.verified_status === 'verified',
    // `is_private` comes from `unified_profile`, which only exists once a
    // scrape has actually landed. No profile row at all reads as
    // "unconfirmed", the same as a fresh TikTok oEmbed lookup used to.
    visibility: r.social_account_id ? (isPrivate ? 'private' : 'public') : 'unknown',
    followers: numOrNullDb(r.followers_count),
    following: numOrNullDb(r.following_count),
    postsCount: numOrNullDb(r.media_count),
    categories: [],
    postsNote: isPrivate
      ? 'Account is private — its posts are not readable.'
      : !posts.length ? `No posts recorded in the commercial roster for the last ${WINDOW_DAYS} days` : null,
    posts,
  }
}

/**
 * Instagram/TikTok entry point: find this handle's roster row (or start a
 * scrape for it if none exists), wait for a scrape to land if one is needed,
 * then read the result.
 */
async function harvestFromKolPipeline(
  platform: KolPipelinePlatform, creator: CreatorProfile, steps: Steps,
): Promise<Harvest> {
  const hit = await findDirectoryRow(platform, creator.username)

  if (hit?.scrapeStatus === 'success') {
    await steps.begin('profile', 'Already scraped into the commercial roster — reading the result.')
    return harvestFromDirectory(hit.id)
  }

  if (hit) {
    // A row exists but was never scraped successfully. Re-running
    // `scrapeNewKol` here would insert a second identity row for the same
    // handle (it has no upsert-by-username of its own) — so a `failed` row is
    // reported as a failure rather than retried, and a `null` one (a scrape
    // genuinely in progress, started moments ago by this same call for
    // another org, or by "Add New KOL" directly) is waited on instead of
    // duplicated.
    if (hit.scrapeStatus === 'failed') {
      throw new Error(`The commercial roster's last scrape of @${creator.username} failed. Try refreshing again later.`)
    }
    await steps.begin('profile', 'This account is already being scraped into the commercial roster — waiting for it to finish.')
    const outcome = await waitForScrape(hit.id)
    if (outcome === 'failed') {
      throw new Error(`The commercial roster scrape for @${creator.username} failed. Try refreshing again later.`)
    }
    if (outcome === 'timeout') {
      throw new Error(
        `The commercial roster scrape for @${creator.username} did not finish within ` +
        `${Math.round(KOL_SCRAPE_POLL_TIMEOUT_MS / 1000)}s. It may still complete in the background — refresh later to pick up the result.`)
    }
    return harvestFromDirectory(hit.id)
  }

  // Genuinely new to the roster — start the same pipeline "Add New KOL" uses.
  await steps.begin('profile',
    `${platform === 'tiktok' ? 'TikTok' : 'Instagram'} is not in the commercial roster yet — starting a scrape. This usually takes one to two minutes.`)
  const { kolDirectoryId } = await scrapeNewKol({
    platform,
    username: creator.username,
    profileUrl: creator.profileUrl ?? profileUrlFor(platform, creator.username),
    triggeredBy: null,
    // Discover's intake has no agency context of its own to resolve — the
    // roster row still gets created; only the `agency_kol_accounts` link is
    // skipped, same as it is for any other unresolved-agency caller.
    agencyId: null,
    createdByUserId: null,
  })

  const outcome = await waitForScrape(kolDirectoryId)
  if (outcome === 'failed') {
    throw new Error(`The commercial roster scrape for @${creator.username} failed. Try refreshing again later.`)
  }
  if (outcome === 'timeout') {
    throw new Error(
      `The commercial roster scrape for @${creator.username} did not finish within ` +
      `${Math.round(KOL_SCRAPE_POLL_TIMEOUT_MS / 1000)}s. It may still complete in the background — refresh later to pick up the result.`)
  }
  return harvestFromDirectory(kolDirectoryId)
}

/* ── analysis ─────────────────────────────────────────────────────────────── */

const avg = (xs: (number | null)[]): number | null => {
  const vals = xs.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

const round = (v: number | null, digits = 2): number | null =>
  v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits

interface ContentAnalysis {
  content: CreatorContent
  avgLikes: number | null
  avgComments: number | null
  avgViews: number | null
  erPct: number | null
}

/**
 * What the sample says about the creator.
 *
 * The engagement rate is interactions per post against followers, in percentage
 * points — the same unit `kol_directory.engagement_rate` carries, so a creator
 * added here and one from the commercial roster can be read side by side. It is
 * null, not zero, when there are no followers to divide by or no posts to
 * average: a creator whose ER was never measurable must not appear in a filter
 * for "ER above 0".
 */
function analyse(posts: SamplePost[], followers: number | null): ContentAnalysis {
  const avgLikes = round(avg(posts.map(p => p.likes)))
  const avgComments = round(avg(posts.map(p => p.comments)))
  const avgViews = round(avg(posts.map(p => p.views)))
  const avgShares = round(avg(posts.map(p => p.shares)))

  const interactions = [avgLikes, avgComments, avgShares]
    .filter((v): v is number => v !== null)
    .reduce((a, b) => a + b, 0)
  const erPct = posts.length && followers && followers > 0 && interactions > 0
    ? round((interactions / followers) * 100, 3)
    : null

  // Formats, largest share first.
  const byFormat = new Map<string, number>()
  posts.forEach(p => byFormat.set(p.format, (byFormat.get(p.format) ?? 0) + 1))
  const formats = [...byFormat.entries()]
    .map(([label, count]) => ({ label, count, share: round((count / posts.length) * 100, 1) ?? 0 }))
    .sort((a, b) => b.count - a.count)

  const byTag = new Map<string, number>()
  posts.forEach(p => p.hashtags.forEach(t => byTag.set(t, (byTag.get(t) ?? 0) + 1)))
  const hashtags = [...byTag.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 12)

  // Cadence over the span the sample actually covers, not over the requested
  // window: a creator whose thirty posts all landed in one week posts weekly at
  // a rate the window would understate by an order of magnitude.
  const times = posts
    .map(p => (p.date ? new Date(p.date).getTime() : NaN))
    .filter(t => Number.isFinite(t))
    .sort((a, b) => a - b)
  const spanDays = times.length > 1 ? (times[times.length - 1] - times[0]) / 86_400_000 : null
  const postsPerWeek = spanDays && spanDays >= 1 ? round((times.length / spanDays) * 7, 1) : null

  const byHour = new Map<number, number>()
  times.forEach(t => {
    // Jakarta time: the creators this roster holds post to an Indonesian
    // audience, and an hour in UTC would be seven hours off the truth.
    const hour = new Date(t + 7 * 3_600_000).getUTCHours()
    byHour.set(hour, (byHour.get(hour) ?? 0) + 1)
  })
  const peakHour = byHour.size
    ? [...byHour.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
    : null

  const engagementOf = (p: SamplePost) => (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0)
  const topPosts = [...posts]
    .sort((a, b) => engagementOf(b) - engagementOf(a))
    .slice(0, 3)
    .map(p => ({
      url: p.url,
      caption: p.caption ? p.caption.slice(0, 240) : null,
      likes: p.likes, comments: p.comments, views: p.views, date: p.date,
    }))

  return {
    content: {
      postsAnalyzed: posts.length,
      windowDays: WINDOW_DAYS,
      formats,
      hashtags,
      postsPerWeek,
      peakHour,
      topPosts,
    },
    avgLikes, avgComments, avgViews, erPct,
  }
}

/**
 * Which category this creator makes content for.
 *
 * Keyword matching over the bio, the recurring hashtags and whatever category
 * the platform itself states. The seven labels the rest of Discover filters on
 * (`vocab.CATEGORIES`) come first, so a creator that fits one of them lands in
 * the vocabulary the other surfaces already speak.
 *
 * They are not the whole list, though, and that is deliberate. Those seven were
 * drawn for an org's *own* accounts — the pillars a brand posts under. Creators
 * arrive in shapes none of them cover: the comedy creator this flow was designed
 * around is not Lifestyle, and filing them there would be a wrong answer dressed
 * as a complete one. So a second set extends the list for intake only, and the
 * column is free text rather than an enum precisely so it can.
 *
 * Deliberately rule-based rather than a model call. The evidence is a handful of
 * words, and a rule that returns null when nothing matches is worth more here
 * than a model that will always name something: an unlabelled creator is honest,
 * and a confidently wrong label is what makes a category filter untrustworthy.
 */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Fitness: ['fitness', 'gym', 'workout', 'olahraga', 'yoga', 'lari', 'running', 'sehat', 'health', 'diet', 'muscle', 'crossfit'],
  Lifestyle: ['lifestyle', 'daily', 'vlog', 'keseharian', 'home', 'rumah', 'motivasi', 'life'],
  Beauty: ['beauty', 'makeup', 'skincare', 'kecantikan', 'kosmetik', 'cosmetic', 'glowing', 'skin', 'mua', 'hair'],
  Food: ['food', 'kuliner', 'makan', 'resep', 'recipe', 'chef', 'masak', 'cooking', 'foodie', 'cafe', 'restoran', 'restaurant'],
  Tech: ['tech', 'teknologi', 'gadget', 'smartphone', 'laptop', 'coding', 'developer', 'startup', 'software'],
  Fashion: ['fashion', 'ootd', 'style', 'outfit', 'busana', 'hijab', 'thrift', 'streetwear'],
  Travel: ['travel', 'jalan', 'wisata', 'trip', 'traveling', 'liburan', 'holiday', 'explore', 'pantai', 'gunung', 'mountain'],
  /* ── the intake-only extension ─────────────────────────────────────────── */
  Entertainment: ['comedy', 'komedi', 'lucu', 'humor', 'prank', 'hiburan', 'entertainment', 'skit', 'meme', 'standup'],
  Gaming: ['gaming', 'gamer', 'mobilelegends', 'freefire', 'valorant', 'pubg', 'esport', 'streamer', 'roblox', 'minecraft'],
  Education: ['edukasi', 'education', 'belajar', 'tutorial', 'kursus', 'kuliah', 'beasiswa', 'bahasa', 'sains', 'science'],
  Parenting: ['parenting', 'ibu', 'bunda', 'anak', 'bayi', 'keluarga', 'family', 'momlife', 'kehamilan'],
  Music: ['music', 'musik', 'cover', 'singer', 'penyanyi', 'gitar', 'piano', 'band', 'dj', 'rapper'],
  Finance: ['finance', 'keuangan', 'investasi', 'invest', 'saham', 'crypto', 'bisnis', 'business', 'trading', 'uang'],
  Automotive: ['otomotif', 'automotive', 'mobil', 'motor', 'car', 'bike', 'modifikasi', 'racing', 'touring'],
  Sports: ['sport', 'sepakbola', 'football', 'basket', 'badminton', 'atlet', 'athlete', 'futsal', 'mma'],
}

/** The order labels are considered in, shared vocabulary first. */
const CATEGORY_LABELS = [
  ...CATEGORIES.filter(c => CATEGORY_KEYWORDS[c]),
  ...Object.keys(CATEGORY_KEYWORDS).filter(c => !CATEGORIES.includes(c as (typeof CATEGORIES)[number])),
]

export function identifyCategory(
  bio: string | null | undefined,
  hashtags: { tag: string; count: number }[],
  platformCategories: string[] = [],
): { category: string | null; basis: string } {
  const haystack = [
    (bio ?? '').toLowerCase(),
    ...hashtags.map(h => `${h.tag} `.repeat(Math.min(h.count, 5))),
    ...platformCategories.map(c => c.toLowerCase()),
  ].join(' ')

  if (!haystack.trim()) return { category: null, basis: 'No bio, hashtags or platform category to read' }

  const scores = CATEGORY_LABELS.map(name => {
    const words = CATEGORY_KEYWORDS[name] ?? []
    const hits = words.reduce((n, w) => n + (haystack.match(new RegExp(`\\b${w}`, 'g'))?.length ?? 0), 0)
    return { name, hits }
  }).sort((a, b) => b.hits - a.hits)

  const best = scores[0]
  if (!best || best.hits === 0) {
    return { category: null, basis: 'Nothing in the bio or hashtags matched a category' }
  }
  return {
    category: best.name,
    basis: `${best.hits} matching term${best.hits > 1 ? 's' : ''} in bio and hashtags`,
  }
}

/**
 * Where this creator is, when they say so.
 *
 * Location is one of Basic Discovery's filters, and until now nothing wrote the
 * column it filters on — every creator intake produced was `city: null`, so the
 * filter would have been a control over an empty set.
 *
 * The evidence is the bio, and only the bio — the one field all three platforms
 * return (`biography` on Instagram, `intro` on Facebook, `signature` on TikTok)
 * and the one place a creator states where they are.
 *
 * Hashtags are deliberately left out, unlike in `identifyCategory`. A category
 * tag describes the creator (`#skincare` on half their posts means they make
 * skincare content), but a location tag describes the *post*: `#explorejakarta`
 * is as likely to be a Bandung creator on a trip as a Jakarta resident. Reading
 * it as an address would fill this column with the places people visit rather
 * than the places they live. Concatenated tags make it worse — matching inside
 * `#balikpapan` yields Bali — so the tags buy a weak signal at the price of a
 * confident wrong answer.
 *
 * Matched against `vocab.LOCATIONS` rather than free text, so the value lands in
 * the vocabulary Smart Discovery's location constraint already speaks — a city
 * this cannot name stays null rather than being written in whatever spelling the
 * creator used, which would make the filter list grow a synonym per creator.
 *
 * The aliases are how people actually write these: `jaksel` and `jkt` are far
 * more common in a bio than `Jakarta`, and a Bali creator names the village
 * (`Canggu`, `Ubud`) rather than the island. `diy` is deliberately *not* an alias
 * for Yogyakarta, common though it is on paper: in a creator bio it is nearly
 * always the English "DIY", and a wrong city is worse than no city.
 *
 * Rule-based, and null when nothing matches, for the same reason the category is.
 */
const CITY_KEYWORDS: Record<(typeof LOCATIONS)[number], string[]> = {
  Jakarta: ['jakarta', 'jkt', 'jaksel', 'jakut', 'jaktim', 'jakbar', 'jakpus', 'tangerang', 'bekasi', 'depok', 'bsd'],
  Bandung: ['bandung', 'bdg'],
  Surabaya: ['surabaya', 'sby'],
  Medan: ['medan'],
  Yogyakarta: ['yogyakarta', 'jogjakarta', 'yogya', 'jogja'],
  Bali: ['bali', 'denpasar', 'canggu', 'ubud', 'seminyak'],
  Makassar: ['makassar'],
}

export function identifyCity(bio: string | null | undefined): { city: string | null; basis: string } {
  const haystack = (bio ?? '').toLowerCase()
  if (!haystack.trim()) return { city: null, basis: 'No bio to read a location from' }

  const scores = LOCATIONS.map(name => {
    const hits = CITY_KEYWORDS[name].reduce(
      // Bounded both ends, unlike the category match: `bali` must not fire on
      // `balik` or `balikpapan`, and `medan` must not fire on `medannya`.
      (n, w) => n + (haystack.match(new RegExp(`\\b${w}\\b`, 'g'))?.length ?? 0),
      0,
    )
    return { name, hits }
  }).sort((a, b) => b.hits - a.hits)

  const best = scores[0]
  if (!best || best.hits === 0) {
    return { city: null, basis: 'No known city named in the bio' }
  }
  // A tie is two cities with equal evidence, which is not an answer. It happens
  // to creators who list where they are *and* where they shoot; naming either
  // one would be a coin flip written into a filter.
  if (scores[1] && scores[1].hits === best.hits) {
    return { city: null, basis: `Bio names ${best.name} and ${scores[1].name} equally — too ambiguous to pick one` }
  }
  return {
    city: best.name,
    basis: `named ${best.hits} time${best.hits > 1 ? 's' : ''} in the bio`,
  }
}

/* ── the pipeline ─────────────────────────────────────────────────────────── */

/**
 * Run the six steps for one creator.
 *
 * Called fire-and-forget, so it never throws to its caller: a failure is
 * recorded on the run and on the creator, which is where the UI reads it from.
 */
export async function profileCreator(
  orgId: string, creatorId: string, kind: 'initial' | 'refresh',
): Promise<void> {
  const creator = await getCreator(orgId, creatorId)
  if (!creator) {
    console.warn(`[creator profiling] ${creatorId} vanished before profiling started`)
    return
  }

  const run = await startRun(creatorId, kind, [])
  const steps = new Steps(run.id)
  await setProfilingStatus(creatorId, 'running')

  try {
    // 1. Profile ─────────────────────────────────────────────────────────────
    // Instagram and TikTok read (or start) the commercial roster's own scrape
    // via `harvestFromKolPipeline`, which calls `steps.begin('profile', ...)`
    // itself once it knows whether this is a fresh scrape, an in-progress one,
    // or an already-scraped row — Facebook's timing is simpler, so it keeps
    // its one static message here.
    if (creator.platform === 'facebook') {
      await steps.begin('profile', 'Asking Facebook for the profile — this usually takes 30-90 seconds')
    }
    const harvest = creator.platform === 'instagram' ? await harvestFromKolPipeline('instagram', creator, steps)
      : creator.platform === 'tiktok' ? await harvestFromKolPipeline('tiktok', creator, steps)
      : await harvestFacebook(creator.username)
    await steps.done('profile', harvest.displayName
      ? `${harvest.displayName} — ${harvest.visibility} account`
      : `${harvest.visibility} account`)

    // 2. Statistics ──────────────────────────────────────────────────────────
    await steps.begin('stats')
    const hasStats = harvest.followers !== null || harvest.postsCount !== null
    await (hasStats
      ? steps.done('stats', [
          harvest.followers !== null ? `${harvest.followers.toLocaleString('en-US')} followers` : null,
          harvest.postsCount !== null ? `${harvest.postsCount.toLocaleString('en-US')} posts` : null,
        ].filter(Boolean).join(' · '))
      : steps.skip('stats', `${creator.platform} did not return follower figures for this account`))

    // 3. Content ─────────────────────────────────────────────────────────────
    await steps.begin('content', harvest.posts.length
      ? `Reading ${harvest.posts.length} posts`
      : 'Checking what the account published recently')
    const analysis = harvest.posts.length ? analyse(harvest.posts, harvest.followers) : null
    await (analysis
      ? steps.done('content',
          `${analysis.content.postsAnalyzed} posts in the last ${WINDOW_DAYS} days` +
          (analysis.erPct !== null ? ` · ER ${analysis.erPct.toFixed(2)}%` : ' · not enough data for an engagement rate'))
      : steps.skip('content', harvest.postsNote
          ?? `No posts published in the last ${WINDOW_DAYS} days, so there is nothing to analyse yet`))

    // 4. Category ────────────────────────────────────────────────────────────
    await steps.begin('category')
    const { category, basis } = identifyCategory(
      harvest.bio, analysis?.content.hashtags ?? [], harvest.categories,
    )
    await (category
      ? steps.done('category', `${category} — ${basis}`)
      : steps.skip('category', basis))

    // 5. Generate ────────────────────────────────────────────────────────────
    await steps.begin('generate')
    const tier = harvest.followers !== null && harvest.followers > 0 ? tierOf(harvest.followers) : null
    const { city, basis: cityBasis } = identifyCity(harvest.bio)
    const measurements: CreatorMeasurements = {
      displayName: harvest.displayName ?? creator.displayName,
      avatarUrl: harvest.avatarUrl ?? creator.avatarUrl,
      bio: harvest.bio ?? creator.bio,
      visibility: harvest.visibility,
      followers: harvest.followers,
      following: harvest.following,
      postsCount: harvest.postsCount,
      tier,
      // Absent keys are left untouched by `saveMeasurements`, which is what a
      // failed content leg needs: last week's characteristics stay rather than
      // being overwritten with emptiness.
      ...(harvest.verified !== undefined ? { verified: harvest.verified } : {}),
      ...(category ? { category } : {}),
      // Absent rather than null when unknown, so a bio that stopped naming a
      // city does not erase the one an earlier run read from it.
      ...(city ? { city } : {}),
      ...(analysis ? {
        avgLikes: analysis.avgLikes,
        avgComments: analysis.avgComments,
        avgViews: analysis.avgViews,
        erPct: analysis.erPct,
        content: analysis.content,
      } : {}),
    }
    await steps.done('generate', [
      tier ? `${tier} tier` : null,
      category ?? null,
      // The city, and when there is none, why — the same discipline the other
      // five steps keep: a blank field on the profile should be explained by
      // the run that left it blank.
      city ? `${city} (${cityBasis})` : `no location — ${cityBasis}`,
      harvest.visibility === 'private' ? 'limited data (private account)' : null,
    ].filter(Boolean).join(' · ') || 'Profile assembled')

    // 6. Save ────────────────────────────────────────────────────────────────
    await steps.begin('save')
    await saveMeasurements(creatorId, measurements)
    await saveSnapshot(creatorId, {
      followers: harvest.followers,
      following: harvest.following,
      postsCount: harvest.postsCount,
      erPct: analysis?.erPct ?? null,
      avgLikes: analysis?.avgLikes ?? null,
      avgComments: analysis?.avgComments ?? null,
    })
    await setProfilingStatus(creatorId, 'ready')
    await steps.done('save', 'Profile saved and available for Discovery')

    await finishRun(run.id, 'done', steps.list)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[creator profiling] ${creator.platform}/@${creator.username} failed:`, err)
    // The step that was in flight carries the reason, so the screen points at
    // where the run stopped rather than only saying that it did.
    const current = steps.list.find(s => s.state === 'running')
    if (current) await steps.fail(current.key, message)
    await setProfilingStatus(creatorId, 'failed', message)
    await finishRun(run.id, 'failed', steps.list, message)
  }
}

/**
 * Start profiling without making the caller wait for it.
 *
 * Fire-and-forget, like the competitor initial sync: the route returns as soon
 * as the creator row exists, and the progress screen polls the run. The `catch`
 * is a last line of defence — `profileCreator` records its own failures — for
 * the case where it cannot even reach the database to do so.
 */
export function startProfiling(orgId: string, creatorId: string, kind: 'initial' | 'refresh'): void {
  profileCreator(orgId, creatorId, kind).catch(err => {
    console.error('[creator profiling] unhandled failure:', err)
  })
}
