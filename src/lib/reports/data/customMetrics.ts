// Custom Metric — client-safe types, the operand "field registry", and a pure preview
// evaluator. UI (v1): a custom metric is a FREE EXPRESSION — a chain of l1/l2 fields
// joined by user-chosen operators (+ − × ÷), evaluated LEFT-TO-RIGHT, with an optional
// × 100 modifier and a display format. e.g.  Likes + Comments − Shares,  Saves ÷ Reach × 100.
//
// The real DB engine (resolving each field to a period scalar via its declared `agg`,
// then replaying the same left-to-right evaluation) comes later; the shapes here are
// what that engine will consume. Operands are drawn from the clean layers, never raw l0:
//   - l1_silver.unified_post      → per-post grain (likes, reach, er_*, …)
//   - l2_gold.brand_metric_daily  → daily / profile grain (followers, growth, …)
//   - derived                     → period-level helpers (total posts)
import { groupInt } from './format'
import { compactNum } from './chartTypes'

export type MetricFormat = 'number' | 'compact' | 'percent' | 'time'
export type FieldLayer = 'l1' | 'l2' | 'derived'
export type FieldGrain = 'post' | 'day' | 'period'
export type FieldAgg = 'sum' | 'avg' | 'last' | 'count'

/**
 * One base field usable as an operand. `agg` is how it collapses to a single number for
 * the period (SUM of per-post counts, AVG of per-post rates, LAST end-of-day followers)
 * — declared per field so a custom metric's semantics are fixed and deterministic.
 * `sample` powers the builder's live preview (no DB call in the UI).
 */
export interface MetricField {
  id: string
  label: string
  layer: FieldLayer
  grain: FieldGrain
  agg: FieldAgg
  format: MetricFormat
  sample: number
}

// ── the field registry (curated whitelist — the formal version of what metricsQuery
//    already reads today). Grouped by layer for the operand dropdown. ───────────────
export const METRIC_FIELDS: MetricField[] = [
  // l1_silver.unified_post — per-post grain
  { id: 'likes',        label: 'Likes',              layer: 'l1', grain: 'post', agg: 'sum', format: 'number',  sample: 8200 },
  { id: 'comments',     label: 'Comments',           layer: 'l1', grain: 'post', agg: 'sum', format: 'number',  sample: 640 },
  { id: 'shares',       label: 'Shares',             layer: 'l1', grain: 'post', agg: 'sum', format: 'number',  sample: 210 },
  { id: 'saves',        label: 'Saves',              layer: 'l1', grain: 'post', agg: 'sum', format: 'number',  sample: 430 },
  { id: 'engagement',   label: 'Engagement',         layer: 'l1', grain: 'post', agg: 'sum', format: 'compact', sample: 9480 },
  { id: 'reach',        label: 'Reach',              layer: 'l1', grain: 'post', agg: 'sum', format: 'compact', sample: 128000 },
  { id: 'views',        label: 'Views',              layer: 'l1', grain: 'post', agg: 'sum', format: 'compact', sample: 95000 },
  { id: 'impressions',  label: 'Impressions',        layer: 'l1', grain: 'post', agg: 'sum', format: 'compact', sample: 156000 },
  { id: 'er_reach',     label: 'ER (Reach)',         layer: 'l1', grain: 'post', agg: 'avg', format: 'percent', sample: 7.4 },
  { id: 'er_followers', label: 'ER (Followers)',     layer: 'l1', grain: 'post', agg: 'avg', format: 'percent', sample: 3.1 },
  { id: 'watch_time',   label: 'Avg. Watch Time',    layer: 'l1', grain: 'post', agg: 'avg', format: 'time',    sample: 12.5 },
  // l2_gold.brand_metric_daily — daily / profile grain
  { id: 'followers',    label: 'Total Followers',    layer: 'l2', grain: 'day', agg: 'last', format: 'compact', sample: 48200 },
  { id: 'net_growth',   label: 'Followers Net Growth', layer: 'l2', grain: 'day', agg: 'sum', format: 'number', sample: 1250 },
  { id: 'new_follows',  label: 'New Followers',      layer: 'l2', grain: 'day', agg: 'sum',  format: 'number',  sample: 1800 },
  { id: 'profile_views', label: 'Profile Views',     layer: 'l2', grain: 'day', agg: 'sum',  format: 'number',  sample: 5600 },
  { id: 'profile_reach', label: 'Profile Reach',     layer: 'l2', grain: 'day', agg: 'sum',  format: 'compact', sample: 72000 },
  { id: 'video_views',  label: 'Video Views',        layer: 'l2', grain: 'day', agg: 'sum',  format: 'compact', sample: 210000 },
  // derived — period grain
  { id: 'total_posts',  label: 'Total Posts',        layer: 'derived', grain: 'period', agg: 'count', format: 'number', sample: 42 },
]

export const FIELD_BY_ID: Record<string, MetricField> = Object.fromEntries(METRIC_FIELDS.map(f => [f.id, f]))

export const LAYER_LABEL: Record<FieldLayer, string> = {
  l1: 'Per-post · l1_silver',
  l2: 'Daily / profile · l2_gold',
  derived: 'Derived',
}

// ── operators + free expression ─────────────────────────────────────────────────────
export type Op = '+' | '-' | '*' | '/'
export const OPS: { id: Op; symbol: string }[] = [
  { id: '+', symbol: '+' },
  { id: '-', symbol: '−' },
  { id: '*', symbol: '×' },
  { id: '/', symbol: '÷' },
]
export const OP_SYMBOL: Record<Op, string> = Object.fromEntries(OPS.map(o => [o.id, o.symbol])) as Record<Op, string>

/** One operand in the chain: a registry field (kind='field') OR a literal number
 *  (kind='const'). `op` joins it to the running result; the FIRST operand's `op` is
 *  ignored (it seeds the accumulator). For a field operand `value` is unused; for a
 *  constant operand `field` is unused. */
export interface Term { op: Op; kind: 'field' | 'const'; field: string; value: number }

/** A saved custom metric — the shape that will live in the per-org library. */
export interface CustomMetricDef {
  id: string
  name: string
  terms: Term[]            // evaluated left-to-right; terms[0].op ignored
  multiply100?: boolean    // × 100 (→ percentage), applied last
  format: MetricFormat
}

/** True when the expression mixes add/sub with mul/div — left-to-right then matters. */
export function hasMixedPrecedence(terms: Term[]): boolean {
  const addSub = terms.slice(1).some(t => t.op === '+' || t.op === '-')
  const mulDiv = terms.slice(1).some(t => t.op === '*' || t.op === '/')
  return addSub && mulDiv
}

// ── formatting + preview evaluation (pure, sample-based — no DB) ─────────────────────
export function formatMetric(format: MetricFormat, v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (format === 'percent') return (Math.round(v * 100) / 100) + '%'
  if (format === 'time') return (Math.round(v * 10) / 10) + 's'
  if (format === 'compact') return compactNum(v)
  return groupInt(v)
}

const sampleOf = (fieldId: string | undefined): number | null =>
  fieldId && FIELD_BY_ID[fieldId] ? FIELD_BY_ID[fieldId].sample : null

const applyOp = (acc: number, op: Op, v: number): number | null => {
  switch (op) {
    case '+': return acc + v
    case '-': return acc - v
    case '*': return acc * v
    case '/': return v === 0 ? null : acc / v
  }
}

// A term's numeric value: the literal for a constant, else the resolved field value.
const operandValue = (t: Term, resolve: (fieldId: string) => number | null): number | null =>
  t.kind === 'const' ? (Number.isFinite(t.value) ? t.value : null) : resolve(t.field)

/**
 * Evaluate the expression LEFT-TO-RIGHT using a caller-supplied resolver (fieldId → value).
 * Shared by the live preview (sample values) and the real DB engine (period scalars), so
 * both run identical arithmetic. Returns null when any operand is missing/unresolved, or on
 * a divide-by-zero (→ renders "—").
 */
export function evaluateExpression(
  terms: Term[],
  multiply100: boolean | undefined,
  resolve: (fieldId: string) => number | null,
): number | null {
  if (!terms || !terms.length) return null
  let acc = operandValue(terms[0], resolve)
  if (acc == null) return null
  for (let i = 1; i < terms.length; i++) {
    const v = operandValue(terms[i], resolve)
    if (v == null) return null
    const next = applyOp(acc, terms[i].op, v)
    if (next == null) return null
    acc = next
  }
  return multiply100 ? acc * 100 : acc
}

/** Preview value against the fields' sample values (no DB) — used by the builder. */
export function previewValue(def: { terms: Term[]; multiply100?: boolean }): number | null {
  return evaluateExpression(def.terms ?? [], def.multiply100, sampleOf)
}

/** Whether every operand is complete (field chosen or a finite number) and there's ≥1. */
export function isDefinitionValid(def: { terms: Term[] }): boolean {
  const terms = def.terms ?? []
  return terms.length > 0 && terms.every(t => (t.kind === 'const' ? Number.isFinite(t.value) : !!t.field))
}

/** Human-readable expression with field labels + literal numbers (placeholders when empty). */
export function formulaText(def: { terms: Term[]; multiply100?: boolean }): string {
  const terms = def.terms ?? []
  if (!terms.length) return '…'
  const label = (t: Term) => t.kind === 'const' ? String(t.value) : (FIELD_BY_ID[t.field]?.label ?? '…')
  let s = label(terms[0])
  for (let i = 1; i < terms.length; i++) s += ` ${OP_SYMBOL[terms[i].op]} ${label(terms[i])}`
  return def.multiply100 ? `${s} × 100` : s
}
