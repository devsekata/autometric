/** Shared helpers for the Discover query layer. */

/**
 * node-pg hydrates `timestamp`/`timestamptz` columns into JS `Date` objects, not
 * strings. Everything Discover returns crosses a server/client boundary and is
 * typed as an ISO string, so normalise here rather than letting a `Date` travel
 * under a `string` type — that lie only surfaces later as
 * "x.slice is not a function".
 */
export function toIso(v: Date | string | null | undefined): string | null {
  if (!v) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
