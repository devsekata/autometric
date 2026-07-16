// Server-side persistence for per-organization custom metrics (table org_custom_metrics).
// The stored `definition` JSONB carries { terms, multiply100 }; name/format are columns.
// Shared by the CRUD API routes and the report metrics engine (metricsQuery).
import pool from '@/lib/db'
import type { CustomMetricDef, Term, MetricFormat, Op } from './customMetrics'

const FORMATS: MetricFormat[] = ['number', 'compact', 'percent', 'time']
const OP_IDS: Op[] = ['+', '-', '*', '/']

interface Row { id: string; name: string; format: string; definition: { terms?: Term[]; multiply100?: boolean } | null }

/** Sanitize a raw definition from the client/DB into valid terms. A term is a registry
 *  field (kind='field', needs `field`) or a literal number (kind='const', needs finite
 *  `value`). Legacy rows without `kind` are treated as fields. */
function normalizeTerms(raw: unknown): Term[] {
  if (!Array.isArray(raw)) return []
  const out: Term[] = []
  for (const t of raw) {
    const r = (t ?? {}) as Record<string, unknown>
    const op: Op = OP_IDS.includes(r.op as Op) ? (r.op as Op) : '+'
    if (r.kind === 'const') {
      const value = Number(r.value)
      if (Number.isFinite(value)) out.push({ op, kind: 'const', field: '', value })
    } else {
      const field = typeof r.field === 'string' ? r.field : ''
      if (field) out.push({ op, kind: 'field', field, value: 0 })
    }
  }
  return out
}

function rowToDef(r: Row): CustomMetricDef {
  const format = (FORMATS as string[]).includes(r.format) ? (r.format as MetricFormat) : 'number'
  return {
    id: r.id,
    name: r.name,
    terms: normalizeTerms(r.definition?.terms),
    multiply100: !!r.definition?.multiply100,
    format,
  }
}

/** All custom metrics for an org (oldest first — stable column order). */
export async function getOrgCustomMetrics(orgId: string): Promise<CustomMetricDef[]> {
  const res = await pool.query<Row>(
    `SELECT id, name, format, definition FROM org_custom_metrics
      WHERE organization_id = $1 ORDER BY created_at, id`,
    [orgId],
  )
  return res.rows.map(rowToDef)
}

export interface CustomMetricInput {
  name: string
  format: MetricFormat
  terms: Term[]
  multiply100?: boolean
}

/** Validate + coerce an incoming payload (from the API). Returns null when invalid. */
export function parseInput(body: unknown): CustomMetricInput | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const terms = normalizeTerms(b.terms)
  if (!name || name.length > 120 || terms.length === 0) return null
  const format: MetricFormat = (FORMATS as string[]).includes(b.format as string) ? (b.format as MetricFormat) : 'number'
  return { name, format, terms, multiply100: !!b.multiply100 }
}

export async function createOrgCustomMetric(orgId: string, userId: string, input: CustomMetricInput): Promise<CustomMetricDef> {
  const res = await pool.query<Row>(
    `INSERT INTO org_custom_metrics (organization_id, created_by, name, format, definition)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id, name, format, definition`,
    [orgId, userId, input.name, input.format, JSON.stringify({ terms: input.terms, multiply100: !!input.multiply100 })],
  )
  return rowToDef(res.rows[0])
}

/** Update a metric (scoped to org). Returns the updated def, or null when not found. */
export async function updateOrgCustomMetric(orgId: string, metricId: string, input: CustomMetricInput): Promise<CustomMetricDef | null> {
  const res = await pool.query<Row>(
    `UPDATE org_custom_metrics
        SET name = $3, format = $4, definition = $5::jsonb, updated_at = NOW()
      WHERE id = $2 AND organization_id = $1
     RETURNING id, name, format, definition`,
    [orgId, metricId, input.name, input.format, JSON.stringify({ terms: input.terms, multiply100: !!input.multiply100 })],
  )
  return res.rows[0] ? rowToDef(res.rows[0]) : null
}

/** Delete a metric (scoped to org). Returns true when a row was removed. */
export async function deleteOrgCustomMetric(orgId: string, metricId: string): Promise<boolean> {
  const res = await pool.query(
    `DELETE FROM org_custom_metrics WHERE id = $2 AND organization_id = $1`,
    [orgId, metricId],
  )
  return (res.rowCount ?? 0) > 0
}
