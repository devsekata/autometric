import { randomUUID } from 'crypto'
import type { PoolClient } from 'pg'
import kolDb, { kolDbWrite } from '@/lib/kolDb'
import {
  apifyItemError, fetchIgPosts, fetchTiktokPosts,
  type ApifyIgPost, type ApifyTiktokAuthorMeta, type ApifyTiktokPost,
} from '@/lib/apify/client'
import { fetchIgProfileRaw, fetchIgFollowers, fetchTiktokFollowers } from './apifyKolActors'
import { withPipelineStep, withScrapeStep } from './stepLog'

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

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM public.agency_kol_accounts
      WHERE agency_id = $1 AND kol_account_id = $2 AND platform_id = $3
      LIMIT 1`,
    [input.agencyId, kolDirectoryId, pfId],
  )
  if (existing.rows[0]) return

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
 * the status endpoint can pull the whole run by that one id.
 */
async function runRestOfPipeline(
  kolDirectoryId: string, socialAccountId: string, input: ScrapeNewKolInput,
): Promise<void> {
  const scrapedAt = new Date()
  const scrapeRunId = randomUUID()
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
  const pfId = await platformId(input.platform)

  // `checkKolExists` sets these when this handle already has a `kol_directory`
  // row (and, separately, may already have a `kol_social_account` link) that
  // was never scraped through to follower data. Reuse them instead of
  // inserting fresh identity rows — inserting again here would fork a
  // duplicate roster entry for the same KOL.
  const { kolDirectoryId, socialAccountId } = input.existingKolDirectoryId
    ? input.existingSocialAccountId
      ? { kolDirectoryId: input.existingKolDirectoryId, socialAccountId: input.existingSocialAccountId }
      : await linkSocialAccount(pfId, input.existingKolDirectoryId, input)
    : await insertIdentity(pfId, input)

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
