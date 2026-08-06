import pool from '@/lib/db'
import type { ReportRecord } from './data/history'
import type { CoverColors, CoverMode } from './cover/colors'
import type { ReportTemplateConfig, ReportTemplateRecord } from './data/slideModel'

// Render/display details persisted in the `config` JSONB column. These are what
// the history card needs to re-render a live cover thumbnail.
export interface ReportExportConfig {
  subtitle: string
  brandId: string
  templateId: string
  mode: CoverMode
  colors: CoverColors
  month: string
  year: number
}

export interface InsertReportExportInput {
  organizationId: string
  createdBy: string
  name: string
  title: string
  brandName: string
  period: string
  slideCount: number
  gcsObjectName: string
  sizeBytes: number
  config: ReportExportConfig
  coverImageUrl?: string | null
  coverPublicId?: string | null
}

interface ReportExportRow {
  id: string
  name: string | null
  title: string
  brand_name: string | null
  period: string | null
  slide_count: number
  gcs_object_name: string
  size_bytes: string | null
  config: ReportExportConfig
  cover_image_url: string | null
  exported_at: string
}

function toRecord(row: ReportExportRow): ReportRecord {
  const c = row.config ?? ({} as ReportExportConfig)
  return {
    id: row.id,
    name: row.name ?? row.title,
    title: row.title,
    subtitle: c.subtitle ?? '',
    brandId: c.brandId ?? '',
    templateId: c.templateId ?? 'diagonal',
    mode: c.mode ?? 'light',
    colors: c.colors ?? { primary: '#327488', secondary: '#285D6E', accent: '#e0a458' },
    month: c.month ?? '',
    year: c.year ?? new Date(row.exported_at).getFullYear(),
    exportedAt: new Date(row.exported_at).getTime(),
    sizeKb: Math.round(Number(row.size_bytes ?? 0) / 1024),
    coverImageUrl: row.cover_image_url ?? undefined,
  }
}

/** Lists a single org's report exports, newest first, mapped to UI records. */
export async function listReportExports(orgId: string): Promise<ReportRecord[]> {
  const { rows } = await pool.query<ReportExportRow>(
    `SELECT id, name, title, brand_name, period, slide_count, gcs_object_name, size_bytes, config, cover_image_url, exported_at
     FROM report_exports
     WHERE organization_id = $1
     ORDER BY exported_at DESC`,
    [orgId],
  )
  return rows.map(toRecord)
}

/**
 * Next sequence number for a (org, brand, period) — 1 the first time, 2 when one
 * already exists, etc. `period` is "May 2026". Used to name the cover image
 * `brand_month-year_N`.
 */
export async function nextCoverSequence(orgId: string, brandName: string, period: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM report_exports
     WHERE organization_id = $1 AND brand_name = $2 AND period = $3`,
    [orgId, brandName, period],
  )
  return Number(rows[0]?.count ?? 0) + 1
}

export async function insertReportExport(input: InsertReportExportInput): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO report_exports
       (organization_id, created_by, name, title, brand_name, period, slide_count,
        gcs_object_name, size_bytes, config, cover_image_url, cover_public_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      input.organizationId,
      input.createdBy,
      input.name,
      input.title,
      input.brandName,
      input.period,
      input.slideCount,
      input.gcsObjectName,
      input.sizeBytes,
      JSON.stringify(input.config),
      input.coverImageUrl ?? null,
      input.coverPublicId ?? null,
    ],
  )
  return rows[0].id
}

/** Returns the GCS object name + title for one export within an org, or null. */
export async function getReportExport(
  orgId: string,
  id: string,
): Promise<{ gcsObjectName: string; title: string } | null> {
  const { rows } = await pool.query<{ gcs_object_name: string; title: string }>(
    `SELECT gcs_object_name, title FROM report_exports
     WHERE id = $1 AND organization_id = $2`,
    [id, orgId],
  )
  return rows[0] ? { gcsObjectName: rows[0].gcs_object_name, title: rows[0].title } : null
}

/** Deletes a row (scoped to org); returns its GCS object + Cloudinary id, or null. */
export async function deleteReportExport(
  orgId: string,
  id: string,
): Promise<{ gcsObjectName: string; coverPublicId: string | null } | null> {
  const { rows } = await pool.query<{ gcs_object_name: string; cover_public_id: string | null }>(
    `DELETE FROM report_exports
     WHERE id = $1 AND organization_id = $2
     RETURNING gcs_object_name, cover_public_id`,
    [id, orgId],
  )
  return rows[0]
    ? { gcsObjectName: rows[0].gcs_object_name, coverPublicId: rows[0].cover_public_id }
    : null
}

/* ─────────────────────────  REPORT TEMPLATES  ───────────────────────── */
// Reusable report structure (cover style + slides), org-scoped, no brand/period/data.

export interface InsertReportTemplateInput {
  organizationId: string
  createdBy: string
  name: string
  sourceBrandName: string | null
  config: ReportTemplateConfig
}

interface ReportTemplateRow {
  id: string
  name: string
  source_brand_name: string | null
  slide_count: number
  config: ReportTemplateConfig
  created_at: string
}

function toTemplateRecord(row: ReportTemplateRow): ReportTemplateRecord {
  const slides = row.config?.slides ?? []
  return {
    id: row.id,
    name: row.name,
    sourceBrandName: row.source_brand_name,
    slideCount: row.slide_count,
    slideTypes: slides.map(s => s.type),
    config: row.config,
    createdAt: new Date(row.created_at).getTime(),
  }
}

/** Lists a single org's report templates, newest first. */
export async function listReportTemplates(orgId: string): Promise<ReportTemplateRecord[]> {
  const { rows } = await pool.query<ReportTemplateRow>(
    `SELECT id, name, source_brand_name, slide_count, config, created_at
     FROM report_templates
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [orgId],
  )
  return rows.map(toTemplateRecord)
}

export async function insertReportTemplate(input: InsertReportTemplateInput): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO report_templates
       (organization_id, created_by, name, source_brand_name, slide_count, config)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.organizationId,
      input.createdBy,
      input.name,
      input.sourceBrandName,
      input.config.slides?.length ?? 0,
      JSON.stringify(input.config),
    ],
  )
  return rows[0].id
}

/** Deletes a template (scoped to org); returns true when a row was removed. */
export async function deleteReportTemplate(orgId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM report_templates WHERE id = $1 AND organization_id = $2`,
    [id, orgId],
  )
  return (rowCount ?? 0) > 0
}
