/**
 * The intake flow's shared vocabulary and payload shapes.
 *
 * Client-safe, for the same reason `vocab.ts` is: the Add Account modal and the
 * profiling screen draw the step lists and read every field named here, so none
 * of it may sit in a module that imports the pg pool or the Apify client. The
 * server modules (`creatorIntake.ts`, `creatorStore.ts`, `creatorProfiling.ts`)
 * import their types from here and produce these shapes.
 *
 * The two step lists are the flow's contract with its own UI. They are declared
 * once, here, rather than written out again in the components, so a step cannot
 * be drawn in the modal without something on the server actually performing it —
 * which is the whole difference between a progress bar and an animation.
 */

import type { CreatorPlatform } from './creatorInput'

/* ── steps ────────────────────────────────────────────────────────────────── */

export type StepState = 'pending' | 'running' | 'done' | 'skipped' | 'failed'

export interface FlowStep {
  key: string
  label: string
  state: StepState
  /** What this step actually found, in one line. Shown under the label. */
  detail?: string | null
  /** ISO timestamp of when the step settled. */
  at?: string | null
}

/** The five checks `checkCreatorAccount` runs, in the order it runs them. */
export const VALIDATION_STEPS = [
  { key: 'url', label: 'Checking profile URL' },
  { key: 'account', label: 'Validating account' },
  { key: 'access', label: 'Checking account accessibility' },
  { key: 'visibility', label: 'Detecting account visibility' },
  { key: 'database', label: 'Checking existing database records' },
] as const

/**
 * The seven stages of `profileCreator`, in the order it runs them.
 *
 * Collecting the posts and reading them used to be one step called `content`,
 * which made the longest part of a run a single line that sat on "Analyzing
 * content" for a minute — the fetch and the analysis fail for different reasons
 * and take very different times, and rolling them together meant a run stalled
 * on the network looked identical to one stalled on the maths.
 *
 * The collection half is the *new* key. Splitting it the other way round —
 * keeping `content` for the fetch and adding a key for the analysis — would
 * have re-pointed the key every finished run already carries, and those runs
 * would render their analysis line as a step that never ran.
 */
export const PROFILING_STEPS = [
  { key: 'profile', label: 'Collecting profile information' },
  { key: 'stats', label: 'Fetching account statistics' },
  { key: 'collect', label: 'Collecting available content data' },
  { key: 'content', label: 'Analyzing content characteristics' },
  { key: 'category', label: 'Identifying creator category and niche' },
  { key: 'generate', label: 'Building creator profile' },
  { key: 'save', label: 'Saving creator to database' },
] as const

export const PROFILING_STEP_COUNT = PROFILING_STEPS.length

/* ── the creator ──────────────────────────────────────────────────────────── */

export type CreatorVisibility = 'public' | 'private' | 'unknown'
export type ProfilingStatus = 'queued' | 'running' | 'ready' | 'failed'

/** What the sampled posts looked like. Every field is null until measured. */
export interface CreatorContent {
  /** How many posts the numbers below are computed from. */
  postsAnalyzed: number
  /** The look-back window, in days. */
  windowDays: number
  /** Post formats by share of the sample, largest first. */
  formats: { label: string; count: number; share: number }[]
  /** Recurring hashtags, most used first. */
  hashtags: { tag: string; count: number }[]
  /** Posts per week over the window, null when the sample is too thin to say. */
  postsPerWeek: number | null
  /** Local hour the creator posts most often (0-23), null when unknown. */
  peakHour: number | null
  topPosts: {
    url: string | null
    caption: string | null
    likes: number | null
    comments: number | null
    views: number | null
    date: string | null
  }[]
}

export interface CreatorSummary {
  id: string
  platform: CreatorPlatform
  username: string
  profileUrl: string | null
  displayName: string | null
  avatarUrl: string | null
  visibility: CreatorVisibility
  verified: boolean
  category: string | null
  city: string | null
  followers: number | null
  /** Percentage points, e.g. 3.25 means 3.25%. Null when never measured. */
  erPct: number | null
  tier: string | null
  profilingStatus: ProfilingStatus
  profilingError: string | null
  monitoringEnabled: boolean
  lastRefreshedAt: string | null
  createdAt: string
}

export interface CreatorProfile extends CreatorSummary {
  bio: string | null
  following: number | null
  postsCount: number | null
  avgLikes: number | null
  avgComments: number | null
  avgViews: number | null
  content: CreatorContent | null
  /** The most recent profiling attempt, initial or refresh. */
  run: CreatorRun | null
  /** Follower and engagement history, oldest first. One point per day. */
  history: CreatorSnapshot[]
}

export interface CreatorRun {
  id: number
  kind: 'initial' | 'refresh'
  status: 'running' | 'done' | 'failed'
  /** How many of the seven steps have settled. */
  step: number
  steps: FlowStep[]
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export interface CreatorSnapshot {
  capturedOn: string
  followers: number | null
  following: number | null
  postsCount: number | null
  erPct: number | null
  avgLikes: number | null
  avgComments: number | null
}

/* ── validation result ────────────────────────────────────────────────────── */

/**
 * Whatever the platform told us about the account, before anything is stored.
 *
 * Every field is optional because the three platforms answer with different
 * amounts: Instagram returns the whole profile, Facebook returns a page, and
 * TikTok's public oEmbed carries a display name and an avatar and nothing else.
 * Filling the gaps with zeroes would make a thin answer look like a measured one.
 */
export interface AccountPreview {
  platform: CreatorPlatform
  username: string
  profileUrl: string
  displayName?: string | null
  avatarUrl?: string | null
  bio?: string | null
  followers?: number | null
  following?: number | null
  postsCount?: number | null
  verified?: boolean
  visibility: CreatorVisibility
}

/** A creator this org already has, matched by handle. */
export interface ExistingCreatorRef {
  id: string
  username: string
  platform: CreatorPlatform
  displayName: string | null
  avatarUrl: string | null
  followers: number | null
  erPct: number | null
  category: string | null
  profilingStatus: ProfilingStatus
  lastRefreshedAt: string | null
}

/** The same handle sitting in one of the two rosters this app does not own. */
export interface KnownElsewhere {
  /** `roster` is the commercial KOL directory; `tracked` is a brand or competitor account. */
  source: 'roster' | 'tracked'
  label: string
  /** Where to look at it, when the surface for it exists. */
  href?: string | null
}

/**
 * The outcome of Check Account. One state per screen the modal can show.
 *
 * `unverified` is deliberately its own state rather than being folded into
 * `not_found`. Instagram and Facebook can only be checked through Apify, and an
 * Apify outage, a spent token or a timeout says nothing whatsoever about the
 * account — reporting "not found" there would tell the user their correct handle
 * is wrong, and the flow would go on to refuse a creator that exists.
 */
export type CheckResult =
  | { state: 'invalid_url'; message: string; suggestPlatform?: CreatorPlatform; steps: FlowStep[] }
  | { state: 'not_found'; message: string; steps: FlowStep[] }
  | { state: 'unverified'; message: string; account: AccountPreview; steps: FlowStep[] }
  | { state: 'private'; account: AccountPreview; steps: FlowStep[] }
  | { state: 'new'; account: AccountPreview; knownElsewhere: KnownElsewhere[]; steps: FlowStep[] }
  | { state: 'exists'; account: AccountPreview; existing: ExistingCreatorRef; steps: FlowStep[] }

/* ── formatting helpers the intake screens share ──────────────────────────── */

export const VISIBILITY_LABEL: Record<CreatorVisibility, string> = {
  public: 'Public account',
  private: 'Private account',
  unknown: 'Visibility unconfirmed',
}

/** "4 of 6 steps completed", from a run's settled-step count. */
export function progressLabel(step: number, total = PROFILING_STEP_COUNT): string {
  return `${Math.min(step, total)} of ${total} steps completed`
}
