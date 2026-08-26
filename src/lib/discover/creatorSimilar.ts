import { listKolDirectory } from './kolDirectory'
import { getCreator, listCreators } from './creatorStore'
import type { CreatorProfile } from './creatorFlow'

/**
 * Smart Discovery — "find me more creators like this one".
 *
 * Filter-based discovery answers "who matches these numbers". This answers a
 * different question: *this* creator works for us, who else is like them. The
 * reference does the work a filter form would otherwise ask the user to do by
 * hand — read a creator's category, tier, engagement and topics, then go looking
 * for those values one control at a time.
 *
 * Two things make the result usable rather than magical:
 *
 *   1. **Every rule is named.** A recommendation carries the reasons it earned,
 *      in the words of the rule that fired ("Same category: Beauty", "Similar
 *      audience size — 42K against 38K"). A ranked list with no reasons is a
 *      number nobody can argue with, which is worse than no list.
 *   2. **A rule that cannot be judged is dropped from both sides of the score.**
 *      If neither creator has a measured engagement rate, the engagement rule
 *      does not quietly score zero — it is excluded from the denominator too, so
 *      a creator is never penalised for data we failed to collect.
 *
 * Candidates come from both rosters: the org's own creators (which have content
 * characteristics, so topic overlap can be scored) and the commercial KOL
 * directory (which has rate cards, so price constraints can be). The KOL
 * database sits on a private network and is not always reachable — when it is
 * not, the result says so rather than silently returning half the field.
 */

export type CandidateSource = 'creator' | 'roster'

export interface SimilarReference {
  id: string
  source: CandidateSource
  username: string
  displayName: string | null
  avatarUrl: string | null
  platform: string | null
  categories: string[]
  city: string | null
  followers: number | null
  erPct: number | null
  tier: string | null
  profileUrl: string | null
  /** Recurring hashtags, when the reference is a profiled creator of this org. */
  hashtags: string[]
  /** Cheapest priced deliverable in IDR, when the reference is a roster creator. */
  rateFrom: number | null
}

export interface SimilarCandidate extends SimilarReference {
  /** 0-100, over the rules that could actually be judged for this pair. */
  match: number
  /**
   * How much evidence that percentage rests on: rules judged, out of the rules
   * there are. It matters as much as the number itself — a creator matching on
   * three signals because the other four had no data to read is not the same
   * find as one matching on six, and a bare "100%" cannot tell them apart.
   */
  signals: { judged: number; total: number }
  reasons: string[]
}

export interface SimilarConstraints {
  /** Restrict to one platform. Defaults to the reference's own. */
  platform?: string | null
  /** Only creators in this city (roster creators carry a city; org ones may not). */
  city?: string | null
  /** Only this follower tier. */
  tier?: string | null
  /** Only creators whose cheapest deliverable is at or under this, in IDR. */
  maxRate?: number | null
  /** Only creators whose rate card starts below the reference's. */
  cheaperThanReference?: boolean
  limit?: number
}

export interface SimilarResult {
  reference: SimilarReference
  candidates: SimilarCandidate[]
  /** What was skipped, narrowed or unavailable — shown under the results. */
  notes: string[]
}

/* ── reference ────────────────────────────────────────────────────────────── */

function fromOrgCreator(c: CreatorProfile): SimilarReference {
  return {
    id: c.id,
    source: 'creator',
    username: c.username,
    displayName: c.displayName,
    avatarUrl: c.avatarUrl,
    platform: c.platform,
    categories: c.category ? [c.category] : [],
    city: c.city,
    followers: c.followers,
    erPct: c.erPct,
    tier: c.tier,
    profileUrl: c.profileUrl,
    hashtags: (c.content?.hashtags ?? []).map(h => h.tag),
    rateFrom: null,
  }
}

async function loadReference(orgId: string, id: string, source: CandidateSource): Promise<SimilarReference | null> {
  if (source === 'creator') {
    const c = await getCreator(orgId, id)
    return c ? fromOrgCreator(c) : null
  }
  const { rows } = await listKolDirectory({ ids: [id] })
  const r = rows[0]
  if (!r) return null
  return {
    id: r.id,
    source: 'roster',
    username: r.username,
    displayName: null,
    avatarUrl: r.avatarUrl,
    platform: r.platform,
    categories: r.categories,
    city: r.city,
    followers: r.followers,
    erPct: r.erPct,
    tier: r.tier,
    profileUrl: r.profileUrl,
    hashtags: [],
    rateFrom: r.rateFrom,
  }
}

/* ── scoring ──────────────────────────────────────────────────────────────── */

interface Rule {
  key: string
  weight: number
  /**
   * `null` means the rule cannot be judged for this pair — neither side has the
   * data. It is then dropped from the denominator as well, which is what keeps a
   * missing measurement from reading as a bad match.
   */
  score: (ref: SimilarReference, c: SimilarReference) => { fraction: number; reason: string | null } | null
}

const near = (a: number, b: number) => (a === 0 && b === 0 ? 1 : Math.min(a, b) / Math.max(a, b))

/**
 * Two category vocabularies, reconciled.
 *
 * Intake labels a creator from a fixed list (`Tech`, `Entertainment`,
 * `Parenting`, …). The commercial roster labels its own with words nobody here
 * chose — `Humor`, `Foodies`, `Moms`, `Automotive and motorsports`. Comparing
 * those as strings makes a comedy creator and a `Humor` creator strangers, which
 * is the opposite of what a similarity search is for.
 *
 * So each label is reduced to a key first. Anything not listed keeps its own
 * lower-cased name, which means an unknown label still matches an identical one
 * and never matches something it merely resembles.
 */
const CATEGORY_SYNONYMS: [string, string[]][] = [
  ['entertainment', ['entertainment', 'humor', 'comedy', 'hiburan', 'komedi']],
  ['food', ['food', 'foodies', 'cooking', 'kuliner', 'culinary', 'chef', 'baking']],
  ['parenting', ['parenting', 'moms', 'mom', 'mother', 'family', 'keluarga', 'kids']],
  ['tech', ['tech', 'technology', 'gadget', 'digital']],
  ['gaming', ['gaming', 'gamer', 'esport', 'games']],
  ['beauty', ['beauty', 'skincare', 'makeup', 'kecantikan', 'hair']],
  ['fashion', ['fashion', 'style', 'ootd', 'streetwear', 'hijab']],
  ['fitness', ['fitness', 'gym', 'workout', 'health', 'wellness']],
  ['sports', ['sports', 'sport', 'football', 'basketball', 'olahraga']],
  ['travel', ['travel', 'traveling', 'wisata', 'adventure']],
  ['automotive', ['automotive', 'motorsports', 'otomotif', 'car', 'motorcycle']],
  ['finance', ['finance', 'investing', 'investasi', 'business', 'bisnis', 'crypto']],
  ['education', ['education', 'edukasi', 'learning', 'study', 'science']],
  ['music', ['music', 'musik', 'singer', 'dj']],
  ['home', ['home decor', 'home', 'interior', 'rumah', 'garden']],
  ['lifestyle', ['lifestyle', 'daily', 'vlog', 'gen z', 'millennial']],
]

function categoryKey(name: string): string {
  const value = name.trim().toLowerCase()
  for (const [key, words] of CATEGORY_SYNONYMS) {
    if (words.some(w => value === w || value.includes(w))) return key
  }
  return value
}

const RULES: Rule[] = [
  {
    key: 'category',
    weight: 32,
    score: (ref, c) => {
      if (!ref.categories.length || !c.categories.length) return null
      const refKeys = new Set(ref.categories.map(categoryKey))
      const shared = c.categories.filter(x => refKeys.has(categoryKey(x)))
      return shared.length
        ? {
            fraction: 1,
            // The candidate's own label, not ours: "Same category: Humor" is
            // checkable against the roster; "Same category: Entertainment"
            // would be a word the roster never used.
            reason: `Same category: ${shared.join(', ')}`,
          }
        : { fraction: 0, reason: null }
    },
  },
  {
    key: 'audience',
    weight: 24,
    score: (ref, c) => {
      if (ref.followers === null || c.followers === null) return null
      const ratio = near(ref.followers, c.followers)
      // Half the reference's audience or double it is still the same buy; an
      // order of magnitude apart is not.
      const fraction = ratio >= 0.5 ? 1 : ratio >= 0.2 ? 0.6 : ratio >= 0.1 ? 0.25 : 0
      return {
        fraction,
        reason: fraction >= 0.6
          ? `Similar audience size — ${fmt(c.followers)} against ${fmt(ref.followers)}`
          : null,
      }
    },
  },
  {
    key: 'tier',
    weight: 10,
    score: (ref, c) => {
      if (!ref.tier || !c.tier) return null
      return ref.tier === c.tier
        ? { fraction: 1, reason: `Same tier: ${c.tier}` }
        : { fraction: 0, reason: null }
    },
  },
  {
    key: 'engagement',
    weight: 20,
    score: (ref, c) => {
      if (ref.erPct === null || c.erPct === null) return null
      const ratio = near(ref.erPct, c.erPct)
      const fraction = ratio >= 0.75 ? 1 : ratio >= 0.5 ? 0.6 : ratio >= 0.3 ? 0.25 : 0
      return {
        fraction,
        reason: fraction >= 0.6
          ? `Similar engagement pattern — ${c.erPct.toFixed(2)}% against ${ref.erPct.toFixed(2)}%`
          : c.erPct > ref.erPct
            ? `Higher engagement rate — ${c.erPct.toFixed(2)}% against ${ref.erPct.toFixed(2)}%`
            : null,
      }
    },
  },
  {
    key: 'topics',
    weight: 14,
    score: (ref, c) => {
      // Only two profiled creators of this org can be compared this way; the
      // commercial roster carries no post history, so the rule abstains rather
      // than scoring every roster creator zero for topic overlap.
      if (!ref.hashtags.length || !c.hashtags.length) return null
      const shared = c.hashtags.filter(t => ref.hashtags.includes(t))
      const fraction = Math.min(shared.length / 3, 1)
      return {
        fraction,
        reason: shared.length ? `Shares ${shared.length} recurring topic${shared.length > 1 ? 's' : ''}: ${shared.slice(0, 3).join(' ')}` : null,
      }
    },
  },
  {
    key: 'platform',
    weight: 8,
    score: (ref, c) => {
      if (!ref.platform || !c.platform) return null
      return ref.platform === c.platform
        ? { fraction: 1, reason: null }
        : { fraction: 0, reason: null }
    },
  },
  {
    key: 'location',
    weight: 6,
    score: (ref, c) => {
      if (!ref.city || !c.city) return null
      return ref.city.toLowerCase() === c.city.toLowerCase()
        ? { fraction: 1, reason: `Same location: ${c.city}` }
        : { fraction: 0, reason: null }
    },
  },
]

/**
 * How far a candidate's audience is from the reference's, as a ratio distance
 * so 10x larger and 10x smaller are equally far. Unknown counts sort last.
 */
function sizeDistance(ref: SimilarReference, c: SimilarReference): number {
  if (!ref.followers || !c.followers) return Number.POSITIVE_INFINITY
  return Math.abs(Math.log(c.followers / ref.followers))
}

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    : n >= 1_000 ? `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
    : String(n)

function scoreCandidate(
  ref: SimilarReference, c: SimilarReference,
): { match: number; signals: { judged: number; total: number }; reasons: string[] } {
  let earned = 0
  let possible = 0
  let judged = 0
  const reasons: string[] = []

  for (const rule of RULES) {
    const outcome = rule.score(ref, c)
    if (!outcome) continue
    judged += 1
    possible += rule.weight
    earned += rule.weight * outcome.fraction
    if (outcome.reason) reasons.push(outcome.reason)
  }

  // Price is not one of the similarity rules — it is a reason to prefer a
  // candidate, not evidence they resemble the reference — so it is added to the
  // reasons without moving the match score.
  if (ref.rateFrom !== null && c.rateFrom !== null && c.rateFrom < ref.rateFrom) {
    const saving = Math.round(((ref.rateFrom - c.rateFrom) / ref.rateFrom) * 100)
    reasons.push(`Rate card starts ${saving}% lower — IDR ${c.rateFrom.toLocaleString('id-ID')} against ${ref.rateFrom.toLocaleString('id-ID')}`)
  } else if (ref.rateFrom === null && c.rateFrom !== null) {
    reasons.push(`Rate card starts at IDR ${c.rateFrom.toLocaleString('id-ID')}`)
  }

  return {
    match: possible > 0 ? Math.round((earned / possible) * 100) : 0,
    signals: { judged, total: RULES.length },
    reasons,
  }
}

/* ── search ───────────────────────────────────────────────────────────────── */

export async function findSimilarCreators(
  orgId: string, referenceId: string, source: CandidateSource, constraints: SimilarConstraints = {},
): Promise<SimilarResult | null> {
  const reference = await loadReference(orgId, referenceId, source)
  if (!reference) return null

  const notes: string[] = []
  const platform = constraints.platform ?? reference.platform ?? null
  const limit = Math.min(Math.max(constraints.limit ?? 12, 1), 40)

  /**
   * A price ceiling from the reference's own rate card.
   *
   * "Lower estimated price" is only answerable for creators that have a rate
   * card at all, which today means the commercial roster. When the reference has
   * no rate card of its own there is nothing to be cheaper *than*, and the
   * constraint is dropped with a note instead of being applied against a number
   * we invented.
   */
  let maxRate = constraints.maxRate ?? null
  if (constraints.cheaperThanReference) {
    if (reference.rateFrom !== null) {
      maxRate = maxRate === null ? reference.rateFrom - 1 : Math.min(maxRate, reference.rateFrom - 1)
    } else {
      notes.push('The reference creator has no rate card, so "lower price" could not be applied — nothing to compare a price against.')
    }
  }

  /* Own roster. */
  const own = (await listCreators(orgId, {
    platform,
    tier: constraints.tier ?? null,
    status: 'ready',
  }))
    .filter(c => c.id !== reference.id)
    .filter(c => !constraints.city || (c.city ?? '').toLowerCase() === constraints.city.toLowerCase())

  // Content characteristics live on the full profile, not the summary, and topic
  // overlap needs them. Fetched only for the org's own creators, which is a
  // small list — the roster has no post history to fetch.
  const ownDetailed = await Promise.all(own.map(c => getCreator(orgId, c.id)))
  const ownCandidates: SimilarReference[] = ownDetailed
    .filter((c): c is CreatorProfile => !!c)
    .map(fromOrgCreator)

  /* Commercial roster. */
  let rosterCandidates: SimilarReference[] = []
  try {
    /**
     * Ask for the reference's own neighbourhood, not the top of the roster.
     *
     * `LIMIT 60` has to fall somewhere, and sorting by followers descending puts
     * it on the sixty largest accounts on the platform — so a 42K creator was
     * being compared against creators with fourteen million followers, none of
     * which is a similar creator by any reading. Asking for everyone above half
     * the reference's size, ascending, lands the window on the band the
     * reference actually sits in.
     */
    const ask = (category: string | null) => listKolDirectory({
      platform,
      // The category narrows 7.7k rows to something the scorer can rank without
      // reading the whole roster. Absent when the reference has no category —
      // then the follower band does the narrowing on its own.
      category,
      tiers: constraints.tier ? [constraints.tier] : [],
      minFollowers: reference.followers ? Math.round(reference.followers * 0.5) : null,
      maxRate,
      pageSize: 60,
      sort: 'followers',
      dir: reference.followers ? 'asc' : 'desc',
    })

    /**
     * Narrow by category, but never let it be the reason nothing comes back.
     *
     * The roster names its categories in its own words, so a creator we filed
     * under `Tech` matches no roster row at all — and the search would return an
     * empty list that reads as "no similar creators exist" rather than "your
     * label is not one of theirs". When the narrow ask finds nothing, the same
     * query runs without the category and the scorer ranks what platform and
     * audience size return.
     */
    let rows = (await ask(reference.categories[0] ?? null)).rows
    if (!rows.length && reference.categories.length) {
      rows = (await ask(null)).rows
      if (rows.length) {
        notes.push(
          `No creator in the database carries the category "${reference.categories[0]}", so the comparison used platform, audience size and engagement instead.`,
        )
      }
    }

    rosterCandidates = rows
      .filter(r => r.id !== reference.id)
      .filter(r => !constraints.city || (r.city ?? '').toLowerCase() === constraints.city.toLowerCase())
      .map(r => ({
        id: r.id,
        source: 'roster' as const,
        username: r.username,
        displayName: null,
        avatarUrl: r.avatarUrl,
        platform: r.platform,
        categories: r.categories,
        city: r.city,
        followers: r.followers,
        erPct: r.erPct,
        tier: r.tier,
        profileUrl: r.profileUrl,
        hashtags: [],
        rateFrom: r.rateFrom,
      }))
  } catch (err) {
    // The KOL database is on a private network and is unreachable from some
    // environments. Saying so is the difference between "no similar creators
    // exist" and "we could not look at most of them".
    notes.push(
      'The commercial KOL roster could not be reached, so only creators in your own database were compared.',
    )
    console.warn('[creator similar] roster unavailable:', err instanceof Error ? err.message : err)
  }

  if (!ownCandidates.length && !rosterCandidates.length) {
    notes.push('There is nothing to compare against yet — add and profile more creators, or loosen the constraints.')
  }

  const candidates = [...ownCandidates, ...rosterCandidates]
    .map(c => ({ ...c, ...scoreCandidate(reference, c) }))
    // A candidate scoring under a third of the judgeable rules is not a
    // recommendation, it is padding.
    .filter(c => c.match >= 34)
    // Ties break towards the closest audience size, not the largest. Two
    // creators matching equally well are not equally useful when one has twenty
    // times the reference's following and the budget to match.
    .sort((a, b) =>
      b.match - a.match
      // More evidence wins a tie: an 80% read from six signals is a better
      // recommendation than an 80% read from three.
      || b.signals.judged - a.signals.judged
      || sizeDistance(reference, a) - sizeDistance(reference, b))
    .slice(0, limit)

  if (!candidates.length && (ownCandidates.length || rosterCandidates.length)) {
    notes.push(
      `${ownCandidates.length + rosterCandidates.length} creators were compared, but none matched closely enough to recommend.`,
    )
  }

  return { reference, candidates, notes }
}
