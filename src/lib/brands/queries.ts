import pool from '@/lib/db'
import type { Brand, SocialAccount, CompetitorAccount, Platform } from './types'

const BRAND_WITH_RELATIONS = `
  SELECT
    b.id,
    b.organization_id,
    b.name,
    b.profile_url,
    b.created_at,
    COALESCE(
      json_agg(
        json_build_object(
          'id',           sa.id,
          'platform',     p.key,
          'username',     sa.username,
          'avatar_url',   sa.avatar_url,
          'profile_url',  sa.profile_url,
          'connected',    sa.connected,
          'connected_at', bsa.created_at
        ) ORDER BY bsa.created_at
      ) FILTER (WHERE sa.id IS NOT NULL),
      '[]'
    ) AS accounts,
    COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'social_account_id', csa.id,
            'platform',          cp.key,
            'username',          csa.username,
            'avatar_url',        csa.avatar_url,
            'profile_url',       csa.profile_url
          )
        )
        FROM brand_competitors bc
        JOIN social_accounts csa ON csa.id = bc.social_account_id
        JOIN platforms cp ON cp.id = csa.platform_id
        WHERE bc.brand_id = b.id
      ),
      '[]'
    ) AS competitors
  FROM brands b
  LEFT JOIN brand_social_accounts bsa ON bsa.brand_id = b.id
  LEFT JOIN social_accounts sa ON sa.id = bsa.social_account_id
  LEFT JOIN platforms p ON p.id = sa.platform_id
`

export async function listBrandsForOrg(orgId: string): Promise<Brand[]> {
  const { rows } = await pool.query(
    `${BRAND_WITH_RELATIONS} WHERE b.organization_id = $1 AND b.deleted_at IS NULL GROUP BY b.id ORDER BY b.created_at DESC`,
    [orgId]
  )
  return rows
}

export async function getBrandById(brandId: string): Promise<Brand | null> {
  const { rows } = await pool.query(
    `${BRAND_WITH_RELATIONS} WHERE b.id = $1 AND b.deleted_at IS NULL GROUP BY b.id`,
    [brandId]
  )
  return rows[0] ?? null
}

export async function verifyBrandAccess(brandId: string, userId: string): Promise<string | null> {
  const { rows } = await pool.query<{ organization_id: string }>(
    `SELECT b.organization_id
     FROM brands b
     JOIN organization_members om
       ON om.organization_id = b.organization_id
       AND om.user_id = $2
       AND om.status = 'ACTIVE'
     WHERE b.id = $1 AND b.deleted_at IS NULL`,
    [brandId, userId]
  )
  return rows[0]?.organization_id ?? null
}

export async function getConnectedIgAccount(brandId: string): Promise<{
  id: string
  platform_user_id: string
  oauth_token: string
} | null> {
  const { rows } = await pool.query<{ id: string; platform_user_id: string; oauth_token: string }>(
    `SELECT sa.id, sa.platform_user_id, sa.oauth_token
     FROM brand_social_accounts bsa
     JOIN social_accounts sa ON sa.id = bsa.social_account_id
     JOIN platforms p        ON p.id  = sa.platform_id
     WHERE bsa.brand_id = $1
       AND p.key        = 'instagram'
       AND sa.connected = true
       AND sa.platform_user_id IS NOT NULL
       AND sa.oauth_token      IS NOT NULL
     LIMIT 1`,
    [brandId]
  )
  return rows[0] ?? null
}

export async function getConnectedTtAccount(brandId: string): Promise<{
  id: string
  oauth_token: string
} | null> {
  const { rows } = await pool.query<{ id: string; oauth_token: string }>(
    `SELECT sa.id, sa.oauth_token
     FROM brand_social_accounts bsa
     JOIN social_accounts sa ON sa.id = bsa.social_account_id
     JOIN platforms p        ON p.id  = sa.platform_id
     WHERE bsa.brand_id = $1
       AND p.key        = 'tiktok'
       AND sa.connected = true
       AND sa.oauth_token IS NOT NULL
     LIMIT 1`,
    [brandId]
  )
  return rows[0] ?? null
}

export async function getConnectedFbAccount(brandId: string): Promise<{
  id: string
  platform_user_id: string
  oauth_token: string
} | null> {
  const { rows } = await pool.query<{ id: string; platform_user_id: string; oauth_token: string }>(
    `SELECT sa.id, sa.platform_user_id, sa.oauth_token
     FROM brand_social_accounts bsa
     JOIN social_accounts sa ON sa.id = bsa.social_account_id
     JOIN platforms p        ON p.id  = sa.platform_id
     WHERE bsa.brand_id = $1
       AND p.key        = 'facebook'
       AND sa.connected = true
       AND sa.platform_user_id IS NOT NULL
       AND sa.oauth_token      IS NOT NULL
     LIMIT 1`,
    [brandId]
  )
  return rows[0] ?? null
}

export async function countBrandsForOrg(orgId: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM brands WHERE organization_id = $1 AND deleted_at IS NULL`,
    [orgId]
  )
  return rows[0]?.count ?? 0
}

export async function createBrand(orgId: string, name: string): Promise<Brand> {
  const { rows } = await pool.query<{
    id: string; organization_id: string; name: string; profile_url: string | null; created_at: string
  }>(
    `INSERT INTO brands (organization_id, name) VALUES ($1, $2)
     RETURNING id, organization_id, name, profile_url, created_at`,
    [orgId, name]
  )
  return { ...rows[0], accounts: [], competitors: [] }
}

export async function updateBrandName(brandId: string, name: string): Promise<void> {
  await pool.query(`UPDATE brands SET name = $1 WHERE id = $2`, [name, brandId])
}

// Soft delete: l2_gold declares ON DELETE RESTRICT foreign keys to public.brands
// (see scripts/add-medallion-fks.js), so a real DELETE aborts for any brand that
// has gold data. Marking `deleted_at` hides the brand from every read path while
// the analytics history stays intact. Restore with `SET deleted_at = NULL`.
export async function deleteBrand(brandId: string): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rowCount } = await client.query(
      `UPDATE brands SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [brandId]
    )
    if (!rowCount) {
      await client.query('ROLLBACK')
      return false
    }

    // Release the OAuth tokens of accounts this brand alone owned. A soft delete
    // leaves brand_social_accounts in place, so "orphaned" means no *live* brand
    // links to the account any more — the brand above is already marked deleted
    // inside this transaction, so it is excluded automatically.
    await client.query(
      `UPDATE social_accounts sa
          SET connected = false, oauth_token = NULL, token_expires_at = NULL
        WHERE sa.id IN (
                SELECT bsa.social_account_id
                  FROM brand_social_accounts bsa
                 WHERE bsa.brand_id = $1
              )
          AND NOT EXISTS (
                SELECT 1
                  FROM brand_social_accounts other
                  JOIN brands ob ON ob.id = other.brand_id AND ob.deleted_at IS NULL
                 WHERE other.social_account_id = sa.id
              )`,
      [brandId]
    )

    await client.query('COMMIT')
    return true
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function connectSocialAccount(
  brandId: string,
  platformKey: string,
  username: string,
  extra?: {
    oauthToken?: string | null
    refreshToken?: string | null
    tokenExpiresAt?: string | null
    avatarUrl?: string | null
    profileUrl?: string | null
    platformUserId?: string | null
  },
): Promise<SocialAccount & { is_new: boolean }> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: pRows } = await client.query<{ id: string }>(
      `SELECT id FROM platforms WHERE key = $1`, [platformKey]
    )
    if (!pRows[0]) throw new Error(`Unknown platform: ${platformKey}`)

    const { rows: saRows } = await client.query<{
      id: string; username: string; avatar_url: string | null; profile_url: string | null; connected: boolean; connected_at: string | null; is_new: boolean
    }>(
      `INSERT INTO social_accounts
         (platform_id, username, oauth_token, refresh_token, token_expires_at, avatar_url, profile_url, platform_user_id, connected, connected_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
       ON CONFLICT (platform_id, username) DO UPDATE
         SET connected         = true,
             connected_at      = NOW(),
             oauth_token       = COALESCE(EXCLUDED.oauth_token,       social_accounts.oauth_token),
             refresh_token     = COALESCE(EXCLUDED.refresh_token,     social_accounts.refresh_token),
             token_expires_at  = COALESCE(EXCLUDED.token_expires_at,  social_accounts.token_expires_at),
             avatar_url        = COALESCE(EXCLUDED.avatar_url,        social_accounts.avatar_url),
             profile_url       = COALESCE(EXCLUDED.profile_url,       social_accounts.profile_url),
             platform_user_id  = COALESCE(EXCLUDED.platform_user_id,  social_accounts.platform_user_id)
       RETURNING id, username, avatar_url, profile_url, connected, connected_at, (xmax = 0) AS is_new`,
      [
        pRows[0].id,
        username,
        extra?.oauthToken      ?? null,
        extra?.refreshToken    ?? null,
        extra?.tokenExpiresAt  ?? null,
        extra?.avatarUrl       ?? null,
        extra?.profileUrl      ?? null,
        extra?.platformUserId  ?? null,
      ]
    )
    const sa = saRows[0]

    await client.query(
      `INSERT INTO brand_social_accounts (brand_id, social_account_id, platform_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (brand_id, platform_id) DO UPDATE SET social_account_id = EXCLUDED.social_account_id`,
      [brandId, sa.id, pRows[0].id]
    )

    if (extra?.avatarUrl) {
      await client.query(
        `UPDATE brands SET profile_url = $1 WHERE id = $2 AND profile_url IS NULL`,
        [extra.avatarUrl, brandId]
      )
    }

    await client.query('COMMIT')
    return {
      id: sa.id,
      platform: platformKey as Platform,
      username: sa.username,
      avatar_url: sa.avatar_url,
      profile_url: sa.profile_url,
      connected: sa.connected,
      connected_at: sa.connected_at,
      is_new: sa.is_new,
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function disconnectSocialAccount(brandId: string, socialAccountId: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `DELETE FROM brand_social_accounts WHERE brand_id = $1 AND social_account_id = $2`,
      [brandId, socialAccountId]
    )
    // Clear token + mark disconnected only if no brand still owns this account
    // Competitor references do not count — they have no OAuth connection
    const { rows } = await client.query(
      `SELECT 1 FROM brand_social_accounts WHERE social_account_id = $1 LIMIT 1`,
      [socialAccountId]
    )
    if (rows.length === 0) {
      await client.query(
        `UPDATE social_accounts SET connected = false, oauth_token = NULL, token_expires_at = NULL WHERE id = $1`,
        [socialAccountId]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Competitor quota is counted per platform, so a brand can track the maximum on
// Instagram, TikTok and Facebook independently.
export async function countBrandCompetitorsOnPlatform(brandId: string, platformKey: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM brand_competitors bc
       JOIN social_accounts csa ON csa.id = bc.social_account_id
       JOIN platforms cp        ON cp.id  = csa.platform_id
      WHERE bc.brand_id = $1 AND cp.key = $2`,
    [brandId, platformKey]
  )
  return rows[0]?.count ?? 0
}

export async function addCompetitor(
  brandId: string,
  platformKey: string,
  username: string,
  profile?: {
    avatarUrl?: string | null
    profileUrl?: string | null
    platformUserId?: string | null
  },
): Promise<CompetitorAccount> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: pRows } = await client.query<{ id: string }>(
      `SELECT id FROM platforms WHERE key = $1`, [platformKey]
    )
    if (!pRows[0]) throw new Error(`Unknown platform: ${platformKey}`)

    const { rows: saRows } = await client.query<{
      id: string; username: string; avatar_url: string | null; profile_url: string | null; is_new: boolean
    }>(
      `INSERT INTO social_accounts (platform_id, username, avatar_url, profile_url, platform_user_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (platform_id, username) DO UPDATE
         SET avatar_url        = COALESCE(EXCLUDED.avatar_url,        social_accounts.avatar_url),
             profile_url       = COALESCE(EXCLUDED.profile_url,       social_accounts.profile_url),
             platform_user_id  = COALESCE(EXCLUDED.platform_user_id,  social_accounts.platform_user_id)
       RETURNING id, username, avatar_url, profile_url, (xmax = 0) AS is_new`,
      [
        pRows[0].id,
        username,
        profile?.avatarUrl ?? null,
        profile?.profileUrl ?? null,
        profile?.platformUserId ?? null,
      ]
    )
    const sa = saRows[0]

    await client.query(
      `INSERT INTO brand_competitors (brand_id, social_account_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [brandId, sa.id]
    )

    await client.query('COMMIT')
    return {
      social_account_id: sa.id,
      platform: platformKey as Platform,
      username: sa.username,
      avatar_url: sa.avatar_url,
      profile_url: sa.profile_url,
      is_new_account: sa.is_new,
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Backfill avatar / profile_url / platform_user_id after an async competitor sync
// (used by platforms whose profile is fetched in the background, e.g. Facebook via Apify).
export async function updateSocialAccountProfile(
  socialAccountId: string,
  profile: { avatarUrl?: string | null; profileUrl?: string | null; platformUserId?: string | null },
): Promise<void> {
  await pool.query(
    `UPDATE social_accounts
        SET avatar_url       = COALESCE($2, avatar_url),
            profile_url      = COALESCE($3, profile_url),
            platform_user_id = COALESCE($4, platform_user_id)
      WHERE id = $1`,
    [socialAccountId, profile.avatarUrl ?? null, profile.profileUrl ?? null, profile.platformUserId ?? null],
  )
}

export async function listBrandCompetitors(brandId: string): Promise<CompetitorAccount[]> {
  const { rows } = await pool.query<CompetitorAccount>(
    `SELECT
       csa.id          AS social_account_id,
       cp.key          AS platform,
       csa.username,
       csa.avatar_url,
       csa.profile_url
     FROM brand_competitors bc
     JOIN social_accounts csa ON csa.id = bc.social_account_id
     JOIN platforms cp        ON cp.id  = csa.platform_id
     WHERE bc.brand_id = $1`,
    [brandId],
  )
  return rows
}

export async function removeCompetitor(brandId: string, socialAccountId: string): Promise<void> {
  await pool.query(
    `DELETE FROM brand_competitors WHERE brand_id = $1 AND social_account_id = $2`,
    [brandId, socialAccountId]
  )
}
