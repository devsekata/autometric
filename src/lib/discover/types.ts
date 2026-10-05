/**
 * Shared types for the Discover module.
 *
 * Discover browses two post sources side by side — the org's own brand posts
 * (l1_silver.unified_post) and its tracked competitors' posts
 * (l1_silver.unified_competitor_post). The two tables carry different column
 * sets, so everything the UI renders is normalised into `DiscoverPost` at the
 * query layer and the components never branch on source except to label it.
 */

export type DiscoverSource = 'brand' | 'competitor'
export type DiscoverPlatform = 'instagram' | 'facebook' | 'tiktok'

/** Normalised format label. 'Post' is the fallback when neither source column maps. */
export type DiscoverFormat = 'Reel' | 'Carousel' | 'Image' | 'Video' | 'Post'

export const DISCOVER_FORMATS: DiscoverFormat[] = ['Reel', 'Carousel', 'Image', 'Video', 'Post']

/**
 * `best` / `worst` rank by engagement rate *relative to the account's own
 * median*, not by the raw rate. Sorting by raw ER just ranks accounts — a 3% post
 * is strong on one handle and weak on another — so the absolute ordering would
 * put every post from the liveliest account on page one and answer a different
 * question than "which of these worked".
 */
export type DiscoverSort = 'new' | 'old' | 'views' | 'likes' | 'er' | 'best' | 'worst'

export interface DiscoverPost {
  /** `${source}:${rowId}` — stable across the two id spaces, used as the React key. */
  key: string
  source: DiscoverSource
  rowId: number
  platform: DiscoverPlatform
  postDate: string
  /** Relative age in days, precomputed server-side so the grid needs no clock. */
  ageDays: number
  caption: string
  coverImage: string | null
  format: DiscoverFormat
  /** Only brand posts carry an editorial pillar; competitor posts are null. */
  pillar: string | null
  /** Account handle the post belongs to (own brand account or competitor). */
  author: string
  authorAvatar: string | null
  views: number
  likes: number
  comments: number
  shares: number
  /** Engagement rate as a percentage (2.4 = 2.4%), not a ratio. */
  erPct: number
  /** Boosted or campaign-tagged posts read as "Sponsored" in the UI. */
  sponsored: boolean
  saved: boolean
  /** Null for competitor rows, which are scraped and carry no reach of record. */
  reach: number | null
  saves: number | null
  /** Interactions of record; derived from the raw counts for competitor rows. */
  engagement: number
  isCampaign: boolean
  isBoosted: boolean
  /**
   * This post's engagement rate as a multiple of the median of its own account
   * — 2.1 means twice the account's typical post. Null when either side is
   * unmeasured, which is what the card checks before printing a verdict.
   */
  perfRatio: number | null
}

export interface DiscoverFilters {
  q: string
  format: DiscoverFormat | 'All'
  platform: DiscoverPlatform | 'all'
  pillar: string | 'all'
  /**
   * `sponsored` is the union of the two paid flags; `campaign` and `boosted`
   * split it, because they are different questions — a campaign post is a
   * deliverable of a brief, a boosted one is any post with spend behind it.
   */
  type: 'all' | 'organic' | 'sponsored' | 'campaign' | 'boosted'
  source: DiscoverSource | 'all'
  erMin: number
  likesMin: number
  viewsMin: number
  /** Age window in days; 'all' disables the filter. */
  days: number | 'all'
  /** Restrict to the org's saved Inspirations. Used by the campaign brief picker. */
  savedOnly?: boolean
  sort: DiscoverSort
  page: number
  pageSize: number
}

export const DEFAULT_DISCOVER_FILTERS: DiscoverFilters = {
  q: '', format: 'All', platform: 'all', pillar: 'all', type: 'all', source: 'all',
  erMin: 0, likesMin: 0, viewsMin: 0, days: 'all', sort: 'views', page: 1, pageSize: 24,
}

export interface DiscoverContentPayload {
  posts: DiscoverPost[]
  total: number
  /** Total before filters — powers the "N of M pieces" subtitle. */
  grandTotal: number
  /** Distinct pillars present in the org's data, for the Category filter. */
  pillars: string[]
  savedCount: number
  page: number
  pageSize: number
}

/* ── Directory (KOL Intelligence) ─────────────────────────────────────────── */

/**
 * The Directory's entity. autometric has no influencer/KOL table, so the
 * "creators" a user browses are the social accounts the org already tracks:
 * its own brand accounts plus every verified competitor. `relation`
 * distinguishes the two everywhere in the UI.
 */
export interface DirectoryAccount {
  id: string
  username: string
  avatarUrl: string | null
  profileUrl: string | null
  platform: DiscoverPlatform
  relation: 'owned' | 'competitor'
  brandId: string | null
  brandName: string | null
  postCount: number
  totalViews: number
  totalLikes: number
  totalComments: number
  avgErPct: number
  /** Most recent post date across the account, ISO date or null when it has none. */
  lastPostAt: string | null
}

export interface DirectoryPayload {
  accounts: DirectoryAccount[]
  platforms: DiscoverPlatform[]
}

/* ── the organization's relationship with a creator ───────────────────────── */

/**
 * Which database a Discovery creator's id belongs to: `roster` is the commercial
 * KOL database (`public.kol_directory`, a different Postgres server), `account`
 * is this database (`public.discover_creators`, the creators this org profiled
 * itself).
 *
 * The same two words `discover_favorites` stores as a column and
 * `useDiscoverSelection` encodes as a `roster:` key prefix. They live here
 * rather than beside the queries because both the client and the server reason
 * about them, and this module carries no server imports.
 */
export type LinkSource = 'account' | 'roster'

/**
 * Monitoring, as a closed set of three rather than a nullable flag. 'none' is a
 * creator that is not being watched — either never was, or was and was stopped;
 * the link row's `trackingStartedAt` is what tells those apart.
 */
export type TrackingStatus = 'none' | 'active' | 'paused'

export interface LinkRef {
  source: LinkSource
  /** The creator's id in whichever database `source` names. */
  id: string
}

/** One org's two decisions about one creator. See migration 053. */
export interface CreatorLink extends LinkRef {
  /** In My Creators. Always false for `account`, which is in it by construction. */
  inRoster: boolean
  rosterAddedAt: string | null
  tracking: TrackingStatus
  trackingStartedAt: string | null
  trackingChangedAt: string | null
  /** When the creator's numbers were last pulled; null until something has. */
  lastCheckedAt: string | null
  nextCheckAt: string | null
}

export interface LinkCounts {
  /** Creators adopted into My Creators from the Creator Database. */
  roster: number
  tracked: number
  paused: number
}

/**
 * A linked creator, flattened out of whichever database holds them.
 *
 * My Creators and Tracked Accounts both list creators from two id spaces at
 * once, so the two row shapes — `KolDirectoryRow` and `CreatorSummary` — are
 * normalised into this one at the API layer and the components never branch on
 * source except to label it. Same reasoning as `DiscoverPost` above.
 */
export interface LinkedCreator {
  /** `<uuid>` or `roster:<uuid>` — the key favourites and compare also use. */
  key: string
  source: LinkSource
  id: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  profileUrl: string | null
  platform: string | null
  categories: string[]
  city: string | null
  followers: number | null
  /** Percentage points, e.g. 3.25 means 3.25%. Null when never measured. */
  erPct: number | null
  tier: string | null
  /**
   * There is deliberately no verified/connected flag here. The two sources stopped
   * agreeing on what one would mean: the roster half no longer carries the
   * platform's blue tick at all (it now reports Business Connected, an OAuth
   * link), while an org's own creator record still carries `verified`. Nothing
   * rendered the merged field, so it is gone rather than ambiguous — add a
   * source-specific one if a screen ever needs to show it.
   */
  /** When the creator's own numbers were last collected, from their record. */
  lastRefreshedAt: string | null
  link: CreatorLink
}
