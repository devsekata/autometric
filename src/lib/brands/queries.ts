import pool from '@/lib/db'
import type { Brand, SocialAccount, CompetitorAccount, Platform } from './types'

const BRAND_WITH_RELATIONS = `
  SELECT
    b.id,
    b.organization_id,
    b.name,
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
          'connected_at', sa.connected_at
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
    `${BRAND_WITH_RELATIONS} WHERE b.organization_id = $1 GROUP BY b.id ORDER BY b.created_at DESC`,
    [orgId]
  )
  return rows
}

export async function getBrandById(brandId: string): Promise<Brand | null> {
  const { rows } = await pool.query(
    `${BRAND_WITH_RELATIONS} WHERE b.id = $1 GROUP BY b.id`,
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
     WHERE b.id = $1`,
    [brandId, userId]
  )
  return rows[0]?.organization_id ?? null
}

export async function createBrand(orgId: string, name: string): Promise<Brand> {
  const { rows } = await pool.query<{
    id: string; organization_id: string; name: string; created_at: string
  }>(
    `INSERT INTO brands (organization_id, name) VALUES ($1, $2)
     RETURNING id, organization_id, name, created_at`,
    [orgId, name]
  )
  return { ...rows[0], accounts: [], competitors: [] }
}

export async function updateBrandName(brandId: string, name: string): Promise<void> {
  await pool.query(`UPDATE brands SET name = $1 WHERE id = $2`, [name, brandId])
}

export async function deleteBrand(brandId: string): Promise<void> {
  await pool.query(`DELETE FROM brands WHERE id = $1`, [brandId])
}

export async function connectSocialAccount(
  brandId: string,
  platformKey: string,
  username: string,
): Promise<SocialAccount> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: pRows } = await client.query<{ id: string }>(
      `SELECT id FROM platforms WHERE key = $1`, [platformKey]
    )
    if (!pRows[0]) throw new Error(`Unknown platform: ${platformKey}`)

    const { rows: saRows } = await client.query<{
      id: string; username: string; avatar_url: string | null; profile_url: string | null; connected: boolean; connected_at: string | null
    }>(
      `INSERT INTO social_accounts (platform_id, username, connected, connected_at)
       VALUES ($1, $2, true, NOW())
       ON CONFLICT (platform_id, username) DO UPDATE
         SET connected = true, connected_at = NOW()
       RETURNING id, username, avatar_url, profile_url, connected, connected_at`,
      [pRows[0].id, username]
    )
    const sa = saRows[0]

    await client.query(
      `INSERT INTO brand_social_accounts (brand_id, social_account_id, platform_id)
       VALUES ($1, $2, $3)`,
      [brandId, sa.id, pRows[0].id]
    )

    await client.query('COMMIT')
    return {
      id: sa.id,
      platform: platformKey as Platform,
      username: sa.username,
      avatar_url: sa.avatar_url,
      profile_url: sa.profile_url,
      connected: sa.connected,
      connected_at: sa.connected_at,
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function disconnectSocialAccount(brandId: string, socialAccountId: string): Promise<void> {
  await pool.query(
    `DELETE FROM brand_social_accounts WHERE brand_id = $1 AND social_account_id = $2`,
    [brandId, socialAccountId]
  )
}

export async function addCompetitor(
  brandId: string,
  platformKey: string,
  username: string,
): Promise<CompetitorAccount> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: pRows } = await client.query<{ id: string }>(
      `SELECT id FROM platforms WHERE key = $1`, [platformKey]
    )
    if (!pRows[0]) throw new Error(`Unknown platform: ${platformKey}`)

    const { rows: saRows } = await client.query<{
      id: string; username: string; avatar_url: string | null; profile_url: string | null
    }>(
      `INSERT INTO social_accounts (platform_id, username)
       VALUES ($1, $2)
       ON CONFLICT (platform_id, username) DO UPDATE SET username = EXCLUDED.username
       RETURNING id, username, avatar_url, profile_url`,
      [pRows[0].id, username]
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
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function removeCompetitor(brandId: string, socialAccountId: string): Promise<void> {
  await pool.query(
    `DELETE FROM brand_competitors WHERE brand_id = $1 AND social_account_id = $2`,
    [brandId, socialAccountId]
  )
}
