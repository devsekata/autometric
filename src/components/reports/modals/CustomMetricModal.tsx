'use client'

import { useEffect, useState } from 'react'
import {
  CustomMetricDef, MetricFormat, MetricField, Term, Op, OPS,
  METRIC_FIELDS, LAYER_LABEL, FieldLayer,
  previewValue, formatMetric, formulaText, isDefinitionValid, hasMixedPrecedence,
} from '@/lib/reports/data/customMetrics'
import { createCustomMetric, updateCustomMetric, deleteCustomMetric } from '@/lib/reports/data/customMetricsApi'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

const FORMATS: { id: MetricFormat; label: string }[] = [
  { id: 'number', label: 'Number' },
  { id: 'compact', label: 'Compact (1.2K)' },
  { id: 'percent', label: 'Percent (%)' },
  { id: 'time', label: 'Time (s)' },
]

// Fields grouped by layer for the operand dropdown.
const FIELDS_BY_LAYER: [FieldLayer, MetricField[]][] = (['l1', 'l2', 'derived'] as FieldLayer[])
  .map(l => [l, METRIC_FIELDS.filter(f => f.layer === l)] as [FieldLayer, MetricField[]])
  .filter(([, fs]) => fs.length > 0)

type Draft = {
  id: string | null
  name: string
  terms: Term[]
  multiply100: boolean
  format: MetricFormat
}

const blankDraft = (): Draft => ({
  id: null, name: '', terms: [{ op: '+', kind: 'field', field: '', value: 0 }], multiply100: false, format: 'number',
})

const draftFrom = (m: CustomMetricDef): Draft => ({
  id: m.id, name: m.name, terms: m.terms.map(t => ({ ...t })),
  multiply100: m.multiply100 ?? false, format: m.format,
})

/**
 * Custom Metric library + free-expression builder (UI). Two views:
 *   list  → the org's saved custom metrics (create / edit / delete)
 *   edit  → chain l1/l2 fields with operators (+ − × ÷), × 100 modifier, live preview
 * `metrics` is the current org library (loaded by the parent); create/update/delete go
 * straight to the API, and `onChanged` tells the parent to refetch. The live preview uses
 * each field's sample value (no DB call).
 */
export default function CustomMetricModal({
  open, orgId, metrics, onClose, onChanged,
}: {
  open: boolean
  orgId: string
  metrics: CustomMetricDef[]
  onClose: () => void
  onChanged: () => void
}) {
  const [view, setView] = useState<'list' | 'edit'>('list')
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setView('list'); setDraft(blankDraft()); setBusy(false); setError(null) }
  }, [open])

  if (!open) return null

  const valid = draft.name.trim().length > 0 && isDefinitionValid(draft)

  const startCreate = () => { setError(null); setDraft(blankDraft()); setView('edit') }
  const startEdit = (m: CustomMetricDef) => { setError(null); setDraft(draftFrom(m)); setView('edit') }

  const remove = async (id: string) => {
    setBusy(true); setError(null)
    try { await deleteCustomMetric(orgId, id); onChanged() }
    catch { setError('Could not delete the metric.') }
    finally { setBusy(false) }
  }

  const save = async () => {
    if (!valid || busy) return
    const payload = {
      name: draft.name.trim(), format: draft.format,
      terms: draft.terms.map(t => ({ ...t })), multiply100: draft.multiply100,
    }
    setBusy(true); setError(null)
    try {
      if (draft.id) await updateCustomMetric(orgId, draft.id, payload)
      else await createCustomMetric(orgId, payload)
      onChanged()
      setView('list')
    } catch { setError('Could not save the metric.') }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className="absolute inset-0 bg-[#0f172a]/50 backdrop-blur-sm" />
      <div onClick={e => e.stopPropagation()} className="relative w-full max-w-[640px] h-[560px] rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.30)] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 px-6 border-b border-[#f0f1f2] flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            {view === 'edit' && (
              <button onClick={() => setView('list')} className="p-1.5 -ml-1.5 rounded-lg hover:bg-[#f1f5f9] transition-colors">
                <span className="material-symbols-outlined text-[18px] text-[#94a3b8]">arrow_back</span>
              </button>
            )}
            <div>
              <h3 style={PJ} className="font-bold text-[16px] text-[#0f172a]">
                {view === 'list' ? 'Custom Metrics' : draft.id ? 'Edit Custom Metric' : 'New Custom Metric'}
              </h3>
              <p className="text-[12px] text-[#94a3b8] mt-0.5">
                {view === 'list'
                  ? 'Reusable across this organization’s reports.'
                  : 'Chain fields with operators to build any calculation.'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#94a3b8] hover:text-[#334155] hover:bg-[#f1f5f9] transition-colors">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {view === 'list' ? (
          <ListView metrics={metrics} busy={busy} error={error} onCreate={startCreate} onEdit={startEdit} onDelete={remove} onClose={onClose} />
        ) : (
          <EditView draft={draft} valid={valid} busy={busy} error={error} setDraft={setDraft} onCancel={() => setView('list')} onSave={save} />
        )}
      </div>
    </div>
  )
}

/* ── list view ─────────────────────────────────────────────────────────────────── */
function ListView({
  metrics, busy, error, onCreate, onEdit, onDelete, onClose,
}: {
  metrics: CustomMetricDef[]
  busy: boolean
  error: string | null
  onCreate: () => void
  onEdit: (m: CustomMetricDef) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 px-6">
        {metrics.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-8">
            <span className="material-symbols-outlined text-[40px] text-[#cbd5e1] mb-2">calculate</span>
            <p style={PJ} className="text-[13.5px] font-bold text-[#475569]">No custom metrics yet</p>
            <p className="text-[12px] text-[#94a3b8] mt-1 max-w-[340px] leading-snug">
              Chain fields with + − × ÷ to build any calculation — e.g. Likes + Comments − Shares —
              and it becomes available as a table column.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {metrics.map(m => (
              <div key={m.id} className="group flex items-center gap-3 p-3 rounded-xl border border-[#eef0f2] hover:border-[#d7dde3] hover:bg-[#fafbfb] transition-all">
                <span className="w-9 h-9 shrink-0 rounded-lg bg-[#EAF2F6] flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px] text-[#327488]">calculate</span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span style={PJ} className="text-[13px] font-bold text-[#334155] truncate">{m.name}</span>
                    <span className="text-[9.5px] font-semibold uppercase tracking-wide text-[#94a3b8] bg-[#f1f5f9] rounded px-1.5 py-0.5">{m.format}</span>
                  </div>
                  <p className="text-[11px] text-[#94a3b8] truncate font-mono mt-0.5">{formulaText(m)}</p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => onEdit(m)} disabled={busy} className="w-7 h-7 flex items-center justify-center rounded-lg text-[#94a3b8] hover:text-[#327488] hover:bg-[#EAF2F6] disabled:opacity-40">
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                  </button>
                  <button onClick={() => onDelete(m.id)} disabled={busy} className="w-7 h-7 flex items-center justify-center rounded-lg text-[#94a3b8] hover:text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-40">
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="p-4 px-6 border-t border-[#f0f1f2] flex justify-between items-center">
        <div className="flex items-center gap-3">
          <button onClick={onCreate} disabled={busy} style={PJ} className="flex items-center gap-1.5 px-4 py-2.5 bg-[#327488] text-white text-[12.5px] font-bold rounded-lg hover:bg-[#285D6E] disabled:opacity-50 transition-colors">
            <span className="material-symbols-outlined text-[17px]">add</span>
            Create custom metric
          </button>
          {error && <span className="text-[11.5px] text-[#dc2626]">{error}</span>}
        </div>
        <button onClick={onClose} style={PJ} className="px-4 py-2.5 text-[12.5px] font-semibold text-[#6b7280] hover:bg-[#f3f4f6] rounded-lg transition-colors">Done</button>
      </div>
    </>
  )
}

/* ── field dropdown (shared) ───────────────────────────────────────────────────── */
function FieldSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="relative flex-1 min-w-0">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={PJ}
        className="w-full appearance-none px-3 py-2.5 pr-8 rounded-lg border border-[#e5e7eb] bg-white text-[12.5px] text-[#334155] outline-none focus:border-[#327488] focus:ring-1 focus:ring-[#327488] transition-all"
      >
        <option value="">Select a field…</option>
        {FIELDS_BY_LAYER.map(([layer, fields]) => (
          <optgroup key={layer} label={LAYER_LABEL[layer]}>
            {fields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </optgroup>
        ))}
      </select>
      <span className="material-symbols-outlined text-[18px] text-[#94a3b8] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">expand_more</span>
    </div>
  )
}

/* ── edit / builder view ───────────────────────────────────────────────────────── */
function EditView({
  draft, valid, busy, error, setDraft, onCancel, onSave,
}: {
  draft: Draft
  valid: boolean
  busy: boolean
  error: string | null
  setDraft: React.Dispatch<React.SetStateAction<Draft>>
  onCancel: () => void
  onSave: () => void
}) {
  const preview = previewValue(draft)
  const mixed = hasMixedPrecedence(draft.terms)

  const setTerm = (i: number, patch: Partial<Term>) =>
    setDraft(d => ({ ...d, terms: d.terms.map((t, j) => (j === i ? { ...t, ...patch } : t)) }))
  const addTerm = () => setDraft(d => ({ ...d, terms: [...d.terms, { op: '+', kind: 'field', field: '', value: 0 }] }))
  const removeTerm = (i: number) =>
    setDraft(d => ({ ...d, terms: d.terms.length > 1 ? d.terms.filter((_, j) => j !== i) : d.terms }))

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 px-6 space-y-5">
        {/* Name */}
        <div>
          <label style={PJ} className="block text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">Metric name</label>
          <input
            value={draft.name}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            placeholder="e.g. Interaction Score"
            style={PJ}
            className="w-full px-3 py-2.5 rounded-lg border border-[#e5e7eb] text-[13px] text-[#334155] placeholder:text-[#cbd5e1] outline-none focus:border-[#327488] focus:ring-1 focus:ring-[#327488] transition-all"
          />
        </div>

        {/* Expression builder */}
        <div>
          <label style={PJ} className="block text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] mb-2">Calculation</label>
          <div className="space-y-2">
            {draft.terms.map((term, i) => (
              <div key={i} className="flex items-center gap-2">
                {/* operator (hidden for the first operand) */}
                {i === 0 ? (
                  <span className="w-11 shrink-0 text-center text-[11px] font-semibold text-[#cbd5e1]">start</span>
                ) : (
                  <div className="relative w-11 shrink-0">
                    <select
                      value={term.op}
                      onChange={e => setTerm(i, { op: e.target.value as Op })}
                      className="w-full appearance-none text-center px-1 py-2.5 rounded-lg border border-[#e5e7eb] bg-white text-[15px] font-bold text-[#327488] outline-none focus:border-[#327488] focus:ring-1 focus:ring-[#327488] cursor-pointer"
                    >
                      {OPS.map(o => <option key={o.id} value={o.id}>{o.symbol}</option>)}
                    </select>
                  </div>
                )}
                {/* operand type: field or a literal number */}
                <div className="flex shrink-0 rounded-lg border border-[#e5e7eb] overflow-hidden h-[40px]">
                  <button
                    onClick={() => setTerm(i, { kind: 'field' })}
                    title="Use a field"
                    className={`w-8 flex items-center justify-center transition-colors ${term.kind === 'field' ? 'bg-[#327488] text-white' : 'text-[#94a3b8] hover:bg-[#f1f5f9]'}`}
                  >
                    <span className="material-symbols-outlined text-[17px]">database</span>
                  </button>
                  <button
                    onClick={() => setTerm(i, { kind: 'const' })}
                    title="Use a number"
                    style={PJ}
                    className={`w-8 flex items-center justify-center text-[11px] font-extrabold border-l border-[#e5e7eb] transition-colors ${term.kind === 'const' ? 'bg-[#327488] text-white' : 'text-[#94a3b8] hover:bg-[#f1f5f9]'}`}
                  >
                    123
                  </button>
                </div>
                {term.kind === 'const' ? (
                  <input
                    type="number"
                    value={term.value}
                    onChange={e => setTerm(i, { value: Number(e.target.value) })}
                    placeholder="0"
                    style={PJ}
                    className="flex-1 min-w-0 px-3 py-2.5 rounded-lg border border-[#e5e7eb] bg-white text-[12.5px] text-[#334155] outline-none focus:border-[#327488] focus:ring-1 focus:ring-[#327488]"
                  />
                ) : (
                  <FieldSelect value={term.field} onChange={id => setTerm(i, { field: id })} />
                )}
                <button
                  onClick={() => removeTerm(i)}
                  disabled={draft.terms.length <= 1}
                  className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-[#b6bcc4] hover:text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#b6bcc4] transition-colors"
                  title="Remove"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            ))}
          </div>
          <button onClick={addTerm} style={PJ} className="mt-2 flex items-center gap-1 text-[11.5px] font-semibold text-[#327488] hover:underline">
            <span className="material-symbols-outlined text-[15px]">add</span>
            Add field
          </button>
          {mixed && (
            <p className="mt-2 flex items-start gap-1 text-[10.5px] text-[#94a3b8] leading-snug">
              <span className="material-symbols-outlined text-[13px] mt-px">info</span>
              Evaluated left → right (no operator precedence): {formulaText({ terms: draft.terms })} is computed in order.
            </p>
          )}
        </div>

        {/* Format */}
        <div>
          <label style={PJ} className="block text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">Format</label>
          <div className="relative">
            <select
              value={draft.format}
              onChange={e => setDraft(d => ({ ...d, format: e.target.value as MetricFormat }))}
              style={PJ}
              className="w-full appearance-none px-3 py-2.5 pr-8 rounded-lg border border-[#e5e7eb] bg-white text-[12.5px] text-[#334155] outline-none focus:border-[#327488] focus:ring-1 focus:ring-[#327488]"
            >
              {FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <span className="material-symbols-outlined text-[18px] text-[#94a3b8] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">expand_more</span>
          </div>
        </div>

        {/* Live preview */}
        <div className="rounded-xl border border-[#e5e7eb] bg-[#fafbfb] p-4">
          <div className="flex items-center justify-between mb-2">
            <span style={PJ} className="text-[11px] font-bold uppercase tracking-wider text-[#94a3b8]">Live preview</span>
            <span className="text-[10px] text-[#b0b8c1]">sample data</span>
          </div>
          <p className="text-[12.5px] font-mono text-[#475569]">{formulaText(draft)}</p>
          <p style={PJ} className="text-[26px] font-extrabold text-[#327488] mt-1 leading-none">
            {formatMetric(draft.format, preview)}
          </p>
        </div>
      </div>

      <div className="p-4 px-6 border-t border-[#f0f1f2] flex justify-end items-center gap-2">
        {error && <span className="text-[11.5px] text-[#dc2626] mr-auto">{error}</span>}
        <button onClick={onCancel} style={PJ} className="px-4 py-2.5 text-[12.5px] font-semibold text-[#6b7280] hover:bg-[#f3f4f6] rounded-lg transition-colors">Cancel</button>
        <button
          onClick={onSave}
          disabled={!valid || busy}
          style={PJ}
          className="px-5 py-2.5 bg-[#327488] text-white text-[12.5px] font-bold rounded-lg hover:bg-[#285D6E] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? 'Saving…' : draft.id ? 'Save changes' : 'Save metric'}
        </button>
      </div>
    </>
  )
}
