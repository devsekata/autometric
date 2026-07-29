import { Platform } from '@/lib/brands/types'

/** Platform yang punya tabel tujuan di l0_raw. Twitter/X sengaja tidak ada —
 *  GAP resmi di aturan mapping engine (komersil_rules.GAP_NOTES). */
export const CSV_PLATFORMS: Platform[] = ['instagram', 'facebook', 'tiktok']

export function isCsvPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (CSV_PLATFORMS as string[]).includes(value)
}

/** Hasil /detect untuk satu file. `category` adalah kategori INTERNAL mapping
 *  engine ('Post', 'Profile Reach', 'Audience', …) — nilai itulah yang dikirim
 *  balik saat ingest, supaya resolve_kategori meneruskannya apa adanya. */
export interface DetectedFile {
  filename: string
  title: string
  platform: Platform | null
  category: string | null
  bucket: string | null
  rows: number | null
  columns: string[]
  supported: boolean
  reason: string | null
  /** 'title' paling andal, 'structure' menengah, 'columns' paling lemah. */
  detected_from: 'title' | 'structure' | 'columns' | null
  needs_confirmation: boolean
}

export interface PlannedWrite {
  schema: string
  table: string
  rows: number
  key_cols: string[]
  columns: string[]
  sample: Record<string, unknown>[]
}

export interface IngestResult {
  file: string
  platform: string
  category: string
  ok: boolean
  error?: string
  rows?: number
  table?: string
  extra_note?: string
  dry_run?: boolean
  planned_writes?: PlannedWrite[]
  grouped_files?: string[]
  messages?: { level: string; message: string }[]
}

export interface IngestResponse {
  results: IngestResult[]
  summary: { files: number; ok: number; failed: number; rows: number; dry_run: boolean }
}

export interface CsvUploadLog {
  id: string
  batch_id: string
  platform: Platform
  category: string | null
  file_name: string
  file_size: number | null
  status: 'success' | 'failed' | 'skipped'
  rows_written: number | null
  target_table: string | null
  error_message: string | null
  data_through: string | null
  created_at: string
}

export interface BrandDataSource {
  platform: Platform
  social_account_id: string
  username: string
  /** 'api' = OAuth/Apify, 'csv' = upload manual. */
  data_source: 'api' | 'csv'
  connected: boolean
  /** Tanggal data terbaru dari riwayat upload CSV; null untuk sumber api. */
  data_through: string | null
  upload_count: number
}
