// Client helpers for the per-org custom metric library (CRUD against the API routes).
import type { CustomMetricDef, Term, MetricFormat } from './customMetrics'

export interface CustomMetricPayload {
  name: string
  format: MetricFormat
  terms: Term[]
  multiply100: boolean
}

const base = (orgId: string) => `/api/organizations/${encodeURIComponent(orgId)}/custom-metrics`

export async function listCustomMetrics(orgId: string): Promise<CustomMetricDef[]> {
  const res = await fetch(base(orgId), { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to load custom metrics')
  return res.json()
}

export async function createCustomMetric(orgId: string, body: CustomMetricPayload): Promise<CustomMetricDef> {
  const res = await fetch(base(orgId), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to create custom metric')
  return res.json()
}

export async function updateCustomMetric(orgId: string, id: string, body: CustomMetricPayload): Promise<CustomMetricDef> {
  const res = await fetch(`${base(orgId)}/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to update custom metric')
  return res.json()
}

export async function deleteCustomMetric(orgId: string, id: string): Promise<void> {
  const res = await fetch(`${base(orgId)}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete custom metric')
}
