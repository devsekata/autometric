import { randomUUID } from 'crypto'
import type { PoolClient } from 'pg'
import kolDb, { kolDbWrite } from '@/lib/kolDb'
import {
  apifyItemError, fetchIgPosts, fetchTiktokPosts,
  type ApifyIgPost, type ApifyTiktokAuthorMeta, type ApifyTiktokPost,
} from '@/lib/apify/client'
import { fetchIgProfileRaw, fetchIgFollowers, fetchTiktokFollowers } from './apifyKolActors'
import { logRunFailure, withPipelineStep, withScrapeStep } from './stepLog'
import { getAddKolRunStatus, STALLED_AFTER_MS } from './addKolRunStatus'

/**
 * "Add New KOL" — step two: turn a checked handle into a roster row with a
 * real scrape behind it.
 *
 * Mirrors `@/lib/discover/creatorProfiling.ts`'s shape (identity row first,
 * heavy work in the background, every outcome recorded) but is otherwise an
 * independent pipeline: it writes into the commercial `kol` database
 * (`kolDbWrite`), not the warehouse, and its raw-table inserts follow the
 * exact field mapping `scrapper-project` uses (`raw_store.py`,
 * `tt_raw_store.py`, `post_raw_store.py`, `follower_raw_store.py`,
 * `transform.py`, `tiktok_transform.py`) so a row written here reads
 * identically to one the Python pipeline would have written.
 *
 * `scrapeNewKol` deliberately does not accept the profile item `checkKolExists`
 * already fetched — the exported signature is fixed by spec to
 * `{ platform, username, profileUrl, triggeredBy }`, so this pipeline re-fetches
 * the profile itself rather than threading an extra parameter through the API
 * route and the check step. The extra Apify call this costs is one profile
 * fetch, not a follower or post crawl, so it is cheap next to the rest of the
 * pipeline.
 */

export type AddKolPlatform = 'instagram' | 'tiktok'

export interface ScrapeNewKolInput {
  platform: AddKolPlatform
  username: string
  profileUrl: string
  triggeredBy: string | null
  /**
   * The agency this KOL should be rostered under (`public.agencies`), resolved
   * by the caller (see the API route) — `insertIdentity` never resolves this
   * itself. `null` when the logged-in user could not be tied to an agency
   * (today that is every user, since `public.user` is still empty); in that
   * case the `agency_kol_accounts` row is skipped rather than the whole
   * identity insert failing.
   */
  agencyId: string | null
  /** The user id to record as `agency_kol_accounts.created_by`, resolved the same way as `agencyId`. */
  createdByUserId: string | null
  /**
   * Reuse an existing `kol_directory` row instead of inserting a fresh one —
   * set when `checkKolExists` found a roster row for this handle that was
   * never scraped through to follower data (see `addKolCheck.ts`). When set,
   * `scrapeNewKol` skips `insertIdentity`'s `kol_directory` (and
   * `agency_kol_accounts`, unless missing) insert entirely and scrapes
   * straight into the existing row.
   */
  existingKolDirectoryId?: string | null
  /**
   * Paired with `existingKolDirectoryId`: reuse the existing
   * `social_account`/`kol_social_account` link too, if one already exists.
   * When `existingKolDirectoryId` is set but this is not, only the
   * `social_account`/`kol_social_account` rows are inserted fresh — the
   * `kol_directory` row itself is still reused, not duplicated.
   */
  existingSocialAccountId?: string | null
}

const IG_PROFILE_SOURCE = 'apify/instagram-profile-scraper'
const IG_POST_SOURCE = 'apify/instagram-scraper'
const IG_FOLLOWERS_SOURCE = 'apify/instagram-followers-following-scraper'
const TT_SOURCE = 'clockworks/tiktok-scraper'
const TT_FOLLOWERS_SOURCE = 'clockworks/tiktok-followers-scraper'

/**
 * How far back a post CAN be to count, and how many count. The window alone
 * used to be the only limit here (`fetchIgPosts(username, 90)` with no count
 * cap) — for an active account that is a real bill, not a hypothetical one:
 * one add pulled ~200 Instagram posts before this was capped. `POST_LIMIT` is
 * what actually stops the actor now (`client.ts` enforces it as a run-level
 * `maxItems`, not just an actor-input field the actor can ignore); the window
 * just keeps ancient posts out of a "recent activity" sample.
 */
const POST_WINDOW_DAYS = 30
const POST_LIMIT = 10
/** The follower sample size — see `apifyKolActors.ts` for the cost caps around it. */
const FOLLOWER_LIMIT = 100

type Json = Record<string, unknown>

/* ── small field-mapping helpers, ported from transform.py / follower_raw_store.py ── */

function asInt(v: unknown): number | null {
  if (v && typeof v === 'object' && 'count' in (v as Json)) v = (v as Json).count
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function asNum(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function asBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

function asStr(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s : null
}

/** First non-null/non-empty value across candidate keys, dotted paths allowed. */
function pick(obj: Json, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key.includes('.')) {
      const [a, b] = key.split('.')
      const nested = obj[a]
      if (nested && typeof nested === 'object') {
        const v = (nested as Json)[b]
        if (v !== undefined && v !== null && v !== '') return v
      }
      continue
    }
    const v = obj[key]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return null
}

/** `_links()` in follower_raw_store.py: pass strings through, serialise everything else. */
function asLinks(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v.trim() || null
  try {
    return JSON.stringify(v)
  } catch {
    return null
  }
}

function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase()
}

/**
 * `_website(item)` in raw_store.py: prefer `externalUrl`, else the first entry
 * of `externalUrls` (dict `.url` or a plain string).
 */
function igWebsite(item: Json): string | null {
  const url = item.externalUrl
  if (typeof url === 'string' && url.trim()) return url.trim()
  const urls = item.externalUrls
  if (Array.isArray(urls)) {
    for (const entry of urls) {
      if (entry && typeof entry === 'object' && typeof (entry as Json).url === 'string') return (entry as Json).url as string
      if (typeof entry === 'string' && entry.trim()) return entry.trim()
    }
  }
  return null
}

/** `compute_engagement_rate(item)` in transform.py. */
function igEngagementRate(item: Json): number | null {
  const followers = asInt(pick(item, 'followersCount', 'followers_count', 'edge_followed_by.count'))
  const posts = item.latestPosts
  if (!followers || followers <= 0 || !Array.isArray(posts) || !posts.length) return null

  const interactions: number[] = []
  for (const post of posts) {
    if (!post || typeof post !== 'object') continue
    let likes = asInt((post as Json).likesCount) ?? 0
    const comments = asInt((post as Json).commentsCount) ?? 0
    if (likes < 0) likes = 0 // -1 means Instagram hid the like count
    if (likes || comments) interactions.push(likes + comments)
  }
  if (!interactions.length) return null
  const avg = interactions.reduce((a, b) => a + b, 0) / interactions.length
  return Math.round((avg / followers) * 100 * 10_000) / 10_000
}

/* ── raw-table inserts ────────────────────────────────────────────────────── */

interface RawCtx {
  socialAccountId: string
  scrapeRunId: string
  scrapedAt: Date
}

async function insertIgProfileRaw(ctx: RawCtx, profile: Json): Promise<void> {
  await kolDbWrite().query(
    `INSERT INTO l0_raw.ig_profile_apify
       (social_account_id, fetched_at, username, name, biography, website,
        followers_count, follows_count, media_count,
        scrape_run_id, source_actor, raw_payload, scraped_at)
     VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      ctx.socialAccountId,
      asStr(pick(profile, 'username')),
      asStr(profile.fullName),
      asStr(profile.biography),
      igWebsite(profile),
      asInt(profile.followersCount),
      asInt(profile.followsCount),
      asInt(profile.postsCount),
      ctx.scrapeRunId,
      IG_PROFILE_SOURCE,
      profile,
      ctx.scrapedAt,
    ],
  )
}

async function insertIgPostsRaw(ctx: RawCtx, posts: ApifyIgPost[]): Promise<number> {
  let inserted = 0
  for (const post of posts) {
    const raw = post as unknown as Json
    const mediaId = asStr(post.id)
    if (!mediaId) continue // skipped_no_content_id, mirroring post_raw_store.py

    const children = post.childPosts
    await kolDbWrite().query(
      `INSERT INTO l0_raw.ig_media_snapshots_apify
         (social_account_id, media_id, fetched_at, posted_at, caption,
          media_type, permalink, cover_image, comments, likes, views,
          video_duration, carousel_media_count, is_sponsored,
          scrape_run_id, source_actor, raw_payload, scraped_at)
       VALUES ($1,$2, now(), $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        ctx.socialAccountId,
        mediaId,
        asStr(post.timestamp),
        asStr(post.caption),
        asStr(post.productType),
        asStr(post.url),
        asStr(post.displayUrl),
        asInt(post.commentsCount),
        asInt(post.likesCount),
        asInt(post.videoPlayCount ?? post.videoViewCount),
        asNum(post.videoDuration),
        Array.isArray(children) && children.length ? children.length : null,
        asBool(raw.paidPartnership),
        ctx.scrapeRunId,
        IG_POST_SOURCE,
        raw,
        ctx.scrapedAt,
      ],
    )
    inserted += 1
  }
  return inserted
}

async function insertTtProfileRaw(ctx: RawCtx, item: Json, author: ApifyTiktokAuthorMeta): Promise<void> {
  await kolDbWrite().query(
    `INSERT INTO l0_raw.tt_profile_apify
       (social_account_id, fetched_at, username, display_name, bio_description,
        avatar_url, is_verified, follower_count, following_count,
        likes_count, video_count,
        scrape_run_id, source_actor, raw_payload, scraped_at)
     VALUES ($1, now(), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      ctx.socialAccountId,
      asStr(author.name) ? normalizeUsername(String(author.name)) : null,
      asStr(author.nickName),
      asStr(author.signature),
      (() => {
        const a = author.originalAvatarUrl ?? author.avatar
        return typeof a === 'string' && a.trim() ? a.trim() : null
      })(),
      asBool(author.verified),
      asInt(author.fans),
      asInt(author.following),
      asInt(author.heart),
      asInt(author.video),
      ctx.scrapeRunId,
      TT_SOURCE,
      item,
      ctx.scrapedAt,
    ],
  )
}

async function insertTtVideosRaw(ctx: RawCtx, posts: ApifyTiktokPost[]): Promise<number> {
  let inserted = 0
  for (const post of posts) {
    if (apifyItemError(post)) continue
    const videoId = asStr(post.id)
    if (!videoId) continue

    await kolDbWrite().query(
      `INSERT INTO l0_raw.tt_video_apify
         (social_account_id, video_id, fetched_at, posted_at, title,
          description, duration, cover_image_url, share_url,
          like_count, comment_count, share_count, view_count,
          scrape_run_id, source_actor, raw_payload, scraped_at)
       VALUES ($1,$2, now(), $3, NULL, $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        ctx.socialAccountId,
        videoId,
        asStr(post.createTimeISO),
        asStr(post.text),
        asInt(post.videoMeta?.duration),
        asStr(post.videoMeta?.coverUrl ?? null),
        asStr(post.webVideoUrl),
        asInt(post.diggCount),
        asInt(post.commentCount),
        asInt(post.shareCount),
        asInt(post.playCount),
        ctx.scrapeRunId,
        TT_SOURCE,
        post,
        ctx.scrapedAt,
      ],
    )
    inserted += 1
  }
  return inserted
}

/** `petakan(item, platform)` in follower_raw_store.py. */
function mapFollower(item: Json, platform: AddKolPlatform) {
  const src = platform === 'tiktok' && item.authorMeta && typeof item.authorMeta === 'object'
    ? (item.authorMeta as Json)
    : item
  return {
    followerId: asStr(pick(src, 'id', 'pk', 'userId', 'user_id', 'secUid', 'fbid')),
    username: asStr(pick(src, 'username', 'userName', 'uniqueId', 'handle', 'name')),
    name: asStr(pick(src, 'fullName', 'full_name', 'nickName', 'nickname', 'displayName', 'title')),
    bio: asStr(pick(src, 'biography', 'bio', 'signature', 'description', 'about')),
    photo: asStr(pick(
      src, 'profilePicUrl', 'profile_pic_url', 'avatar', 'avatarUrl',
      'originalAvatarUrl', 'avatarMedium', 'avatarThumb', 'profilePicture',
    )),
    isPrivate: asBool(pick(src, 'isPrivate', 'privateAccount', 'private', 'secret')),
    isVerified: asBool(pick(src, 'isVerified', 'verified')),
    isBusiness: asBool(pick(src, 'isBusinessAccount', 'is_business_account', 'isBusiness', 'ttSeller', 'commerceUser')),
    followersCount: asInt(pick(src, 'followersCount', 'followers_count', 'followerCount', 'fans', 'edge_followed_by.count')),
    followingCount: asInt(pick(src, 'followingCount', 'following_count', 'followsCount', 'following')),
    email: asStr(pick(src, 'email', 'publicEmail', 'businessEmail')),
    phones: asStr(pick(src, 'phone', 'phones', 'contactPhoneNumber', 'publicPhoneNumber')),
    socialLinks: asLinks(pick(src, 'socialLinks', 'social_links', 'externalUrl', 'bioLink', 'links')),
  }
}

async function insertFollowersRaw(
  ctx: RawCtx, platform: AddKolPlatform, items: Json[],
): Promise<number> {
  const table = platform === 'instagram' ? 'l0_raw.ig_followers_apify' : 'l0_raw.tt_followers_apify'
  const idCol = platform === 'instagram' ? 'followers_ig_id' : 'followers_tt_id'
  const nameCol = platform === 'instagram' ? 'full_name' : 'display_name'
  const photoCol = platform === 'instagram' ? 'profile_pic_url' : 'avatar_url'
  const sourceActor = platform === 'instagram' ? IG_FOLLOWERS_SOURCE : TT_FOLLOWERS_SOURCE
  const db = kolDbWrite()

  // Same-day re-run replaces rather than duplicates, mirroring
  // follower_raw_store.py's delete-then-insert (there is no unique
  // constraint here for ON CONFLICT to lean on).
  await db.query(
    `DELETE FROM ${table}
      WHERE social_account_id = $1
        AND source_actor = $2
        AND (scraped_at AT TIME ZONE 'UTC')::date = ($3 AT TIME ZONE 'UTC')::date`,
    [ctx.socialAccountId, sourceActor, ctx.scrapedAt],
  )

  const seen = new Set<string>()
  let inserted = 0
  const insertAt = new Date()
  for (const item of items) {
    const mapped = mapFollower(item, platform)
    const key = mapped.followerId ?? mapped.username
    if (!key) continue // dilewati_tanpa_id
    if (seen.has(key)) continue // duplikat_dalam_batch
    seen.add(key)

    await db.query(
      `INSERT INTO ${table}
         (social_account_id, scrape_run_id, ${idCol}, username, ${nameCol},
          is_private, is_verified, ${photoCol}, is_bussiness_account,
          followers_count, following_count, bio,
          email, phones, social_links,
          raw_payload, scraped_at, source_actor, insert_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        ctx.socialAccountId, ctx.scrapeRunId, mapped.followerId, mapped.username, mapped.name,
        mapped.isPrivate, mapped.isVerified, mapped.photo, mapped.isBusiness,
        mapped.followersCount, mapped.followingCount, mapped.bio,
        mapped.email, mapped.phones, mapped.socialLinks,
        item, ctx.scrapedAt, sourceActor, insertAt,
      ],
    )
    inserted += 1
  }
  return inserted
}

/* ── harmonisation ────────────────────────────────────────────────────────── */

/**
 * The stored procedures are zero-argument and idempotent — they rescan their
 * whole source table on every call. They used to always run both platforms'
 * procs regardless of which platform this call was for; that meant every
 * "Add New KOL" run for, say, one Instagram handle also re-synced the entire
 * TikTok side of `l0_harmonization` for no reason. Now scoped to
 * `input.platform` — only the sync procs for the platform actually being
 * added run. The `l1_silver` builders are the exception: they are the
 * cross-platform unified tables, not per-platform, so they still run
 * unscoped, same as before.
 *
 * Order matters: profile syncs before post/follower syncs (the unified
 * builders join across them), and the `l1_silver` builders last of all. Each
 * proc call is wrapped in its own `add_kol_pipeline_log` row (`withPipelineStep`)
 * so the status endpoint can show which of the six steps the run is on.
 */
async function runHarmonization(args: { runId: string; kolDirectoryId: string; platform: AddKolPlatform }): Promise<void> {
  const db = kolDbWrite()
  const { runId, kolDirectoryId, platform } = args
  const syncProfileProc = platform === 'instagram' ? 'sp_sync_instagram_profile' : 'sp_sync_tiktok_profile'
  const syncPostProc = platform === 'instagram' ? 'sp_sync_instagram_post' : 'sp_sync_tiktok_post'
  const syncFollowerProc = platform === 'instagram' ? 'sp_sync_instagram_follower' : 'sp_sync_tiktok_follower'

  await withPipelineStep(
    { runId, kolDirectoryId, platform, step: 'sync_profile' },
    () => db.query(`CALL l0_harmonization.${syncProfileProc}()`),
  )
  await Promise.all([
    withPipelineStep(
      { runId, kolDirectoryId, platform, step: 'sync_post' },
      () => db.query(`CALL l0_harmonization.${syncPostProc}()`),
    ),
    withPipelineStep(
      { runId, kolDirectoryId, platform, step: 'sync_follower' },
      () => db.query(`CALL l0_harmonization.${syncFollowerProc}()`),
    ),
  ])
  await Promise.all([
    withPipelineStep(
      { runId, kolDirectoryId, platform, step: 'build_unified_profile' },
      () => db.query('SELECT l1_silver.sp_build_unified_profile()'),
    ),
    withPipelineStep(
      { runId, kolDirectoryId, platform, step: 'build_unified_post' },
      () => db.query('SELECT l1_silver.sp_build_unified_post()'),
    ),
    withPipelineStep(
      { runId, kolDirectoryId, platform, step: 'build_unified_follower' },
      () => db.query('SELECT l1_silver.sp_build_unified_follower()'),
    ),
  ])
}

/* ── kol_directory update ────────────────────────────────────────────────── */

/**
 * `to_db_update()` / `update_profiles()` in transform.py / db.py, narrowed to
 * one row: every field but `scrape_status` is `COALESCE`d against the current
 * value, so a field the scrape did not return never overwrites one it did.
 */
async function updateDirectoryFromIg(kolDirectoryId: string, profile: Json): Promise<void> {
  const err = apifyItemError(profile)
  if (err) {
    await kolDbWrite().query(
      `UPDATE public.kol_directory SET scrape_status = 'failed', updated_at = now() WHERE id = $1`,
      [kolDirectoryId],
    )
    return
  }

  const usernameRaw = asStr(pick(profile, 'username'))
  const username = usernameRaw ? normalizeUsername(usernameRaw) : null
  const platformUserId = asStr(pick(profile, 'id'))
  const verified = profile.verified
  const verifiedStatus = typeof verified === 'boolean' ? (verified ? 'verified' : 'unverified') : null

  await kolDbWrite().query(
    `UPDATE public.kol_directory k
        SET platform_user_id    = COALESCE($2, k.platform_user_id),
            username             = COALESCE($3, k.username),
            username_normalized  = COALESCE($3, k.username_normalized),
            followers_count      = COALESCE($4, k.followers_count),
            engagement_rate      = COALESCE($5, k.engagement_rate),
            avatar_url           = COALESCE($6, k.avatar_url),
            profile_url          = COALESCE($7, k.profile_url),
            bio                  = COALESCE($8, k.bio),
            verified_status      = COALESCE($9, k.verified_status),
            scrape_status        = 'success',
            last_refreshed_at    = now(),
            updated_at           = now()
      WHERE k.id = $1`,
    [
      kolDirectoryId, platformUserId, username,
      asInt(pick(profile, 'followersCount', 'followers_count', 'edge_followed_by.count')),
      igEngagementRate(profile),
      asStr(pick(profile, 'profilePicUrlHD', 'profilePicUrl')),
      asStr(pick(profile, 'url', 'profileUrl', 'inputUrl')) ?? (username ? `https://www.instagram.com/${username}/` : null),
      asStr(pick(profile, 'biography', 'bio')),
      verifiedStatus,
    ],
  )
}

/**
 * No Python equivalent updates `kol_directory.scrape_status` from the TikTok
 * leg (`tt_raw_store.py` notes it is "never populated" by that pipeline) —
 * this function is new, asked for explicitly by this feature's spec (step 4),
 * and mirrors the Instagram update's shape and field choices rather than
 * porting an existing one.
 */
async function updateDirectoryFromTt(kolDirectoryId: string, author: ApifyTiktokAuthorMeta): Promise<void> {
  const verifiedStatus = typeof author.verified === 'boolean' ? (author.verified ? 'verified' : 'unverified') : null
  const avatarUrl = author.originalAvatarUrl ?? author.avatar ?? null

  await kolDbWrite().query(
    `UPDATE public.kol_directory k
        SET followers_count   = COALESCE($2, k.followers_count),
            avatar_url        = COALESCE($3, k.avatar_url),
            bio               = COALESCE($4, k.bio),
            verified_status   = COALESCE($5, k.verified_status),
            scrape_status     = 'success',
            last_refreshed_at = now(),
            updated_at        = now()
      WHERE k.id = $1`,
    [kolDirectoryId, author.fans ?? null, avatarUrl, author.signature ?? null, verifiedStatus],
  )
}

/* ── the pipeline ─────────────────────────────────────────────────────────── */

async function platformId(platform: AddKolPlatform): Promise<string> {
  const { rows } = await kolDb().query<{ id: string }>(
    `SELECT id FROM public.platforms WHERE key = $1`, [platform],
  )
  if (!rows[0]) throw new Error(`Platform "${platform}" is not configured in public.platforms.`)
  return rows[0].id
}

/**
 * `agency_kol_accounts` link for a roster row, checked before insert so this
 * is safe to call both for a brand-new `kol_directory` row (where no link can
 * exist yet — the check is just cheap insurance) and for a reused one (where
 * some other process, e.g. the Excel import or another org's intake, may
 * already have created the link).
 */
async function ensureAgencyLink(
  client: PoolClient, kolDirectoryId: string, pfId: string, input: ScrapeNewKolInput,
): Promise<void> {
  if (!input.agencyId) {
    console.warn(`[addKolScrape] no agency could be resolved for @${input.username} — skipping agency_kol_accounts row.`)
    return
  }

  // Same lock and the same (agency, creator) key as My Creators' add
  // (`@/lib/discover/myCreators`), so the two paths cannot both insert a link.
  // KOL has no unique constraint on the pair; held until this transaction ends.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`my-creators:${input.agencyId}:${kolDirectoryId}`])
  const existing = await client.query<{ id: string; is_active: boolean | null }>(
    `SELECT id, is_active FROM public.agency_kol_accounts
      WHERE agency_id = $1 AND kol_account_id = $2
      ORDER BY is_active IS TRUE DESC, created_at ASC NULLS LAST
      LIMIT 1`,
    [input.agencyId, kolDirectoryId],
  )
  if (existing.rows[0]) {
    // Adding a creator the agency once removed from My Creators puts them back.
    if (existing.rows[0].is_active !== true) {
      await client.query(
        `UPDATE public.agency_kol_accounts
            SET is_active = true, status = 'active', updated_at = now()
          WHERE id = $1`,
        [existing.rows[0].id],
      )
    }
    return
  }

  await client.query(
    `INSERT INTO public.agency_kol_accounts
       (agency_id, kol_account_id, platform_id, status, is_active, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', true, $4, now(), now())`,
    [input.agencyId, kolDirectoryId, pfId, input.createdByUserId],
  )
}

/** `social_account` + `kol_social_account`, the two rows `insertIdentity` and
 *  `linkSocialAccount` both need — factored out so neither duplicates the
 *  insert logic. */
async function insertSocialAccountLink(
  client: PoolClient, pfId: string, kolDirectoryId: string, input: ScrapeNewKolInput,
): Promise<string> {
  const sa = await client.query<{ id: string }>(
    `INSERT INTO public.social_account
       (platform_id, username, profile_url, connected, data_source, created_at)
     VALUES ($1, $2, $3, false, 'apify', now())
     RETURNING id`,
    [pfId, input.username, input.profileUrl],
  )
  const socialAccountId = sa.rows[0].id

  await client.query(
    `INSERT INTO public.kol_social_account (kol_id, social_account_id, platform_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [kolDirectoryId, socialAccountId, pfId],
  )

  return socialAccountId
}

/**
 * Step 1, brand-new handle: the identity rows (`kol_directory` →
 * `social_account` → `kol_social_account`), in one transaction. Everything
 * downstream reads `social_account_id`, so nothing else can start until this
 * commits.
 */
async function insertIdentity(
  pfId: string, input: ScrapeNewKolInput,
): Promise<{ kolDirectoryId: string; socialAccountId: string }> {
  const usernameNormalized = normalizeUsername(input.username)
  const client = await kolDbWrite().connect()
  try {
    await client.query('BEGIN')

    const kd = await client.query<{ id: string }>(
      `INSERT INTO public.kol_directory
         (platform_id, username, username_normalized, source, directory_status, profile_url, created_at, updated_at)
       VALUES ($1, $2, $3, 'manual_add', 'active', $4, now(), now())
       RETURNING id`,
      [pfId, input.username, usernameNormalized, input.profileUrl],
    )
    const kolDirectoryId = kd.rows[0].id

    const socialAccountId = await insertSocialAccountLink(client, pfId, kolDirectoryId, input)
    await ensureAgencyLink(client, kolDirectoryId, pfId, input)

    await client.query('COMMIT')
    return { kolDirectoryId, socialAccountId }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * The ids to reuse arrive in the request body, so they are checked here rather
 * than trusted: the row must be an active roster row on the selected platform
 * and, when a social account is named, that account must be the one linked to
 * it. Anything else means the check result is stale (or was not ours).
 */
export class IdentityMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdentityMismatchError'
  }
}

async function assertReusableRow(
  client: PoolClient, pfId: string, kolDirectoryId: string, socialAccountId: string | null,
): Promise<void> {
  const { rows } = await client.query(
    `SELECT 1
       FROM public.kol_directory kd
      WHERE kd.id = $1
        AND kd.directory_status = 'active'
        AND kd.platform_id = $2
        AND ($3::uuid IS NULL OR EXISTS (
              SELECT 1 FROM public.kol_social_account ksa
               WHERE ksa.kol_id = kd.id AND ksa.social_account_id = $3))
      FOR SHARE OF kd`,
    [kolDirectoryId, pfId, socialAccountId],
  )
  if (!rows.length) {
    throw new IdentityMismatchError(
      `kol_directory ${kolDirectoryId} is not an active row on this platform`
      + (socialAccountId ? ` linked to social account ${socialAccountId}` : ''),
    )
  }
}

/**
 * Step 1, handle that already has a `kol_directory` row AND its
 * `kol_social_account` link (most of the roster: imported, never scraped) —
 * nothing to insert, but the requesting agency still needs its
 * `agency_kol_accounts` link, or the creator never reaches its My Creators and
 * the progress endpoint answers 404.
 */
async function reuseIdentity(
  pfId: string, kolDirectoryId: string, socialAccountId: string, input: ScrapeNewKolInput,
): Promise<{ kolDirectoryId: string; socialAccountId: string }> {
  const client = await kolDbWrite().connect()
  try {
    await client.query('BEGIN')
    await assertReusableRow(client, pfId, kolDirectoryId, socialAccountId)
    await ensureAgencyLink(client, kolDirectoryId, pfId, input)
    await client.query('COMMIT')
    return { kolDirectoryId, socialAccountId }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Step 1, handle that already has a `kol_directory` row but no
 * `kol_social_account` link (imported from Excel, never scraped) — reuse the
 * existing roster row rather than inserting a second one, and only add the
 * `social_account`/`kol_social_account` rows that are actually missing.
 */
async function linkSocialAccount(
  pfId: string, kolDirectoryId: string, input: ScrapeNewKolInput,
): Promise<{ kolDirectoryId: string; socialAccountId: string }> {
  const client = await kolDbWrite().connect()
  try {
    await client.query('BEGIN')
    await assertReusableRow(client, pfId, kolDirectoryId, null)
    const socialAccountId = await insertSocialAccountLink(client, pfId, kolDirectoryId, input)
    await ensureAgencyLink(client, kolDirectoryId, pfId, input)
    await client.query('COMMIT')
    return { kolDirectoryId, socialAccountId }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Steps 2–5, run after the identity rows already exist. Never rejects to its
 * caller — every failure is caught and marks the roster row failed.
 *
 * Logging is now per-step rather than one end-of-run row: every Apify actor
 * call gets its own `add_kol_scrape_log` row (`withScrapeStep`, begin before
 * the call, finish after) and every harmonisation proc gets its own
 * `add_kol_pipeline_log` row (inside `runHarmonization`). `scrapeRunId` —
 * already generated for `RawCtx`/the raw-table inserts — doubles as `run_id`
 * for both log tables, so every row from one "Add New KOL" run shares it and
 * the status endpoint can pull the whole run by that one id. A retry passes
 * the id in, so the dialog can poll that run before its first row exists.
 */
async function runRestOfPipeline(
  kolDirectoryId: string, socialAccountId: string, input: ScrapeNewKolInput,
  scrapeRunId: string = randomUUID(),
): Promise<void> {
  const scrapedAt = new Date()
  const ctx: RawCtx = { socialAccountId, scrapeRunId, scrapedAt }
  const stepBase = { runId: scrapeRunId, kolDirectoryId, socialAccountId, platform: input.platform, username: input.username }

  try {
    if (input.platform === 'instagram') {
      const [profile, posts, followers] = await Promise.all([
        withScrapeStep(
          { ...stepBase, step: 'profile', actor: IG_PROFILE_SOURCE },
          (r: Record<string, unknown> | null) => (r ? 1 : 0),
          () => fetchIgProfileRaw(input.username),
        ),
        withScrapeStep(
          { ...stepBase, step: 'posts', actor: IG_POST_SOURCE },
          (r: ApifyIgPost[]) => r.length,
          () => fetchIgPosts(input.username, POST_WINDOW_DAYS, POST_LIMIT),
        ),
        withScrapeStep(
          { ...stepBase, step: 'followers', actor: IG_FOLLOWERS_SOURCE },
          (r: Record<string, unknown>[]) => r.length,
          () => fetchIgFollowers(input.username, FOLLOWER_LIMIT),
        ),
      ])
      const profileJson = (profile ?? {}) as Json
      const err = apifyItemError(profileJson)
      if (!profile || err) {
        throw new Error(`Instagram profile scrape failed for @${input.username}: ${err?.description || err?.code || 'no profile returned'}`)
      }

      await insertIgProfileRaw(ctx, profileJson)
      await insertIgPostsRaw(ctx, posts)
      await insertFollowersRaw(ctx, 'instagram', followers as Json[])

      await runHarmonization({ runId: scrapeRunId, kolDirectoryId, platform: input.platform })
      await updateDirectoryFromIg(kolDirectoryId, profileJson)
    } else {
      const [posts, followers] = await Promise.all([
        withScrapeStep(
          { ...stepBase, step: 'profile_and_posts', actor: TT_SOURCE },
          (r: ApifyTiktokPost[]) => r.length,
          () => fetchTiktokPosts(input.username, POST_WINDOW_DAYS, POST_LIMIT),
        ),
        withScrapeStep(
          { ...stepBase, step: 'followers', actor: TT_FOLLOWERS_SOURCE },
          (r: Record<string, unknown>[]) => r.length,
          () => fetchTiktokFollowers(input.username, FOLLOWER_LIMIT),
        ),
      ])
      const firstErr = posts[0] ? apifyItemError(posts[0]) : null
      const author: ApifyTiktokAuthorMeta | null = posts.find(p => p.authorMeta)?.authorMeta ?? null
      if (firstErr || !author) {
        throw new Error(`TikTok profile scrape failed for @${input.username}: ${firstErr?.description || firstErr?.code || 'no author data returned'}`)
      }

      const profileItem = posts.find(p => p.authorMeta) as unknown as Json
      await insertTtProfileRaw(ctx, profileItem, author)
      await insertTtVideosRaw(ctx, posts)
      await insertFollowersRaw(ctx, 'tiktok', followers as Json[])

      await runHarmonization({ runId: scrapeRunId, kolDirectoryId, platform: input.platform })
      await updateDirectoryFromTt(kolDirectoryId, author)
    }
  } catch (err) {
    console.error(`[addKolScrape] pipeline failed for ${input.platform}/@${input.username}:`, err)
    await logRunFailure({
      runId: scrapeRunId, kolDirectoryId, platform: input.platform,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    try {
      await kolDbWrite().query(
        `UPDATE public.kol_directory SET scrape_status = 'failed', updated_at = now() WHERE id = $1`,
        [kolDirectoryId],
      )
    } catch (updateErr) {
      console.error('[addKolScrape] could not mark kol_directory as failed:', updateErr)
    }
  }
}

/**
 * Step 1 alone: the identity rows and the requesting agency's link, committed
 * before any scrape starts. Every branch ends with `ensureAgencyLink`. Throws
 * `IdentityMismatchError` when the ids to reuse do not describe an active
 * roster row (and its linked account) on this platform.
 */
export async function prepareKolIdentity(
  input: ScrapeNewKolInput,
): Promise<{ kolDirectoryId: string; socialAccountId: string }> {
  const pfId = await platformId(input.platform)

  // `checkKolExists` sets these when this handle already has a `kol_directory`
  // row (and, separately, may already have a `kol_social_account` link) that
  // was never scraped through to follower data. Reuse them instead of
  // inserting fresh identity rows — inserting again here would fork a
  // duplicate roster entry for the same KOL.
  if (!input.existingKolDirectoryId) return insertIdentity(pfId, input)
  return input.existingSocialAccountId
    ? reuseIdentity(pfId, input.existingKolDirectoryId, input.existingSocialAccountId, input)
    : linkSocialAccount(pfId, input.existingKolDirectoryId, input)
}

/**
 * Insert the identity rows (awaited — the caller needs the id right away),
 * then run the rest of the pipeline in the background.
 *
 * Deviates slightly from the literal "fire-and-forget the whole thing" shape
 * of `startProfiling()`: there, the creator row is created by the caller
 * before profiling starts, so `startProfiling` never needs to hand anything
 * back. Here, the id the caller needs to hand to the UI is itself produced by
 * this function's first step, so that step is awaited and only steps 2–5 run
 * detached. `startKolScrape` below is the fire-and-forget entry point that
 * matches `startProfiling()`'s signature shape most closely.
 */
export async function scrapeNewKol(input: ScrapeNewKolInput): Promise<{ kolDirectoryId: string }> {
  const { kolDirectoryId, socialAccountId } = await prepareKolIdentity(input)

  runRestOfPipeline(kolDirectoryId, socialAccountId, input).catch(err => {
    console.error('[addKolScrape] unhandled failure in background pipeline:', err)
  })

  return { kolDirectoryId }
}

/**
 * Start the whole pipeline without making the caller wait for the scrape.
 *
 * The identity-insert phase is still awaited — the API route needs
 * `kolDirectoryId` to answer the request — but that phase is one fast
 * transaction, not an Apify run. Everything that actually takes minutes
 * (`runRestOfPipeline`) is already detached inside `scrapeNewKol` by the time
 * this returns.
 */
export function startKolScrape(input: ScrapeNewKolInput): Promise<{ kolDirectoryId: string }> {
  return scrapeNewKol(input)
}

/* ── retry ────────────────────────────────────────────────────────────────── */

export type RetryRejection =
  /** The agency has no active link to this creator (or the id is unknown). */
  | 'not_linked'
  /** Not an active roster row on Instagram/TikTok with a linked social account. */
  | 'invalid_identity'
  /** The newest run has not failed: still pending/running, or already succeeded. */
  | 'not_failed'

export type RetryPlan =
  | { ok: true; kolDirectoryId: string; socialAccountId: string; input: ScrapeNewKolInput }
  | { ok: false; reason: RetryRejection; status?: string }

/**
 * Everything a retry needs, decided before anything runs — and read from the
 * KOL database, never from the client: the creator's own row, its linked
 * social account and handle. Writes nothing.
 *
 * Allowed only when the requesting agency holds an ACTIVE link to the creator
 * and the creator's newest run is `failed` by the same rules the status
 * endpoint uses (a failed step, a failed `run` row, or a step past the stall
 * threshold).
 */
export async function prepareRetry(
  kolDirectoryId: string, agencyId: string, userId: string,
): Promise<RetryPlan> {
  const db = kolDb()
  const { rows: link } = await db.query(
    `SELECT 1 FROM public.agency_kol_accounts
      WHERE agency_id = $1 AND kol_account_id = $2 AND is_active IS TRUE
      LIMIT 1`,
    [agencyId, kolDirectoryId],
  )
  if (!link.length) return { ok: false, reason: 'not_linked' }

  const { rows } = await db.query<{ username: string | null; platform: string; social_account_id: string }>(
    `SELECT kd.username, pl.key AS platform, ksa.social_account_id
       FROM public.kol_directory kd
       JOIN public.platforms pl ON pl.id = kd.platform_id
       JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
      WHERE kd.id = $1
        AND kd.directory_status = 'active'
        AND pl.key IN ('instagram', 'tiktok')
      ORDER BY ksa.created_at ASC NULLS LAST, ksa.id
      LIMIT 1`,
    [kolDirectoryId],
  )
  const row = rows[0]
  if (!row || !row.username?.trim()) return { ok: false, reason: 'invalid_identity' }

  const status = await getAddKolRunStatus(kolDirectoryId)
  if (status === 'not_found' || status === 'foreign_run') return { ok: false, reason: 'invalid_identity' }
  if (status.overallStatus !== 'failed') return { ok: false, reason: 'not_failed', status: status.overallStatus }

  return {
    ok: true,
    kolDirectoryId,
    socialAccountId: row.social_account_id,
    input: {
      platform: row.platform as AddKolPlatform,
      username: row.username,
      // Not read by the pipeline; kept for the input's shape.
      profileUrl: '',
      triggeredBy: null,
      agencyId,
      createdByUserId: userId,
    },
  }
}

/**
 * Run the scrape again for a creator whose last run failed. Same identity,
 * same links — no identity or agency row is written; only the new run's logs
 * and the pipeline's own output. Returns the new run id right away; the run
 * itself continues in the background like the first one.
 */
export async function retryKolScrape(
  kolDirectoryId: string, agencyId: string, userId: string,
): Promise<{ ok: true; kolDirectoryId: string; runId: string } | Extract<RetryPlan, { ok: false }>> {
  const plan = await prepareRetry(kolDirectoryId, agencyId, userId)
  if (!plan.ok) return plan

  const runId = randomUUID()
  runRestOfPipeline(plan.kolDirectoryId, plan.socialAccountId, plan.input, runId).catch(err => {
    console.error('[addKolScrape] unhandled failure in retried pipeline:', err)
  })
  return { ok: true, kolDirectoryId: plan.kolDirectoryId, runId }
}

/* ── refresh (D054) ───────────────────────────────────────────────────────── */

/**
 * Minimum gap between two refresh RUNS of one creator, measured from
 * `MAX(add_kol_scrape_log.started_at)`.
 *
 * Not from `kol_directory.last_refreshed_at`: for all but a handful of the
 * roster that column carries a value from the external import, which predates
 * any run this app ever made, so a cooldown built on it would wave through a
 * creator that was scraped minutes ago and block one that never was.
 */
export const REFRESH_COOLDOWN_MS = 15 * 60_000

/**
 * The reservation row's `add_kol_pipeline_log.step`. Deliberately not one of
 * the step keys in `ADD_KOL_STEP_KEYS` and not `RUN_FAILURE_STEP`, so neither
 * `getAddKolRunStatus` nor the D092 `PROFILING_STATUS` expression reads it —
 * both walk their own step lists. It exists for one reader: the in-flight
 * check below.
 */
export const REFRESH_RESERVATION_STEP = 'refresh_reservation'

/** The creator's status for the purpose of D054, mirroring D092's precedence. */
export type RefreshableStatus = 'ready' | 'failed' | 'profiling' | null

export type RefreshRejection =
  /** The agency has no active link to this creator (or the id is unknown). */
  | 'not_linked'
  /** Not an active roster row on Instagram/TikTok with a linked social account. */
  | 'invalid_identity'
  /** A run of this creator is in flight — a refresh, an add, or a D013 retry. */
  | 'already_running'
  /** Less than `REFRESH_COOLDOWN_MS` since the last run started. */
  | 'cooldown'
  /** The creator answers neither Ready nor Failed (D054 allows only those two). */
  | 'status_not_refreshable'

export type RefreshPlan =
  | {
      ok: true
      kolDirectoryId: string
      socialAccountId: string
      /** Reserved and already anchored in `add_kol_pipeline_log` when this returns. */
      runId: string
      status: Exclude<RefreshableStatus, 'profiling' | null>
      input: ScrapeNewKolInput
    }
  | {
      ok: false
      reason: RefreshRejection
      status?: RefreshableStatus
      /** `cooldown` only: how long until a refresh is allowed again. */
      retryAfterMs?: number
    }

/**
 * The creator's effective status, by the same precedence the D092
 * `PROFILING_STATUS` expression documents and applies:
 *
 *   failed     the newest run failed (a failed step, a failed `run` row, or a
 *              step past the stall threshold) — or `scrape_status = 'failed'`
 *              with no L2 card
 *   profiling  the newest run has started and has neither failed nor finished
 *   ready      the creator has an `l2_gold.kol_profile_card`
 *   null       none of these
 *
 * The run half is not re-derived here: it is `getAddKolRunStatus`, the same
 * function D013 uses, so the stall threshold has one source. `verify:kol-refresh`
 * cross-checks the result of this function against the D092 filter itself for
 * every fixture state, so the two cannot drift apart unnoticed.
 */
async function refreshableStatus(
  kolDirectoryId: string,
): Promise<{ status: RefreshableStatus } | 'not_found'> {
  const db = kolDb()
  const { rows } = await db.query<{ scrape_status: string | null; has_card: boolean }>(
    `SELECT kd.scrape_status,
            EXISTS (SELECT 1
                      FROM public.kol_social_account ksa
                      JOIN l2_gold.kol_profile_card c
                        ON c.social_account_id = ksa.social_account_id
                     WHERE ksa.kol_id = kd.id) AS has_card
       FROM public.kol_directory kd
      WHERE kd.id = $1`,
    [kolDirectoryId],
  )
  const row = rows[0]
  if (!row) return 'not_found'

  const run = await getAddKolRunStatus(kolDirectoryId)
  if (run === 'not_found' || run === 'foreign_run') return 'not_found'

  if (run.overallStatus === 'failed') return { status: 'failed' }
  if (row.scrape_status === 'failed' && !row.has_card) return { status: 'failed' }
  if (run.overallStatus === 'running') return { status: 'profiling' }
  return { status: row.has_card ? 'ready' : null }
}

/**
 * Everything a refresh needs, decided and reserved in ONE short transaction —
 * and read from the KOL database, never from the client.
 *
 * The transaction does five things under a refresh-only advisory lock and then
 * commits, all before any actor is called:
 *
 *   1. `pg_advisory_xact_lock('kol-refresh:<agency>:<creator>')` — its own key
 *      space, so it can never contend with the `my-creators:` lock D010/D013
 *      take around the agency link;
 *   2. the agency's ACTIVE link and the creator's identity;
 *   3. whether a run is already in flight (below);
 *   4. the cooldown, from `MAX(add_kol_scrape_log.started_at)`;
 *   5. the reservation row, which is what makes step 3 authoritative for the
 *      NEXT caller: the pipeline's own first log row lands milliseconds later,
 *      but a second POST arriving inside that gap would otherwise read the
 *      PREVIOUS run's status and be waved through. The reservation is written
 *      and committed before this function returns, so the second POST — which
 *      has to wait for the lock — sees it.
 *
 * The lock is released by the commit; the pipeline then runs with no database
 * transaction held open. A reservation is treated as live for
 * `STALLED_AFTER_MS`, the same threshold the run engine calls a stalled step
 * by, which is far shorter than the cooldown, so a process that dies between
 * the commit and the first step never blocks a creator for longer than the
 * cooldown would have anyway.
 *
 * Writes exactly one row (the reservation) and only on the accepted path;
 * every rejection leaves the database untouched.
 */
export async function prepareRefresh(
  kolDirectoryId: string, agencyId: string, userId: string,
): Promise<RefreshPlan> {
  // Read BEFORE the transaction opens, on the read pool: `getAddKolRunStatus`
  // owns its own queries, and a pooled query issued while this function holds a
  // dedicated client would queue behind it under the rollback harness the
  // verifiers run in. Staleness is not a correctness problem — what closes the
  // refresh-vs-refresh race is the reservation row checked under the lock
  // below, not this status.
  const effective = await refreshableStatus(kolDirectoryId)

  const client = await kolDbWrite().connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`kol-refresh:${agencyId}:${kolDirectoryId}`])

    const { rows: link } = await client.query(
      `SELECT 1 FROM public.agency_kol_accounts
        WHERE agency_id = $1 AND kol_account_id = $2 AND is_active IS TRUE
        LIMIT 1`,
      [agencyId, kolDirectoryId],
    )
    if (!link.length) { await client.query('ROLLBACK'); return { ok: false, reason: 'not_linked' } }

    const { rows: identity } = await client.query<
      { username: string | null; platform: string; social_account_id: string }
    >(
      `SELECT kd.username, pl.key AS platform, ksa.social_account_id
         FROM public.kol_directory kd
         JOIN public.platforms pl ON pl.id = kd.platform_id
         JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
        WHERE kd.id = $1
          AND kd.directory_status = 'active'
          AND pl.key IN ('instagram', 'tiktok')
        ORDER BY ksa.created_at ASC NULLS LAST, ksa.id
        LIMIT 1`,
      [kolDirectoryId],
    )
    const row = identity[0]
    if (!row || !row.username?.trim()) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'invalid_identity' }
    }

    // In flight, part one: a reservation this or another request committed and
    // whose pipeline has not yet written a step row of its own.
    const { rows: reserved } = await client.query(
      `SELECT 1 FROM public.add_kol_pipeline_log
        WHERE kol_directory_id = $1
          AND step = $2
          AND started_at > now() - make_interval(secs => $3::float8 / 1000)
        LIMIT 1`,
      [kolDirectoryId, REFRESH_RESERVATION_STEP, STALLED_AFTER_MS],
    )
    if (reserved.length) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'already_running', status: 'profiling' }
    }

    // In flight, part two: a run already visible to the engine — this creator's
    // Add KOL, a D013 retry, or a refresh whose first step has landed. That is
    // what `profiling` means, so it is reported as `already_running` rather
    // than as a status the user could do something about.
    if (effective === 'not_found') {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'invalid_identity' }
    }
    if (effective.status === 'profiling') {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'already_running', status: 'profiling' }
    }
    // D054 allows Ready and Failed. A creator with neither a run nor an L2 card
    // has nothing to refresh from and is left to Add KOL.
    if (effective.status !== 'ready' && effective.status !== 'failed') {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'status_not_refreshable', status: effective.status }
    }

    const { rows: last } = await client.query<{ ms_since: string | null }>(
      `SELECT EXTRACT(epoch FROM now() - max(started_at)) * 1000 AS ms_since
         FROM public.add_kol_scrape_log WHERE kol_directory_id = $1`,
      [kolDirectoryId],
    )
    const msSince = last[0]?.ms_since === null || last[0]?.ms_since === undefined
      ? null
      : Number(last[0].ms_since)
    if (msSince !== null && msSince < REFRESH_COOLDOWN_MS) {
      await client.query('ROLLBACK')
      return {
        ok: false,
        reason: 'cooldown',
        status: effective.status,
        retryAfterMs: Math.max(0, Math.ceil(REFRESH_COOLDOWN_MS - msSince)),
      }
    }

    const runId = randomUUID()
    await client.query(
      `INSERT INTO public.add_kol_pipeline_log
         (id, run_id, kol_directory_id, platform, step, status, started_at)
       VALUES ($1, $2, $3, $4, $5, 'running', now())`,
      [randomUUID(), runId, kolDirectoryId, row.platform, REFRESH_RESERVATION_STEP],
    )
    await client.query('COMMIT')

    return {
      ok: true,
      kolDirectoryId,
      socialAccountId: row.social_account_id,
      runId,
      status: effective.status,
      input: {
        platform: row.platform as AddKolPlatform,
        username: row.username,
        // Not read by the pipeline; kept for the input's shape.
        profileUrl: '',
        triggeredBy: null,
        agencyId,
        createdByUserId: userId,
      },
    }
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* the connection is going back anyway */ }
    throw err
  } finally {
    client.release()
  }
}

/**
 * Refresh one creator the agency already holds: the same pipeline the first
 * add runs, over the same identity and the same links. No identity row, no
 * agency row, no favorite and no monitoring flag is written — only the new
 * run's logs and the pipeline's own output, exactly as a D013 retry.
 *
 * Returns as soon as the run is reserved; the run itself continues in the
 * background and is followed through the existing status endpoint.
 */
export async function refreshKolScrape(
  kolDirectoryId: string, agencyId: string, userId: string,
): Promise<{ ok: true; kolDirectoryId: string; runId: string } | Extract<RefreshPlan, { ok: false }>> {
  const plan = await prepareRefresh(kolDirectoryId, agencyId, userId)
  if (!plan.ok) return plan

  runRestOfPipeline(plan.kolDirectoryId, plan.socialAccountId, plan.input, plan.runId).catch(err => {
    console.error('[addKolScrape] unhandled failure in refreshed pipeline:', err)
  })
  return { ok: true, kolDirectoryId: plan.kolDirectoryId, runId: plan.runId }
}
