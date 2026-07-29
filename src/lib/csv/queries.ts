import pool from '@/lib/db'
import { Platform } from '@/lib/brands/types'
import { BrandDataSource, CsvUploadLog, IngestResult } from './types'

/**
 * Buat/pakai-ulang akun bersumber CSV untuk sebuah brand.
 *
 * Sengaja TIDAK memakai `connectSocialAccount()`: fungsi itu selalu menyetel
 * `connected = true` (benar untuk OAuth, salah di sini). Akun CSV harus
 * `connected = false` supaya scheduler melewatinya — filternya
 * `WHERE sa.connected = true` di src/lib/monitoring/scheduler.ts — sekaligus
 * `data_source = 'csv'` supaya bisa dibedakan dari akun OAuth yang tokennya
 * kedaluwarsa.
 *
 * Akun di tabel ini bersifat GLOBAL per (platform, username); kepemilikan brand
 * diatur lewat jembatan brand_social_accounts. Itu aturan yang sama yang
 * dipakai mapping engine, jadi upload lewat UI dan data lama tetap menunjuk ke
 * baris akun yang sama.
 */
export async function connectCsvAccount(
  brandId: string,
  platformKey: Platform,
  username: string,
): Promise<{ id: string; username: string; is_new: boolean }> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: pRows } = await client.query<{ id: string }>(
      `SELECT id FROM platforms WHERE key = $1`, [platformKey],
    )
    if (!pRows[0]) throw new Error(`Unknown platform: ${platformKey}`)
    const platformId = pRows[0].id

    const { rows } = await client.query<{ id: string; username: string; is_new: boolean }>(
      `INSERT INTO social_accounts (platform_id, username, connected, data_source)
       VALUES ($1, $2, false, 'csv')
       ON CONFLICT (platform_id, username) DO UPDATE
         -- Jangan pernah menurunkan akun OAuth yang sudah hidup menjadi 'csv';
         -- pemanggil sudah menolak kasus itu lebih dulu (assertPlatformFree),
         -- ini pagar terakhir.
         SET data_source = CASE
               WHEN social_accounts.connected THEN social_accounts.data_source
               ELSE 'csv'
             END
       RETURNING id, username, (xmax = 0) AS is_new`,
      [platformId, username],
    )
    const sa = rows[0]

    await client.query(
      `INSERT INTO brand_social_accounts (brand_id, social_account_id, platform_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (brand_id, platform_id) DO UPDATE SET social_account_id = EXCLUDED.social_account_id`,
      [brandId, sa.id, platformId],
    )

    await client.query('COMMIT')
    return sa
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Akun yang sudah terpasang di brand ini, per platform. */
export async function getBrandAccounts(brandId: string): Promise<
  { platform: Platform; social_account_id: string; username: string; connected: boolean; data_source: 'api' | 'csv' }[]
> {
  const { rows } = await pool.query(
    `SELECT p.key AS platform, sa.id AS social_account_id, sa.username,
            sa.connected, sa.data_source
     FROM brand_social_accounts bsa
     JOIN social_accounts sa ON sa.id = bsa.social_account_id
     JOIN platforms       p  ON p.id  = sa.platform_id
     WHERE bsa.brand_id = $1
     ORDER BY p.key`,
    [brandId],
  )
  return rows
}

export class PlatformTakenError extends Error {}

/**
 * Tegakkan aturan satu platform satu sumber.
 *
 * Kalau platform ini sudah dipegang akun OAuth yang aktif, upload CSV ditolak —
 * bukan karena tidak mungkin secara teknis, tapi karena dua sumber untuk
 * tanggal yang sama membuat pertanyaan "baris mana yang benar" tidak punya
 * jawaban, dan `fetched_at` baris CSV memang diisi tanggal historis (lihat
 * komersil_rules) sehingga tabrakan tidak akan terdeteksi sebagai konflik.
 */
export async function assertPlatformFreeForCsv(brandId: string, platform: Platform): Promise<void> {
  const accounts = await getBrandAccounts(brandId)
  const existing = accounts.find(a => a.platform === platform)
  if (existing && existing.data_source === 'api' && existing.connected) {
    throw new PlatformTakenError(
      `${platform} sudah terhubung lewat akun resmi (@${existing.username}). ` +
      `Putuskan koneksinya dulu kalau ingin memakai upload CSV untuk platform ini.`
    )
  }
}

/** Tanggal data terbaru yang dibawa file — dipakai untuk penanda "data s/d". */
export function dataThroughFrom(result: IngestResult): string | null {
  const dates: string[] = []
  for (const w of result.planned_writes ?? []) {
    for (const row of w.sample ?? []) {
      for (const key of ['fetched_at', 'posted_at', 'date', 'post_date']) {
        const v = row[key]
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) dates.push(v.slice(0, 10))
      }
    }
  }
  return dates.length ? dates.sort().at(-1)! : null
}

export interface CsvUploadLogInput {
  batchId: string
  brandId: string
  socialAccountId: string | null
  platform: string
  category: string | null
  fileName: string
  fileSize: number | null
  status: 'success' | 'failed' | 'skipped'
  rowsWritten: number | null
  targetTable: string | null
  errorMessage: string | null
  dataThrough: string | null
  uploadedBy: string | null
}

export async function logCsvUploads(entries: CsvUploadLogInput[]): Promise<void> {
  if (!entries.length) return
  const cols = 13
  const values: unknown[] = []
  const chunks = entries.map((e, i) => {
    values.push(
      e.batchId, e.brandId, e.socialAccountId, e.platform, e.category,
      e.fileName, e.fileSize, e.status, e.rowsWritten, e.targetTable,
      e.errorMessage, e.dataThrough, e.uploadedBy,
    )
    const base = i * cols
    return `(${Array.from({ length: cols }, (_, k) => `$${base + k + 1}`).join(',')})`
  })
  await pool.query(
    `INSERT INTO csv_upload_logs
       (batch_id, brand_id, social_account_id, platform, category,
        file_name, file_size, status, rows_written, target_table,
        error_message, data_through, uploaded_by)
     VALUES ${chunks.join(',')}`,
    values,
  )
}

export async function getCsvUploadHistory(brandId: string, limit = 100): Promise<CsvUploadLog[]> {
  const { rows } = await pool.query<CsvUploadLog>(
    `SELECT id, batch_id, platform, category, file_name, file_size, status,
            rows_written, target_table, error_message, data_through, created_at
     FROM csv_upload_logs
     WHERE brand_id = $1
     ORDER BY created_at DESC, file_name
     LIMIT $2`,
    [brandId, limit],
  )
  return rows
}

/** Ringkasan sumber data per platform untuk tab Data Sources. */
export async function getBrandDataSources(brandId: string): Promise<BrandDataSource[]> {
  const { rows } = await pool.query<BrandDataSource>(
    `SELECT p.key AS platform,
            sa.id  AS social_account_id,
            sa.username,
            sa.data_source,
            sa.connected,
            agg.data_through,
            COALESCE(agg.upload_count, 0)::int AS upload_count
     FROM brand_social_accounts bsa
     JOIN social_accounts sa ON sa.id = bsa.social_account_id
     JOIN platforms       p  ON p.id  = sa.platform_id
     LEFT JOIN (
       SELECT social_account_id,
              MAX(data_through)                          AS data_through,
              COUNT(*) FILTER (WHERE status = 'success')  AS upload_count
       FROM csv_upload_logs
       WHERE brand_id = $1
       GROUP BY social_account_id
     ) agg ON agg.social_account_id = sa.id
     WHERE bsa.brand_id = $1
     ORDER BY p.key`,
    [brandId],
  )
  return rows
}
