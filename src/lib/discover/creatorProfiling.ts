import {
  apifyItemError, fetchFbPosts, fetchFbProfile, fetchIgPosts, fetchIgProfile, fetchTiktokPosts,
  type ApifyFbPost, type ApifyIgPost, type ApifyTiktokPost, type ApifyTiktokAuthorMeta,
} from '@/lib/apify/client'
import { CATEGORIES, tierOf } from './vocab'
import {
  finishRun, getCreator, saveMeasurements, saveRunSteps, saveSnapshot, setProfilingStatus, startRun,
  type CreatorMeasurements,
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
  city?: string | null
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

async function harvestInstagram(username: string, known: CreatorProfile): Promise<Harvest> {
  const profile = await fetchIgProfile(username)
  const err = apifyItemError(profile)
  if (err?.gone) throw new Error(`Instagram no longer serves @${username}: ${err.description || err.code}`)
  if (!profile?.id && !known.followers) {
    throw new Error(`Instagram returned no profile for @${username}.`)
  }

  const isPrivate = !!profile?.private
  // A private account's posts are not readable. Asking for them anyway costs an
  // actor run to be told the same thing, so it is not asked.
  const posts = isPrivate ? [] : await fetchIgPosts(username, WINDOW_DAYS)

  return {
    displayName: profile?.fullName ?? null,
    avatarUrl: profile?.profilePicUrlHD ?? profile?.profilePicUrl ?? null,
    bio: profile?.biography ?? null,
    verified: !!profile?.verified,
    visibility: isPrivate ? 'private' : 'public',
    followers: numOrNull(profile?.followersCount),
    following: numOrNull(profile?.followsCount),
    postsCount: numOrNull(profile?.postsCount),
    categories: profile?.businessCategoryName ? [profile.businessCategoryName] : [],
    postsNote: isPrivate ? 'Account is private — its posts are not readable.' : null,
    posts: posts.slice(0, MAX_POSTS).map((p: ApifyIgPost) => ({
      url: p.url ?? (p.shortCode ? `https://www.instagram.com/p/${p.shortCode}/` : null),
      caption: p.caption ?? null,
      likes: numOrNull(p.likesCount),
      comments: numOrNull(p.commentsCount),
      views: numOrNull(p.videoPlayCount ?? p.videoViewCount),
      shares: null,
      date: p.timestamp ?? null,
      format: p.productType === 'clips' ? 'Reels'
        : p.type === 'Sidecar' ? 'Carousel'
        : p.type === 'Video' ? 'Video'
        : 'Feed Post',
      hashtags: hashtagsOf(p.caption, p.hashtags),
    })),
  }
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

async function harvestTiktok(username: string): Promise<Harvest> {
  // One actor run carries both legs: TikTok embeds the author's profile in every
  // post item, so posts and profile are the same request. `days = null` asks for
  // the latest posts regardless of date, which is also the only way to reach the
  // profile of a creator who has not posted inside the window.
  const posts = await fetchTiktokPosts(username, null, MAX_POSTS)
  const author: ApifyTiktokAuthorMeta | null =
    posts.find(p => p.authorMeta)?.authorMeta ?? null

  const err = posts.length ? apifyItemError(posts[0]) : null
  if (err?.gone) throw new Error(`TikTok no longer serves @${username}: ${err.description || err.code}`)
  if (!author && !posts.length) {
    throw new Error(`TikTok returned nothing for @${username}. The account may be new, private, or blocked to our region.`)
  }

  const isPrivate = !!author?.privateAccount
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000
  return {
    displayName: author?.nickName ?? author?.name ?? null,
    avatarUrl: author?.originalAvatarUrl ?? author?.avatar ?? null,
    bio: author?.signature ?? null,
    verified: !!author?.verified,
    visibility: isPrivate ? 'private' : 'public',
    followers: numOrNull(author?.fans),
    following: numOrNull(author?.following),
    postsCount: numOrNull(author?.video),
    categories: author?.commerceUserInfo?.category ? [author.commerceUserInfo.category] : [],
    postsNote: isPrivate ? 'Account is private — its posts are not readable.' : null,
    posts: (isPrivate ? [] : posts)
      .filter((p: ApifyTiktokPost) => {
        if (!p.createTimeISO) return true
        const t = new Date(p.createTimeISO).getTime()
        return !Number.isFinite(t) || t >= cutoff
      })
      .slice(0, MAX_POSTS)
      .map((p: ApifyTiktokPost) => ({
        url: p.webVideoUrl ?? null,
        caption: p.text ?? null,
        likes: numOrNull(p.diggCount),
        comments: numOrNull(p.commentCount),
        views: numOrNull(p.playCount),
        shares: numOrNull(p.shareCount),
        date: p.createTimeISO ?? null,
        format: p.isSlideshow ? 'Photo' : 'Video',
        hashtags: hashtagsOf(p.text, (p.hashtags ?? []).map(h => h?.name ?? '').filter(Boolean)),
      })),
  }
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
    await steps.begin('profile', creator.platform === 'tiktok'
      // TikTok embeds the profile in every post item, so one actor run covers
      // this step and the content step both — and it is the slow one.
      ? 'Asking TikTok for the profile and its recent posts — one request covers both, and it can take a minute or two'
      : `Asking ${creator.platform === 'facebook' ? 'Facebook' : 'Instagram'} for the profile — this usually takes 30-90 seconds`)
    const harvest = creator.platform === 'instagram' ? await harvestInstagram(creator.username, creator)
      : creator.platform === 'facebook' ? await harvestFacebook(creator.username)
      : await harvestTiktok(creator.username)
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
