/**
 * Brand Match ordering: the sort key, and the one comparator that applies it.
 *
 * ── Why this is its own module ─────────────────────────────────────────────
 * It lives here rather than in `./kolDirectory` because the CLIENT applies it.
 * `kolDirectory` imports `@/lib/kolDb`, which imports `pg`; a value import of
 * anything in that module from a component drags a Postgres driver into the
 * browser bundle, and the build fails on `net`/`tls`. A type-only import was
 * what kept that from happening before, and a comparator cannot be type-only.
 *
 * Splitting it out is not a copy: `kolDirectory` re-exports these, so every
 * existing importer — the route, the sort-key whitelist, `verify:match-sort` —
 * keeps reaching the SAME implementation. Two comparators is how a card grid
 * and a table start disagreeing about one page.
 *
 * Nothing here imports anything. That is the point.
 */

/**
 * The sort key whose ordering is applied AFTER the query, over the page only.
 *
 * Page-scoped by construction, not by omission: scoring the whole roster would
 * mean computing a Match % for ~7.4k creators per request per brand profile,
 * and the criteria most of them can be measured on are few. The UI says
 * "halaman ini" for exactly this reason.
 *
 * Applied by the CLIENT, over the Brand Match it fetched for the ids on screen.
 * It used to be applied by the route, which meant the list request had to carry
 * `match=1` and could not be answered until Brand Match was: the list then
 * failed whenever Brand Match did. Brand Match is now its own request, so the
 * page arrives first and is reordered when the scores land.
 */
export const MATCH_SORT = 'match'

/**
 * Re-ranks ONE PAGE by Brand Match %. Pure, so it can be verified without a
 * database or a running route.
 *
 * Three properties it has to keep, and the reason each one is not negotiable:
 *
 *   unscored last   A creator with no Match % is not a creator who scored 0.
 *                   `null` sorts to the bottom in BOTH directions, so "lowest
 *                   match first" never means "unmeasured first" — the same rule
 *                   the SQL ordering applies with NULLS LAST, and the same rule
 *                   the engine applies when it leaves an unmeasured criterion
 *                   out of the denominator.
 *   no fabrication  Nothing substitutes a number for a missing score. The
 *                   comparator reads `null` and orders around it; it never
 *                   coerces to 0, to 50, or to -1.
 *   deterministic   `Array.prototype.sort` has been required to be stable since
 *                   ES2019, so equal scores keep the incoming order — which is
 *                   the SQL ordering (followers DESC, then username ASC).
 *
 * Returns a new array; the input is not mutated.
 */
export function rankByMatch<T>(
  rows: readonly T[],
  scoreOf: (row: T) => number | null,
  dir: string | null | undefined,
): T[] {
  const asc = dir === 'asc'
  return [...rows].sort((a, b) => {
    const x = scoreOf(a)
    const y = scoreOf(b)
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    return asc ? x - y : y - x
  })
}
