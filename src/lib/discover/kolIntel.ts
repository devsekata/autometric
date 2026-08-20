import type { KolDirectoryRow } from './kolDirectory'
import type { KolMeasured } from './kolMeasured'
import { sampleIntel, type SampleContentItem, type SampleIntel } from './kolSample'

/**
 * One creator's intelligence, measured where the warehouse can measure it and
 * estimated everywhere else.
 *
 * `@/lib/discover/kolSample` used to be the whole answer: the roster carried
 * identity only, so every figure past follower count and engagement rate was
 * generated. That is no longer true — `l1_silver.unified_post` and
 * `l1_silver.unified_rate_card` hold real numbers for part of the roster (see
 * `@/lib/discover/kolMeasured`). This module is the seam between the two.
 *
 * It works as an overlay rather than a replacement, and that is the important
 * part. The sample generator still runs first and fills the whole shape, so no
 * screen can end up with a hole in it; measured values are then written over the
 * fields they cover. A creator with ten harvested posts gets real likes, real
 * views, real formats and their real content grid, while their audience
 * breakdown and campaign history stay estimated — because those tables are
 * empty for everyone.
 *
 * `real` is what the UI reads to decide whether to print the estimate marker.
 * It is deliberately per-field and not per-section: within Performance, likes
 * and views are measured while reach and saves are not, and one marker over the
 * whole card would either overclaim or underclaim.
 */

/** Which figures on this creator came from a measurement rather than a model. */
export interface RealFlags {
  likes: boolean
  comments: boolean
  views: boolean
  reach: boolean
  shares: boolean
  saves: boolean
  /** The format mix under Content, and the "strongest format" line on Profile. */
  formats: boolean
  /** The recent/top content grids. */
  content: boolean
  /** The creator's prices, from the KOL platform's own rate card. */
  rates: boolean
  /** Tags counted from the harvested posts, not a written-in list. */
  hashtags: boolean
}

export interface CreatorIntel extends SampleIntel {
  real: RealFlags
  /** Passed through so components can show the basis ("dari 10 post"). */
  measured: KolMeasured | null
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

const NONE: RealFlags = {
  likes: false, comments: false, views: false,
  reach: false, shares: false, saves: false,
  formats: false, content: false, rates: false, hashtags: false,
}

/**
 * Turns a measured post into the shape the content grids already render.
 *
 * The fields the warehouse cannot fill — shares, saves, per-post engagement rate
 * and sentiment — keep the sampled values they would have had, rather than
 * becoming zero. A zero would be a claim; the estimate marker beside them is the
 * truth. `fallback` is the sampled item this one displaces, which is what those
 * fields are taken from.
 */
function measuredItem(
  post: KolMeasured['recent'][number],
  fallback: SampleContentItem,
  platform: string,
): SampleContentItem {
  const caption = post.caption?.trim() ?? ''
  return {
    ...fallback,
    // A caption is the only title these posts have; the first line of it reads
    // as a headline, and the full text stays in `caption` for the overlay.
    title: caption ? caption.split('\n')[0].slice(0, 80) : `Post ${post.format}`,
    caption: caption || fallback.caption,
    format: post.format,
    // Only override when the post actually carries tags: 143 of the 221
    // harvested posts have none, and an empty row would read as "we looked and
    // this post used no tags" when the harvest simply did not capture them.
    hashtags: post.hashtags.length ? post.hashtags.map(t => `#${t}`) : fallback.hashtags,
    views: post.views ?? fallback.views,
    likes: post.likes ?? fallback.likes,
    comments: post.comments ?? fallback.comments,
    postedAt: post.date ?? fallback.postedAt,
    platform,
    measured: true,
    permalink: post.permalink,
    coverImage: post.coverImage,
    // Only these two are real on a measured item; the rest stay estimated.
    measuredFields: [
      ...(post.views !== null ? ['views'] : []),
      ...(post.likes !== null ? ['likes'] : []),
      ...(post.comments !== null ? ['comments'] : []),
    ],
  }
}

export function creatorIntel(
  creator: KolDirectoryRow,
  measured: KolMeasured | null,
): CreatorIntel {
  const base = sampleIntel(creator)
  if (!measured) return { ...base, real: NONE, measured: null }

  /**
   * Defaulted rather than destructured bare. `measured` arrives over the wire
   * from `/api/…/kol-directory/[kolId]`, so a client holding a newer bundle than
   * the payload it was served — a hot reload mid-edit, a deploy landing between
   * the page load and the fetch — would otherwise read `.length` off `undefined`
   * and take the whole workspace down with it. `KolDirectoryPage.statusOf`
   * guards the same class of failure for the same reason.
   */
  const totals = measured.totals ?? {}
  const averages = measured.averages ?? {}
  const formats = measured.formats ?? []
  const recent = measured.recent ?? []
  const rates = measured.rates ?? []
  const hashtags = measured.hashtags ?? []
  const platform = creator.platform ?? 'instagram'

  const real: RealFlags = {
    likes: totals.likes != null,
    comments: totals.comments != null,
    views: totals.views != null,
    reach: totals.reach != null,
    shares: totals.shares != null,
    saves: totals.saved != null,
    formats: formats.length > 0,
    content: recent.length > 0,
    rates: rates.length > 0,
    hashtags: hashtags.length > 0,
  }

  const items = recent.map((p, i) =>
    measuredItem(p, base.content.recent[i] ?? base.content.recent[0], platform))

  return {
    ...base,
    real,
    measured,
    kpi: {
      ...base.kpi,
      avgViews: averages.views ?? base.kpi.avgViews,
      // Reach is never harvested, so it stays modelled — and stays marked.
      avgReach: base.kpi.avgReach,
    },
    performance: {
      ...base.performance,
      likes: totals.likes ?? base.performance.likes,
      comments: totals.comments ?? base.performance.comments,
      shares: totals.shares ?? base.performance.shares,
      saves: totals.saved ?? base.performance.saves,
    },
    content: {
      ...base.content,
      formats: formats.length
        ? formats.map(f => ({ label: f.label, pct: f.pct }))
        : base.content.formats,
      recent: items.length ? items : base.content.recent,
      // "Top" is the same posts ordered by reach-of-record; with only ten of
      // them, sorting the real set beats showing a modelled one.
      top: items.length
        ? [...items].sort((a, b) => b.views - a.views).slice(0, base.content.top.length)
        : base.content.top,
    },
  }
}
