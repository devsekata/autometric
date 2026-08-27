import kolDb from '@/lib/kolDb'
import pool from '@/lib/db'
import { fetchFbProfile, apifyItemError } from '@/lib/apify/client'
import { checkKolExists, type AddKolPlatform } from '@/lib/kolDirectory/addKolCheck'
import { parseCreatorInput, platformLabel, profileUrlFor, type CreatorPlatform } from './creatorInput'
import { findCreatorByHandle, toExistingRef } from './creatorStore'
import {
  VALIDATION_STEPS, type AccountPreview, type CheckResult, type CreatorVisibility, type FlowStep,
  type KnownElsewhere,
} from './creatorFlow'

/**
 * Check Account — everything that happens between the user pressing the button
 * and the modal showing a result screen.
 *
 * Five checks, in the order the modal draws them: the URL parses, the account
 * exists, it can be reached, it is public or private, and it is not already
 * known. Each one writes its own line into `steps`, including when it is skipped
 * and why, so the progress list the user watched is a record of what actually
 * ran rather than a decorative animation.
 *
 * Two rules shape the whole module:
 *
 *   1. **Only a definite negative rejects.** Instagram and Facebook can only be
 *      checked through Apify, and an outage, a spent token or a timeout says
 *      nothing about the account. Those come back as `unverified` — the user can
 *      still add the creator and profiling will settle it. Telling someone their
 *      correct handle does not exist, because our scraper was down, is the one
 *      failure this flow must not have.
 *   2. **The database is checked first, and the platform is not asked twice.**
 *      An account already in the org's roster needs no Apify run to be
 *      recognised, so the platform steps are marked skipped with the reason
 *      rather than run for an answer nobody will use.
 */

/** Steps start pending; each check settles its own. */
const freshSteps = (): FlowStep[] =>
  VALIDATION_STEPS.map(s => ({ key: s.key, label: s.label, state: 'pending' as const, detail: null, at: null }))

function settle(steps: FlowStep[], key: string, state: FlowStep['state'], detail?: string | null): void {
  const step = steps.find(s => s.key === key)
  if (!step) return
  step.state = state
  step.detail = detail ?? null
  step.at = new Date().toISOString()
}

/**
 * A ceiling on how long the user waits for a platform lookup.
 *
 * An Apify run takes anywhere from 20 seconds to several minutes, and the modal
 * cannot hold a request open that long — the browser gives up first, and the
 * user is left with a spinner that resolves into nothing. Past this point the
 * answer is "we could not confirm in time", which is true, and profiling (which
 * runs in the background and has no such limit) settles it properly.
 */
const LOOKUP_TIMEOUT_MS = 75_000

class LookupTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // The Apify run itself is not cancelled — it has already been started and
    // will finish on its own. Only our waiting for it stops.
    const timer = setTimeout(() => reject(new LookupTimeout('lookup timed out')), ms)
    p.then(v => { clearTimeout(timer); resolve(v) }, e => { clearTimeout(timer); reject(e) })
  })
}

/* ── the platform lookup ──────────────────────────────────────────────────── */

type Lookup =
  | { state: 'found'; account: AccountPreview }
  | { state: 'not_found'; message: string }
  | { state: 'unverified'; reason: string }

/**
 * Instagram and TikTok existence checks delegate to the "Add New KOL"
 * pipeline's own check (`@/lib/kolDirectory/addKolCheck`) rather than running
 * an independent Apify lookup here. Two reasons: an account already scraped
 * into the commercial roster (`kol_directory`) is recognised without spending
 * another Apify run, and a brand-new account discovered here is scraped by
 * the same pipeline a minute later (`creatorProfiling.ts`) — one roster, one
 * pipeline, instead of two independent scrapers each forming their own
 * opinion about the same handle.
 *
 * TikTok's old free oEmbed lookup and Instagram's direct Apify call are both
 * retired in favour of this. Facebook is untouched — `lookupFacebook` below
 * still runs its own Apify call directly, because the `kol_directory`
 * pipeline does not support that platform.
 */

/**
 * Read the extra fields `AccountPreview` wants for an account already in
 * `kol_directory` — `checkKolExists`'s `already_in_directory` branch only
 * carries id/username/scrapeStatus/followersCount/lastRefreshedAt, which is
 * the shape the "Add New KOL" duplicate screen needs, not this one.
 *
 * `is_private` comes from `l1_silver.unified_profile`, joined through
 * `kol_social_account` — `kol_directory` itself has no visibility column.
 * Both joins are `LEFT`: a roster row can exist with no harmonised profile
 * behind it yet (still scraping, or the scrape failed), and this must not
 * throw the whole check over a row that just has less to say.
 */
async function directoryPreview(kolDirectoryId: string): Promise<{
  avatarUrl: string | null
  bio: string | null
  profileUrl: string | null
  followers: number | null
  following: number | null
  postsCount: number | null
  verified: boolean
  visibility: CreatorVisibility
} | null> {
  const { rows } = await kolDb().query<{
    avatar_url: string | null
    bio: string | null
    profile_url: string | null
    followers_count: number | null
    verified_status: string | null
    following_count: string | number | null
    media_count: number | null
    is_private: boolean | null
  }>(
    `SELECT kd.avatar_url, kd.bio, kd.profile_url, kd.followers_count, kd.verified_status,
            up.following_count, up.media_count, up.is_private
       FROM public.kol_directory kd
       LEFT JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
       LEFT JOIN l1_silver.unified_profile up ON up.social_account_id = ksa.social_account_id
      WHERE kd.id = $1
      LIMIT 1`,
    [kolDirectoryId],
  )
  const r = rows[0]
  if (!r) return null
  return {
    avatarUrl: r.avatar_url,
    bio: r.bio,
    profileUrl: r.profile_url,
    followers: r.followers_count,
    following: r.following_count !== null && r.following_count !== undefined ? Number(r.following_count) : null,
    postsCount: r.media_count,
    verified: r.verified_status === 'verified',
    visibility: r.is_private === true ? 'private' : r.is_private === false ? 'public' : 'unknown',
  }
}

/**
 * Visibility off the raw payload `checkKolExists` fetched for a handle that
 * is not in the roster yet. It carries the same actor responses the old
 * `lookupInstagram`/`lookupTiktok` read `private`/`privateAccount` from —
 * only the caller changed, not the shape of what Apify returns.
 */
function visibilityFromNewAccount(platform: AddKolPlatform, raw: unknown): CreatorVisibility {
  if (platform === 'instagram') {
    const profile = raw as { private?: boolean } | null
    return typeof profile?.private === 'boolean' ? (profile.private ? 'private' : 'public') : 'unknown'
  }
  const posts = Array.isArray(raw) ? raw as { authorMeta?: { privateAccount?: boolean } }[] : []
  const author = posts.find(p => p?.authorMeta)?.authorMeta
  return typeof author?.privateAccount === 'boolean' ? (author.privateAccount ? 'private' : 'public') : 'unknown'
}

async function lookupViaKolDirectory(platform: AddKolPlatform, rawInput: string): Promise<Lookup> {
  const result = await checkKolExists(platform, rawInput)

  if (result.state === 'not_found') return { state: 'not_found', message: result.message }
  if (result.state === 'unverified') return { state: 'unverified', reason: result.message }
  if (result.state === 'invalid_input') {
    // Step 1 already validated this exact input against this exact platform,
    // so this is unreachable in practice — it exists only because
    // `checkKolExists` is typed to allow it.
    return { state: 'unverified', reason: result.message }
  }

  if (result.state === 'already_in_directory') {
    const preview = await directoryPreview(result.kol.id)
    return {
      state: 'found',
      account: {
        platform: platform as CreatorPlatform,
        username: result.kol.username,
        profileUrl: preview?.profileUrl ?? profileUrlFor(platform, result.kol.username),
        displayName: null,
        avatarUrl: preview?.avatarUrl ?? null,
        bio: preview?.bio ?? null,
        followers: result.kol.followersCount ?? preview?.followers ?? null,
        following: preview?.following ?? null,
        postsCount: preview?.postsCount ?? null,
        verified: preview?.verified ?? false,
        visibility: preview?.visibility ?? 'unknown',
      },
    }
  }

  // result.state === 'new'
  const { account } = result
  return {
    state: 'found',
    account: {
      platform: platform as CreatorPlatform,
      username: account.username,
      profileUrl: account.profileUrl,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      bio: account.bio,
      followers: account.followers,
      visibility: visibilityFromNewAccount(platform, account.raw),
    },
  }
}

async function lookupFacebook(username: string): Promise<Lookup> {
  const profile = await withTimeout(fetchFbProfile(username), LOOKUP_TIMEOUT_MS)
  const err = apifyItemError(profile)
  if (err?.gone) return { state: 'not_found', message: notFound('facebook', username) }
  if (err) return { state: 'unverified', reason: `${err.code}: ${err.description}` }
  const id = profile?.facebookId ?? profile?.pageId
  if (!id) return { state: 'unverified', reason: 'Facebook returned no page for that address.' }

  return {
    state: 'found',
    account: {
      platform: 'facebook',
      username,
      profileUrl: profile?.pageUrl ?? profile?.facebookUrl ?? profileUrlFor('facebook', username),
      displayName: profile?.title ?? profile?.pageName ?? null,
      avatarUrl: profile?.profilePhoto ?? profile?.profilePictureUrl ?? null,
      bio: profile?.intro ?? null,
      followers: profile?.followers ?? null,
      postsCount: null,
      // A Facebook page is public by definition — a page nobody can see is one
      // the scraper reports as gone, which is the `not_found` branch above.
      visibility: 'public',
    },
  }
}

const notFound = (platform: string, username: string) =>
  `We could not find @${username} on ${platformLabel(platform)}. Check the spelling, or open the profile and copy its URL.`

async function lookup(platform: CreatorPlatform, username: string, rawInput: string): Promise<Lookup> {
  try {
    if (platform === 'tiktok') return await withTimeout(lookupViaKolDirectory('tiktok', rawInput), LOOKUP_TIMEOUT_MS)
    if (platform === 'instagram') return await withTimeout(lookupViaKolDirectory('instagram', rawInput), LOOKUP_TIMEOUT_MS)
    return await lookupFacebook(username)
  } catch (err) {
    if (err instanceof LookupTimeout) {
      return {
        state: 'unverified',
        reason: `${platformLabel(platform)} did not answer within ${Math.round(LOOKUP_TIMEOUT_MS / 1000)} seconds.`,
      }
    }
    // Apify 500, a missing token, DNS — all of it is about us, not the account.
    return { state: 'unverified', reason: err instanceof Error ? err.message : String(err) }
  }
}

/* ── the other two rosters ────────────────────────────────────────────────── */

/**
 * Is this handle already known somewhere this app does not own?
 *
 * Neither answer blocks intake — the commercial roster is a different database
 * with no post history for most of its rows, and a tracked competitor account is
 * not a creator you can hire. Both are worth *saying*, because adding a creator
 * the org can already see elsewhere is usually a surprise, and knowing where
 * else they appear is what makes the roster feel like one database rather than
 * three lists.
 *
 * Best-effort by design: the KOL database sits on a private network and is
 * unreachable from some environments, so a failure here is logged and dropped
 * rather than failing the check the user actually asked for.
 */
async function knownElsewhere(orgId: string, platform: string, username: string): Promise<KnownElsewhere[]> {
  const out: KnownElsewhere[] = []

  const roster = kolDb().query<{ id: string; username: string }>(
    `SELECT kd.id, kd.username
       FROM public.kol_directory kd
       LEFT JOIN public.platforms pl ON pl.id = kd.platform_id
      WHERE kd.directory_status = 'active'
        AND LOWER(kd.username) = LOWER($1)
        AND (pl.key IS NULL OR pl.key = $2)
      LIMIT 1`,
    [username, platform],
  ).then(r => {
    if (r.rows[0]) {
      out.push({
        source: 'roster',
        label: `Also in the commercial KOL roster as @${r.rows[0].username}`,
        href: null,
      })
    }
  }).catch(err => {
    console.warn('[creator intake] roster lookup skipped:', err instanceof Error ? err.message : err)
  })

  const tracked = pool.query<{ username: string; relation: string }>(
    `SELECT sa.username,
            CASE WHEN bsa.social_account_id IS NOT NULL THEN 'brand' ELSE 'competitor' END AS relation
       FROM public.social_accounts sa
       JOIN public.platforms pl ON pl.id = sa.platform_id
       LEFT JOIN public.brand_social_accounts bsa ON bsa.social_account_id = sa.id
       LEFT JOIN public.brand_competitors bc      ON bc.social_account_id  = sa.id
       JOIN public.brands b
         ON b.id = COALESCE(bsa.brand_id, bc.brand_id) AND b.deleted_at IS NULL
      WHERE b.organization_id = $1
        AND pl.key = $2
        AND LOWER(sa.username) = LOWER($3)
      LIMIT 1`,
    [orgId, platform, username],
  ).then(r => {
    if (r.rows[0]) {
      out.push({
        source: 'tracked',
        label: r.rows[0].relation === 'brand'
          ? 'This organization already tracks this account as one of its own brand accounts'
          : 'This organization already tracks this account as a competitor',
        href: null,
      })
    }
  }).catch(err => {
    console.warn('[creator intake] tracked lookup skipped:', err instanceof Error ? err.message : err)
  })

  await Promise.all([roster, tracked])
  return out
}

/* ── the check itself ─────────────────────────────────────────────────────── */

export async function checkCreatorAccount(
  orgId: string, platform: string, rawInput: string,
): Promise<CheckResult> {
  const steps = freshSteps()

  // 1. The URL — pure string work, so it is free and it is definite.
  const parsed = parseCreatorInput(platform, rawInput)
  if (!parsed.ok) {
    settle(steps, 'url', 'failed', parsed.message)
    return { state: 'invalid_url', message: parsed.message, suggestPlatform: parsed.suggestPlatform, steps }
  }
  const { username } = parsed
  settle(steps, 'url', 'done', `Reading ${platformLabel(parsed.platform)} handle @${username}`)

  // 2-5. The database first. An account the org already has needs no Apify run
  //      to be recognised, and the steps say so rather than claiming checks that
  //      never ran.
  const existing = await findCreatorByHandle(orgId, parsed.platform, username)
  if (existing) {
    const why = 'Already in your database — the platform was not asked again'
    settle(steps, 'account', 'skipped', why)
    settle(steps, 'access', 'skipped', why)
    settle(steps, 'visibility', 'done', `Recorded as ${existing.visibility}`)
    settle(steps, 'database', 'done', `Found: @${existing.username}, added ${existing.createdAt.slice(0, 10)}`)
    return {
      state: 'exists',
      account: {
        platform: parsed.platform,
        username: existing.username,
        profileUrl: existing.profileUrl ?? parsed.profileUrl,
        displayName: existing.displayName,
        avatarUrl: existing.avatarUrl,
        followers: existing.followers,
        verified: existing.verified,
        visibility: existing.visibility,
      },
      existing: toExistingRef(existing),
      steps,
    }
  }

  // The other two rosters are asked in parallel with the platform lookup rather
  // than after it. Neither answer affects the other, and the KOL database is
  // sometimes unreachable — its 8-second connection timeout would otherwise be
  // added to the wait for a check that had already succeeded.
  const elsewhereSoon = knownElsewhere(orgId, parsed.platform, username)

  // 2. Does the account exist?
  const found = await lookup(parsed.platform, username, rawInput)

  if (found.state === 'not_found') {
    void elsewhereSoon.catch(() => {})
    settle(steps, 'account', 'failed', found.message)
    return { state: 'not_found', message: found.message, steps }
  }

  if (found.state === 'unverified') {
    // Nothing reads the parallel lookup on this path, but an unhandled rejection
    // would still be logged as one — `knownElsewhere` swallows its own errors,
    // and this keeps that true for the caller as well.
    void elsewhereSoon.catch(() => {})
    settle(steps, 'account', 'skipped', found.reason)
    settle(steps, 'access', 'skipped', 'Not reached — the account could not be confirmed')
    settle(steps, 'visibility', 'skipped', 'Not reached — the account could not be confirmed')
    settle(steps, 'database', 'done', 'No creator with this handle in your database')
    return {
      state: 'unverified',
      message:
        `We could not confirm @${username} on ${platformLabel(parsed.platform)} right now — ${found.reason} ` +
        'This says nothing about the account itself. You can add it anyway and profiling will confirm it, or try the check again.',
      account: {
        platform: parsed.platform,
        username,
        profileUrl: parsed.profileUrl,
        visibility: 'unknown',
      },
      steps,
    }
  }

  const account = found.account
  settle(steps, 'account', 'done', account.displayName ? `Found ${account.displayName}` : `Found @${account.username}`)

  // 3. Accessible — proven by the fact that the lookup came back with a profile.
  settle(steps, 'access', 'done', 'Profile is reachable from our servers')

  // 4. Public or private.
  settle(
    steps, 'visibility',
    account.visibility === 'unknown' ? 'skipped' : 'done',
    account.visibility === 'private' ? 'Private — only basic information is public'
      : account.visibility === 'public' ? 'Public — full profile is readable'
      : `${platformLabel(parsed.platform)} does not expose this before profiling`,
  )

  // 5. Everywhere else the handle might be known.
  const elsewhere = await elsewhereSoon
  settle(
    steps, 'database', 'done',
    elsewhere.length
      ? `Not in your creator database; ${elsewhere.length} match${elsewhere.length > 1 ? 'es' : ''} elsewhere`
      : 'No creator with this handle in your database',
  )

  if (account.visibility === 'private') return { state: 'private', account, steps }
  return { state: 'new', account, knownElsewhere: elsewhere, steps }
}
