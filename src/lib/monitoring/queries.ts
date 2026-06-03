import pool from '@/lib/db'

export type SchedulerLogRow = {
  id:               string
  runId:            string
  jobName:          string
  platform:         string
  category:         string | null
  socialAccountId:  string | null
  brandId:          string | null
  orgId:            string | null
  orgName:          string | null
  brandName:        string | null
  username:         string | null
  status:           'running' | 'success' | 'failed' | 'skipped'
  recordsSynced:    number | null
  errorMessage:     string | null
  startedAt:        string
  finishedAt:       string | null
  durationMs:       number | null
}

export async function getRecentSchedulerLogs(limit = 300): Promise<SchedulerLogRow[]> {
  const { rows } = await pool.query<SchedulerLogRow>(
    `SELECT
       sl.id,
       sl.run_id            AS "runId",
       sl.job_name          AS "jobName",
       sl.platform,
       sl.category,
       sl.social_account_id AS "socialAccountId",
       sl.brand_id          AS "brandId",
       sl.org_id            AS "orgId",
       o.name               AS "orgName",
       b.name               AS "brandName",
       sa.username,
       sl.status,
       sl.records_synced    AS "recordsSynced",
       sl.error_message     AS "errorMessage",
       sl.started_at        AS "startedAt",
       sl.finished_at       AS "finishedAt",
       CASE WHEN sl.finished_at IS NOT NULL
         THEN EXTRACT(EPOCH FROM (sl.finished_at - sl.started_at))::INT * 1000
         ELSE NULL
       END AS "durationMs"
     FROM scheduler_logs sl
     LEFT JOIN organizations   o  ON o.id  = sl.org_id
     LEFT JOIN brands          b  ON b.id  = sl.brand_id
     LEFT JOIN social_accounts sa ON sa.id = sl.social_account_id
     ORDER BY sl.started_at DESC
     LIMIT $1`,
    [limit]
  )
  return rows
}

export type CategorySyncRow = {
  category:        string
  platform:        string
  socialAccountId: string
  brandId:         string
  brandName:       string
  orgId:           string | null
  orgName:         string | null
  username:        string
  dataCount:       number
  lastSync:        string | null
  lastStatus:      'success' | 'failed' | 'skipped' | null
}

// Shared JOIN fragment for all category queries
const CAT_JOINS = `
  JOIN brand_social_accounts bsa ON bsa.social_account_id = sa.id
  JOIN brands b ON b.id = bsa.brand_id
  JOIN organizations o ON o.id = b.organization_id`

// Returns a correlated subquery that fetches the latest scheduler_logs status
const lastStatusSub = (cat: string) =>
  `(SELECT sl.status FROM scheduler_logs sl
    WHERE sl.social_account_id = sa.id AND sl.category = '${cat}'
    ORDER BY sl.started_at DESC LIMIT 1) AS "lastStatus"`

export async function getAllCategoryData(): Promise<CategorySyncRow[]> {
  const { rows } = await pool.query<CategorySyncRow>(`
    SELECT * FROM (

      SELECT 'ig_profile'  AS category, 'instagram' AS platform, sa.id AS "socialAccountId",
             b.id AS "brandId", b.name AS "brandName", o.id AS "orgId", o.name AS "orgName",
             sa.username, COUNT(ips.id)::int AS "dataCount",
             MAX(ips.fetched_at)::text AS "lastSync",
             ${lastStatusSub('ig_profile')}
        FROM social_accounts sa ${CAT_JOINS}
        JOIN platforms p ON p.id = sa.platform_id AND p.key = 'instagram'
        LEFT JOIN l0_raw.ig_profile_snapshots ips ON ips.social_account_id = sa.id
       WHERE sa.connected = true GROUP BY sa.id, b.id, b.name, o.id, o.name, sa.username

      UNION ALL
      SELECT 'ig_posts'    AS category, 'instagram' AS platform, sa.id,
             b.id, b.name, o.id, o.name, sa.username, COUNT(ims.id)::int,
             MAX(ims.fetched_at)::text, ${lastStatusSub('ig_posts')}
        FROM social_accounts sa ${CAT_JOINS}
        JOIN platforms p ON p.id = sa.platform_id AND p.key = 'instagram'
        LEFT JOIN l0_raw.ig_media_snapshots ims ON ims.social_account_id = sa.id
       WHERE sa.connected = true GROUP BY sa.id, b.id, b.name, o.id, o.name, sa.username

      UNION ALL
      SELECT 'ig_stories'  AS category, 'instagram' AS platform, sa.id,
             b.id, b.name, o.id, o.name, sa.username, COUNT(ist.id)::int,
             MAX(ist.fetched_at)::text, ${lastStatusSub('ig_stories')}
        FROM social_accounts sa ${CAT_JOINS}
        JOIN platforms p ON p.id = sa.platform_id AND p.key = 'instagram'
        LEFT JOIN l0_raw.ig_stories ist ON ist.social_account_id = sa.id
       WHERE sa.connected = true GROUP BY sa.id, b.id, b.name, o.id, o.name, sa.username

      UNION ALL
      SELECT 'ig_tagged'   AS category, 'instagram' AS platform, sa.id,
             b.id, b.name, o.id, o.name, sa.username, COUNT(itp.id)::int,
             MAX(itp.fetched_at)::text, ${lastStatusSub('ig_tagged')}
        FROM social_accounts sa ${CAT_JOINS}
        JOIN platforms p ON p.id = sa.platform_id AND p.key = 'instagram'
        LEFT JOIN l0_raw.ig_tagged_posts itp ON itp.social_account_id = sa.id
       WHERE sa.connected = true GROUP BY sa.id, b.id, b.name, o.id, o.name, sa.username

      UNION ALL
      SELECT 'ig_comments' AS category, 'instagram' AS platform, sa.id,
             b.id, b.name, o.id, o.name, sa.username, COUNT(ic.id)::int,
             MAX(ic.comment_time)::text, ${lastStatusSub('ig_comments')}
        FROM social_accounts sa ${CAT_JOINS}
        JOIN platforms p ON p.id = sa.platform_id AND p.key = 'instagram'
        LEFT JOIN l0_raw.ig_comments ic ON ic.social_account_id = sa.id
       WHERE sa.connected = true GROUP BY sa.id, b.id, b.name, o.id, o.name, sa.username

      UNION ALL
      SELECT 'tt_profile'  AS category, 'tiktok' AS platform, sa.id,
             b.id, b.name, o.id, o.name, sa.username, COUNT(ttp.id)::int,
             MAX(ttp.fetched_at)::text, ${lastStatusSub('tt_profile')}
        FROM social_accounts sa ${CAT_JOINS}
        JOIN platforms p ON p.id = sa.platform_id AND p.key = 'tiktok'
        LEFT JOIN l0_raw.tt_profile_snapshots ttp ON ttp.social_account_id = sa.id
       WHERE sa.connected = true GROUP BY sa.id, b.id, b.name, o.id, o.name, sa.username

      UNION ALL
      SELECT 'tt_videos'   AS category, 'tiktok' AS platform, sa.id,
             b.id, b.name, o.id, o.name, sa.username, COUNT(ttv.id)::int,
             MAX(ttv.fetched_at)::text, ${lastStatusSub('tt_videos')}
        FROM social_accounts sa ${CAT_JOINS}
        JOIN platforms p ON p.id = sa.platform_id AND p.key = 'tiktok'
        LEFT JOIN l0_raw.tt_video_snapshots ttv ON ttv.social_account_id = sa.id
       WHERE sa.connected = true GROUP BY sa.id, b.id, b.name, o.id, o.name, sa.username

      UNION ALL
      SELECT 'fb_profile'  AS category, 'facebook' AS platform, sa.id,
             b.id, b.name, o.id, o.name, sa.username, COUNT(fbps.id)::int,
             MAX(fbps.fetched_at)::text, ${lastStatusSub('fb_profile')}
        FROM social_accounts sa ${CAT_JOINS}
        JOIN platforms p ON p.id = sa.platform_id AND p.key = 'facebook'
        LEFT JOIN l0_raw.fb_profile_snapshots fbps ON fbps.social_account_id = sa.id
       WHERE sa.connected = true GROUP BY sa.id, b.id, b.name, o.id, o.name, sa.username

      UNION ALL
      SELECT 'fb_posts'    AS category, 'facebook' AS platform, sa.id,
             b.id, b.name, o.id, o.name, sa.username, COUNT(fbp.id)::int,
             MAX(fbp.fetched_at)::text, ${lastStatusSub('fb_posts')}
        FROM social_accounts sa ${CAT_JOINS}
        JOIN platforms p ON p.id = sa.platform_id AND p.key = 'facebook'
        LEFT JOIN l0_raw.fb_post_snapshots fbp ON fbp.social_account_id = sa.id
       WHERE sa.connected = true GROUP BY sa.id, b.id, b.name, o.id, o.name, sa.username

    ) t
    ORDER BY category, "orgName", "brandName"
  `)
  return rows
}

export type PlatformSyncRow = {
  orgId?:          string
  orgName?:        string
  brandId:         string
  brandName:       string
  platform:        string
  socialAccountId: string
  username:        string
  lastProfileSync: string | null
  dataCount:       number
}

export async function getAllMonitoringData(): Promise<PlatformSyncRow[]> {
  const { rows } = await pool.query<PlatformSyncRow>(
    `SELECT
       o.id   AS "orgId",
       o.name AS "orgName",
       b.id   AS "brandId",
       b.name AS "brandName",
       p.key  AS platform,
       sa.id  AS "socialAccountId",
       sa.username,
       CASE p.key
         WHEN 'instagram' THEN (
           SELECT fetched_at FROM l0_raw.ig_profile_snapshots
           WHERE social_account_id = sa.id ORDER BY fetched_at DESC LIMIT 1
         )
         WHEN 'tiktok' THEN (
           SELECT fetched_at FROM l0_raw.tt_profile_snapshots
           WHERE social_account_id = sa.id ORDER BY fetched_at DESC LIMIT 1
         )
         WHEN 'facebook' THEN (
           SELECT fetched_at FROM l0_raw.fb_profile_snapshots
           WHERE social_account_id = sa.id ORDER BY fetched_at DESC LIMIT 1
         )
       END AS "lastProfileSync",
       COALESCE(
         CASE p.key
           WHEN 'instagram' THEN (
             SELECT COUNT(*)::int FROM l0_raw.ig_media_snapshots WHERE social_account_id = sa.id
           )
           WHEN 'tiktok' THEN (
             SELECT COUNT(*)::int FROM l0_raw.tt_video_snapshots WHERE social_account_id = sa.id
           )
           WHEN 'facebook' THEN (
             SELECT COUNT(*)::int FROM l0_raw.fb_post_snapshots WHERE social_account_id = sa.id
           )
         END,
         0
       ) AS "dataCount"
     FROM brands b
     JOIN organizations o            ON o.id  = b.organization_id
     JOIN brand_social_accounts bsa  ON bsa.brand_id = b.id
     JOIN social_accounts sa         ON sa.id = bsa.social_account_id
     JOIN platforms p                ON p.id  = sa.platform_id
     WHERE sa.connected = true
     ORDER BY o.name, b.created_at, p.key`
  )
  return rows
}

export async function getMonitoringData(orgId: string): Promise<PlatformSyncRow[]> {
  const { rows } = await pool.query<PlatformSyncRow>(
    `SELECT
       b.id           AS "brandId",
       b.name         AS "brandName",
       p.key          AS platform,
       sa.id          AS "socialAccountId",
       sa.username,
       CASE p.key
         WHEN 'instagram' THEN (
           SELECT fetched_at FROM l0_raw.ig_profile_snapshots
           WHERE social_account_id = sa.id ORDER BY fetched_at DESC LIMIT 1
         )
         WHEN 'tiktok' THEN (
           SELECT fetched_at FROM l0_raw.tt_profile_snapshots
           WHERE social_account_id = sa.id ORDER BY fetched_at DESC LIMIT 1
         )
         WHEN 'facebook' THEN (
           SELECT fetched_at FROM l0_raw.fb_profile_snapshots
           WHERE social_account_id = sa.id ORDER BY fetched_at DESC LIMIT 1
         )
       END AS "lastProfileSync",
       COALESCE(
         CASE p.key
           WHEN 'instagram' THEN (
             SELECT COUNT(*)::int FROM l0_raw.ig_media_snapshots WHERE social_account_id = sa.id
           )
           WHEN 'tiktok' THEN (
             SELECT COUNT(*)::int FROM l0_raw.tt_video_snapshots WHERE social_account_id = sa.id
           )
           WHEN 'facebook' THEN (
             SELECT COUNT(*)::int FROM l0_raw.fb_post_snapshots WHERE social_account_id = sa.id
           )
         END,
         0
       ) AS "dataCount"
     FROM brands b
     JOIN brand_social_accounts bsa ON bsa.brand_id = b.id
     JOIN social_accounts sa        ON sa.id = bsa.social_account_id
     JOIN platforms p               ON p.id  = sa.platform_id
     WHERE b.organization_id = $1
       AND sa.connected = true
     ORDER BY b.created_at, p.key`,
    [orgId]
  )
  return rows
}
