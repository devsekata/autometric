import pool from '@/lib/db'

// A competitor social account, deduped across brands. Competitors are shared
// social_accounts (one row can be a competitor of several brands), so the
// scheduler syncs each account ONCE and attaches a representative brand/org for
// logging purposes only.
export type CompetitorSyncAccount = {
  socialAccountId: string
  platform:        string
  username:        string
  platformUserId:  string | null
  brandId:         string  // representative brand (for scheduler_logs)
  orgId:           string  // representative org   (for scheduler_logs)
}

// Snapshot table per platform — used to decide whether a competitor has ever
// been synced. social_accounts rows are shared and survive removeCompetitor
// (which only unlinks brand_competitors), so is_new_account is an unreliable
// "already synced" signal; presence of a snapshot is the real one.
const SNAPSHOT_TABLE: Record<string, string> = {
  instagram: 'l0_raw.ig_competitor_snapshots',
  facebook:  'l0_raw.fb_competitor_snapshots',
  tiktok:    'l0_raw.tiktok_competitor_snapshots',
}

export async function competitorHasSnapshot(socialAccountId: string, platform: string): Promise<boolean> {
  const table = SNAPSHOT_TABLE[platform]
  if (!table) return false
  const { rows } = await pool.query(
    `SELECT 1 FROM ${table} WHERE social_account_id = $1 LIMIT 1`,
    [socialAccountId],
  )
  return rows.length > 0
}

/**
 * Tandai akun ini terverifikasi ada.
 *
 * Meng-update SEMUA link brand yang menunjuk akun ini, bukan cuma satu: "akunnya
 * ada" itu fakta tentang akunnya, bukan tentang relasinya ke satu brand. Kalau
 * hanya satu yang di-update, brand kedua yang memantau competitor yang sama akan
 * tersangkut 'pending' selamanya — initial sync-nya di-skip karena snapshot sudah
 * ada (lihat competitorHasSnapshot).
 */
export async function markCompetitorVerified(socialAccountId: string): Promise<void> {
  await pool.query(
    `UPDATE brand_competitors
        SET verification_status = 'verified',
            verified_at        = now(),
            verification_error = NULL
      WHERE social_account_id = $1`,
    [socialAccountId],
  )
}

/** Catat alasan gagal tanpa mengubah status — dipakai untuk error transien. */
export async function recordCompetitorVerifyError(socialAccountId: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE brand_competitors
        SET verification_error = left($2, 500)
      WHERE social_account_id = $1 AND verification_status = 'pending'`,
    [socialAccountId, error],
  )
}

/**
 * Akun terbukti tidak ada → lepaskan dari SEMUA brand.
 *
 * Sengaja tidak menyentuh social_accounts: baris itu global dan bisa saja dipakai
 * sebagai akun milik sendiri. Melepas link sudah cukup untuk mengeluarkannya dari
 * scheduler (listAllCompetitorAccounts join ke brand_competitors).
 *
 * Mengembalikan jumlah link yang dihapus.
 */
export async function deleteCompetitorLinks(socialAccountId: string): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM brand_competitors WHERE social_account_id = $1`,
    [socialAccountId],
  )
  return rowCount ?? 0
}

export async function listAllCompetitorAccounts(): Promise<CompetitorSyncAccount[]> {
  const { rows } = await pool.query<CompetitorSyncAccount>(`
    SELECT DISTINCT ON (csa.id)
      csa.id               AS "socialAccountId",
      cp.key               AS platform,
      csa.username         AS username,
      csa.platform_user_id AS "platformUserId",
      bc.brand_id          AS "brandId",
      b.organization_id    AS "orgId"
    FROM brand_competitors bc
    JOIN social_accounts csa ON csa.id = bc.social_account_id
    JOIN platforms cp        ON cp.id  = csa.platform_id
    JOIN brands b            ON b.id   = bc.brand_id AND b.deleted_at IS NULL
    ORDER BY csa.id
  `)
  return rows
}
