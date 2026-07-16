// Shared helpers for the dashboard's custom date range.
//
// The dashboard's period control offers presets (7/30/90 days) plus "Custom".
// For presets, each tab anchors on the latest gold metric_date and walks back
// N days (see each lib's resolveWindows). For Custom, the client sends explicit
// ?start=&end= dates and we build the windows directly from them here.

export interface CustomRange { start: string; end: string }

const ISO = /^\d{4}-\d{2}-\d{2}$/

// Parse ?start=&end= (YYYY-MM-DD) from a request. Returns null unless BOTH are
// valid ISO dates; swaps them if the caller passed them reversed.
export function parseCustomRange(sp: URLSearchParams): CustomRange | null {
  const start = sp.get('start')
  const end = sp.get('end')
  if (!start || !end || !ISO.test(start) || !ISO.test(end)) return null
  return start <= end ? { start, end } : { start: end, end: start }
}

// Build the {cur, prev, mid} windows for an explicit range. `prev` is the equal-
// length window immediately before `start` (for period-over-period deltas); `mid`
// splits `cur` in half (used by the brand-matrix trend). Shape mirrors the
// anchor-based resolveWindows so the two branches are interchangeable.
export function windowsFromRange(r: CustomRange): {
  anchor: string
  cur: { start: string; end: string }
  prev: { start: string; end: string }
  mid: string
} {
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const minus = (base: Date, n: number) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() - n); return d }
  const s = new Date(r.start + 'T00:00:00Z')
  const e = new Date(r.end + 'T00:00:00Z')
  const span = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1) // inclusive days
  return {
    anchor: r.end,
    cur: { start: r.start, end: r.end },
    prev: { start: iso(minus(s, span)), end: iso(minus(s, 1)) },
    mid: iso(minus(e, Math.floor(span / 2))),
  }
}
