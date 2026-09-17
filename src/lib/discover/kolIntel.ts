import type { KolDirectoryRow } from './kolDirectory'
import type { KolMeasured } from './kolMeasured'
import type { GoldPost } from './kolGold'

/**
 * One creator's intelligence — measured, or explicitly absent.
 *
 * ── What this module used to be ────────────────────────────────────────────
 * An overlay. `sampleIntel()` generated a complete workspace payload and the
 * measured values were written over the fields they covered, so a creator the
 * warehouse had never harvested still got nine content cards, a six-month
 * trend, likes, comments, views, shares and saves — each carrying an estimate
 * marker. The marker was true and it was not enough: a reader comparing two
 * creators reads the numbers, and the generated ones sat in the same grid, in
 * the same type face, as the real ones.
 *
 * ── What it is now ─────────────────────────────────────────────────────────
 * A reader. Every performance and content figure below comes from
 * `l1_silver.unified_post` through `@/lib/discover/kolMeasured`, and is `null`
 * or `[]` when that creator has no rows. There is no generated fallback left
 * in this path at all, which is why the fields became nullable rather than
 * staying numbers.
 *
 * Coverage is small and the UI says so per card: of 7.432 active creators, 55
 * have any harvested post, 32 have a post with views, 30 have hashtags, 11 have
 * saves and 10 have shares. **Nobody has reach** — `unified_post.reach` is 0 in
 * all 503 rows — so reach is unavailable here rather than derived from views.
 * Views are not reach and are never relabelled as reach.
 *
 * Nothing in this module is generated any more. `growth` was the last such
 * field and moved to the real `l2_gold.kol_profile_card.followers_growth` in
 * Phase 4D; `@/lib/discover/kolSample` was deleted with it, so there is no
 * generator left in Discover to fall back to even by accident.
 */

/**
 * Which figures on this creator rest on a measurement.
 *
 * Still per-field rather than per-section, for the reason it always was: within
 * Performance, likes and views can be measured while shares and saves are not.
 * `reach` is retained and is **false for every creator** — the flag is what a
 * future harvest would flip, and removing it would hide that the column exists
 * and is empty.
 */
export interface RealFlags {
  likes: boolean
  comments: boolean
  views: boolean
  reach: boolean
  shares: boolean
  saves: boolean
  /** The format mix under Content. */
  formats: boolean
  /** The content grid. */
  content: boolean
  /** The creator's prices, from the KOL platform's own rate card. */
  rates: boolean
  /** Tags counted from the harvested posts, not a written-in list. */
  hashtags: boolean
}

/**
 * One harvested post, as the content grid renders it.
 *
 * Every field is either the post's own value or null. It replaces
 * `SampleContentItem`, which carried the same shape but filled the gaps from a
 * generated item — so a real post could show a generated share count beside its
 * real like count, with one marker covering both.
 */
export interface ContentItem {
  /** The caption's first line; falls back to the format name, never to prose. */
  title: string
  caption: string | null
  format: string
  platform: string
  /** ISO timestamp, or null when the harvest carried no date. */
  postedAt: string | null
  permalink: string | null
  coverImage: string | null
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  /**
   * The pipeline's own ER for this post — `l2_gold.post_metric.er_followers`,
   * (like + comment + share) over followers at post date — as a percentage.
   *
   * Null when the pipeline left it null (no follower snapshot before the post,
   * likes hidden, or a collaboration) or has no row for the post. It used to be
   * (likes + comments) / views computed here: a second ER definition, against a
   * different denominator, printed under the same label as the roster ER.
   */
  erPct: number | null
  hashtags: string[]
  /** The platform's own paid-partnership flag. */
  sponsored: boolean
}

export interface CreatorIntel {
  real: RealFlags
  /** Passed through so components can show the basis ("dari 10 post"). */
  measured: KolMeasured | null

  /** Per-post averages over the harvested set. Null when nothing was harvested. */
  kpi: {
    avgViews: number | null
    avgLikes: number | null
    avgComments: number | null
    /**
     * Always null. `unified_post.reach` is 0 in all 503 harvested rows, and no
     * other table on this server carries a per-post reach. Kept as a field so
     * the absence is explicit rather than a missing key.
     */
    avgReach: null
  }

  /** Totals over the harvested set. Null per metric where unmeasured. */
  performance: {
    likes: number | null
    comments: number | null
    views: number | null
    shares: number | null
    saves: number | null
    /** Always null — see `kpi.avgReach`. */
    reach: null
    /** Always null: no impressions column exists on this server. */
    impressions: null
  }

  content: {
    /** Newest first. Empty when this creator has no harvested posts. */
    recent: ContentItem[]
    /** The same posts ordered by views. Empty when none carry views. */
    top: ContentItem[]
    /** Real format mix from the harvest. Empty when nothing was harvested. */
    formats: { label: string; pct: number; n: number }[]
    /** Real tags counted across the harvest. Empty when none carry tags. */
    hashtags: { tag: string; n: number }[]
    /** Posts per 30 days across the harvest window. Null below two posts. */
    postsPer30d: number | null
  }
}

/**
 * What a measured figure rests on, for the tile's hint line. Undefined when
 * nothing was harvested, so the caller can leave the hint off entirely rather
 * than printing "dari 0 post".
 */
export function measuredBasis(intel: CreatorIntel): string | undefined {
  const n = intel.measured?.postCount ?? 0
  return n > 0 ? `dari ${n} post` : undefined
}

/** The basis of `kpi.avgViews`: the posts that carried a view count. */
export function avgViewsBasis(creator: KolDirectoryRow): string | undefined {
  const n = creator.viewsAnalyzedCount
  return n ? `dari ${n} post ber-views` : undefined
}

const NONE: RealFlags = {
  likes: false, comments: false, views: false,
  reach: false, shares: false, saves: false,
  formats: false, content: false, rates: false, hashtags: false,
}

const EMPTY_CONTENT: CreatorIntel['content'] = {
  recent: [], top: [], formats: [], hashtags: [], postsPer30d: null,
}

const EMPTY_KPI: CreatorIntel['kpi'] = {
  avgViews: null, avgLikes: null, avgComments: null, avgReach: null,
}

const EMPTY_PERFORMANCE: CreatorIntel['performance'] = {
  likes: null, comments: null, views: null, shares: null, saves: null,
  reach: null, impressions: null,
}

/** Turns one harvested post into the grid's shape. Nothing is filled in. */
function toItem(
  post: KolMeasured['recent'][number],
  platform: string,
  erFollowers: number | null,
): ContentItem {
  const caption = post.caption?.trim() ?? ''
  return {
    // A caption is the only title these posts have; its first line reads as a
    // headline. With no caption the format name is used — a label, not a claim.
    title: caption ? caption.split('\n')[0].slice(0, 80) : `Post ${post.format}`,
    caption: caption || null,
    format: post.format,
    platform: post.mediaType ? platform : platform,
    postedAt: post.date,
    permalink: post.permalink,
    coverImage: post.coverImage,
    views: post.views,
    likes: post.likes,
    comments: post.comments,
    shares: post.shares,
    saves: post.saves,
    erPct: erFollowers === null ? null : Math.round(erFollowers * 10_000) / 100,
    hashtags: post.hashtags.map(t => `#${t}`),
    sponsored: post.sponsored,
  }
}

/**
 * Posting cadence across the harvest window, per 30 days.
 *
 * Needs at least two posts and a window of at least a day: a single post has no
 * cadence, and dividing by a zero-length window produces an arithmetic artefact
 * rather than a rate. Null in both cases.
 */
function postsPer30d(m: KolMeasured): number | null {
  if (m.postCount < 2 || !m.firstPostAt || !m.lastPostAt) return null
  const days = (new Date(m.lastPostAt).getTime() - new Date(m.firstPostAt).getTime()) / 86_400_000
  if (!Number.isFinite(days) || days < 1) return null
  return Math.round((m.postCount / days) * 30 * 10) / 10
}

/**
 * `creatorIntel` takes the L2 posts as an optional third argument, only to read
 * each post's pipeline ER. Joined on the platform's `content_id`, the same key
 * `gold_post.py` builds `post_metric` from.
 */
export function creatorIntel(
  creator: KolDirectoryRow,
  measured: KolMeasured | null,
  goldPosts: GoldPost[] = [],
): CreatorIntel {
  if (!measured) {
    return {
      real: NONE,
      measured: null,
      kpi: EMPTY_KPI,
      performance: EMPTY_PERFORMANCE,
      content: EMPTY_CONTENT,
    }
  }

  /**
   * Defaulted rather than destructured bare. `measured` arrives over the wire
   * from `/api/…/kol-directory/[kolId]`, so a client holding a newer bundle than
   * the payload it was served — a hot reload mid-edit, a deploy landing between
   * the page load and the fetch — would otherwise read `.length` off `undefined`
   * and take the whole workspace down with it.
   */
  const totals = measured.totals ?? {}
  const averages = measured.averages ?? {}
  const formats = measured.formats ?? []
  const recent = measured.recent ?? []
  const rates = measured.rates ?? []
  const hashtags = measured.hashtags ?? []
  const platform = creator.platform ?? 'instagram'

  const erByContent = new Map(
    goldPosts.map(g => [`${g.platform}:${g.contentId}`, g.erFollowers] as const))
  const items = recent.map(p => toItem(
    p, platform,
    p.contentId ? erByContent.get(`${platform}:${p.contentId}`) ?? null : null,
  ))

  return {
    measured,
    real: {
      likes: totals.likes != null,
      comments: totals.comments != null,
      views: totals.views != null,
      // False for everybody; see `RealFlags.reach`.
      reach: totals.reach != null,
      shares: totals.shares != null,
      saves: totals.saved != null,
      formats: formats.length > 0,
      content: items.length > 0,
      rates: rates.length > 0,
      hashtags: hashtags.length > 0,
    },
    kpi: {
      // L2 only, and the L1 average is deliberately NOT a fallback behind it.
      // `measured.averages.views` divides total views by EVERY harvested post,
      // including the ones with no view count (Instagram reports views for
      // video only). `l2_gold.kol_profile_card.avg_views` divides by
      // `views_analyzed_count`, which is how this metric is defined.
      avgViews: creator.avgViews ?? null,
      avgLikes: averages.likes ?? null,
      avgComments: averages.comments ?? null,
      avgReach: null,
    },
    performance: {
      likes: totals.likes ?? null,
      comments: totals.comments ?? null,
      views: totals.views ?? null,
      shares: totals.shares ?? null,
      saves: totals.saved ?? null,
      reach: null,
      impressions: null,
    },
    content: {
      recent: items,
      // Ordered by views, and only over the posts that carry one — sorting an
      // unmeasured post to the bottom would read as "this post did badly".
      top: items.filter(i => i.views !== null)
        .sort((a, b) => (b.views as number) - (a.views as number))
        .slice(0, 3),
      formats,
      hashtags,
      postsPer30d: postsPer30d(measured),
    },
  }
}
