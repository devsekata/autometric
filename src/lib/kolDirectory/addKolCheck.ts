import kolDb from '@/lib/kolDb'
import { apifyItemError, fetchTiktokPosts, type ApifyTiktokAuthorMeta } from '@/lib/apify/client'
import { parseCreatorInput, platformOfUrl } from '@/lib/discover/creatorInput'
import { fetchIgProfileRaw } from './apifyKolActors'

/**
 * "Add New KOL" — step one: can this handle even be added?
 *
 * Three questions, in order: is the input parseable at all, is the account
 * already in the commercial roster (`public.kol_directory`), and if not, does
 * the platform actually serve a profile at that handle. The third question is
 * the expensive one (an Apify run), so it only runs once the first two have
 * ruled themselves out.
 */

export type AddKolPlatform = 'instagram' | 'tiktok'

export type CheckKolResult =
  | { state: 'invalid_input'; message: string }
  | {
      state: 'already_in_directory'
      kol: { id: string; username: string; scrapeStatus: string | null; followersCount: number | null; lastRefreshedAt: string | null }
    }
  | { state: 'not_found'; message: string }
  | { state: 'unverified'; message: string }
  | {
      state: 'new'
      account: {
        platform: AddKolPlatform
        username: string
        profileUrl: string
        displayName: string | null
        avatarUrl: string | null
        bio: string | null
        followers: number | null
        raw: unknown
        /**
         * Set when this handle already has a `kol_directory` row (and,
         * separately, a `kol_social_account`/`social_account` row) but has
         * never been scraped through to follower data — see
         * `findInDirectory`. When present, the scrape step must reuse these
         * ids instead of inserting fresh identity rows, or the roster forks
         * into a duplicate for the same KOL.
         */
        existingKolDirectoryId?: string | null
        existingSocialAccountId?: string | null
      }
    }

const numOrNull = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Row shape of the two roster columns this check reads. Kept local — this is
 * the only caller — rather than exported from `@/lib/discover/kolDirectory`,
 * which owns the read model for the Directory page, not for this pipeline.
 */
interface RosterHit {
  id: string
  username: string
  scrape_status: string | null
  followers_count: number | null
  last_refreshed_at: Date | string | null
  /** `kol_social_account.social_account_id`, if that link already exists. */
  social_account_id: string | null
}

/**
 * "Sudah pernah narik data" is defined by the presence of follower-table
 * rows, not by `kol_directory.scrape_status` — the TikTok leg of the old
 * Python pipeline (`scrapper-project`) never populates that column at all,
 * even for accounts scraped all the way through. A KOL is only complete once
 * it has a row in the platform's `l0_raw.*_followers_apify` table for its
 * `social_account_id`.
 */
async function hasFollowerData(platform: AddKolPlatform, socialAccountId: string | null): Promise<boolean> {
  if (!socialAccountId) return false
  const table = platform === 'instagram' ? 'l0_raw.ig_followers_apify' : 'l0_raw.tt_followers_apify'
  const { rows } = await kolDb().query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ${table} WHERE social_account_id = $1) AS exists`,
    [socialAccountId],
  )
  return rows[0]?.exists ?? false
}

async function findInDirectory(
  platform: AddKolPlatform, usernameNormalized: string,
): Promise<(RosterHit & { hasFollowerData: boolean }) | null> {
  const { rows } = await kolDb().query<RosterHit>(
    `SELECT kd.id, kd.username, kd.scrape_status, kd.followers_count, kd.last_refreshed_at,
            ksa.social_account_id
       FROM public.kol_directory kd
       JOIN public.platforms pl ON pl.id = kd.platform_id
       LEFT JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
      WHERE pl.key = $1
        AND LOWER(kd.username_normalized) = LOWER($2)
      LIMIT 1`,
    [platform, usernameNormalized],
  )
  const hit = rows[0]
  if (!hit) return null
  const complete = await hasFollowerData(platform, hit.social_account_id)
  return { ...hit, hasFollowerData: complete }
}

async function checkInstagram(username: string, profileUrl: string): Promise<CheckKolResult> {
  let profile: Record<string, unknown> | null
  try {
    profile = await fetchIgProfileRaw(username)
  } catch (err) {
    console.error(`[addKolCheck] Instagram profile fetch failed for @${username}:`, err)
    return {
      state: 'unverified',
      message: `We could not verify @${username} on Instagram right now. This looks like a temporary problem — try again shortly.`,
    }
  }

  const err = apifyItemError(profile)
  if (err) {
    if (err.gone) {
      return {
        state: 'not_found',
        message: `Instagram username not available: @${username} does not exist or is not reachable (${err.description || err.code}).`,
      }
    }
    return {
      state: 'unverified',
      message: `Instagram returned an unexpected error for @${username} (${err.description || err.code}). This looks temporary — try again shortly.`,
    }
  }

  if (!profile || (profile.id === undefined && profile.followersCount === undefined)) {
    return {
      state: 'not_found',
      message: `Instagram username not available: @${username} did not return a profile.`,
    }
  }

  return {
    state: 'new',
    account: {
      platform: 'instagram',
      username,
      profileUrl,
      displayName: (profile.fullName as string | undefined) ?? null,
      avatarUrl: (profile.profilePicUrlHD as string | undefined) ?? (profile.profilePicUrl as string | undefined) ?? null,
      bio: (profile.biography as string | undefined) ?? null,
      followers: numOrNull(profile.followersCount),
      raw: profile,
    },
  }
}

async function checkTiktok(username: string, profileUrl: string): Promise<CheckKolResult> {
  // TikTok has no standalone profile actor in this pipeline (mirrors Discover's
  // `creatorProfiling.ts`): one `clockworks/tiktok-scraper` run returns posts
  // with `authorMeta` embedded, which carries the profile too. `days = null`
  // asks for the latest posts regardless of date, so a creator with nothing
  // posted recently still resolves.
  let posts: Awaited<ReturnType<typeof fetchTiktokPosts>>
  try {
    posts = await fetchTiktokPosts(username, null, 5)
  } catch (err) {
    console.error(`[addKolCheck] TikTok fetch failed for @${username}:`, err)
    return {
      state: 'unverified',
      message: `We could not verify @${username} on TikTok right now. This looks like a temporary problem — try again shortly.`,
    }
  }

  const first = posts[0]
  const err = first ? apifyItemError(first) : null
  if (err) {
    if (err.gone) {
      return {
        state: 'not_found',
        message: `TikTok username not available: @${username} does not exist or is not reachable (${err.description || err.code}).`,
      }
    }
    return {
      state: 'unverified',
      message: `TikTok returned an unexpected error for @${username} (${err.description || err.code}). This looks temporary — try again shortly.`,
    }
  }

  const author: ApifyTiktokAuthorMeta | null = posts.find(p => p.authorMeta)?.authorMeta ?? null
  if (!author) {
    return {
      state: 'not_found',
      message: `TikTok username not available: @${username} returned no profile. The account may be new, private, or blocked to our region.`,
    }
  }

  return {
    state: 'new',
    account: {
      platform: 'tiktok',
      username,
      profileUrl,
      displayName: author.nickName ?? author.name ?? null,
      avatarUrl: author.originalAvatarUrl ?? author.avatar ?? null,
      bio: author.signature ?? null,
      followers: numOrNull(author.fans),
      raw: posts,
    },
  }
}

export async function checkKolExists(platform: AddKolPlatform, rawInput: string): Promise<CheckKolResult> {
  if (platform !== 'instagram' && platform !== 'tiktok') {
    return { state: 'invalid_input', message: `Platform "${platform}" is not supported for Add New KOL yet.` }
  }

  // A pasted URL from the wrong platform is caught before parsing against the
  // selected one, the same courtesy the Discover "Add Account" modal gives —
  // otherwise a TikTok link pasted under Instagram just reads as "invalid".
  const urlPlatform = platformOfUrl(rawInput)
  if (urlPlatform && urlPlatform !== platform && urlPlatform !== 'facebook') {
    return {
      state: 'invalid_input',
      message: `This is a ${urlPlatform === 'tiktok' ? 'TikTok' : 'Instagram'} link but ${platform === 'tiktok' ? 'TikTok' : 'Instagram'} is selected.`,
    }
  }

  const parsed = parseCreatorInput(platform, rawInput)
  if (!parsed.ok) {
    return { state: 'invalid_input', message: parsed.message }
  }
  if (parsed.platform === 'facebook') {
    // parseCreatorInput is generic over all three platforms; Add New KOL only
    // ever calls it with platform locked to 'instagram' | 'tiktok', so this is
    // unreachable in practice and exists only to satisfy the type checker.
    return { state: 'invalid_input', message: 'Facebook is not supported for Add New KOL.' }
  }

  const existing = await findInDirectory(parsed.platform, parsed.username)
  if (existing && existing.hasFollowerData) {
    return {
      state: 'already_in_directory',
      kol: {
        id: existing.id,
        username: existing.username,
        scrapeStatus: existing.scrape_status,
        followersCount: existing.followers_count,
        lastRefreshedAt: existing.last_refreshed_at ? new Date(existing.last_refreshed_at).toISOString() : null,
      },
    }
  }

  // Either no `kol_directory` row at all, or one that exists but was never
  // scraped through to follower data (most of the 7.7k-row roster, imported
  // from Excel and never touched by a scrape). Both cases live-check the
  // platform the same way; a row that already exists just carries its ids
  // forward so the scrape step reuses it instead of forking a duplicate.
  const result = parsed.platform === 'instagram'
    ? await checkInstagram(parsed.username, parsed.profileUrl)
    : await checkTiktok(parsed.username, parsed.profileUrl)

  if (result.state === 'new' && existing) {
    result.account.existingKolDirectoryId = existing.id
    result.account.existingSocialAccountId = existing.social_account_id
  }
  return result
}
