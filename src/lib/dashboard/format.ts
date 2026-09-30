/**
 * Shared number formatting for every dashboard tab (server libs + client components).
 *
 * Rule from the Final Dashboard Revision: every percentage is shown with exactly two
 * decimals (2.191% → 2.19%, 2.001% → 2.00%), the same in scorecards, deltas, charts
 * and tooltips.
 */

const clean = (n: number) => {
  const v = Number.isFinite(n) ? n : 0
  // avoid "-0.00" for tiny negatives that round to zero
  return Math.abs(v) < 0.005 ? 0 : v
}

/** 5.0312 → "5.03%" */
export const fmtPct = (n: number) => `${clean(n).toFixed(2)}%`

/** signed percentage change: 14.2 → "+14.20%", -0.001 → "0.00%" */
export const fmtSignedPct = (n: number) => {
  const v = clean(n)
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
}

/** signed percentage-point change: 0.5 → "+0.50pts" */
export const fmtPts = (n: number) => {
  const v = clean(n)
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}pts`
}

/** Round a percentage to 2 decimals for chart/spark data (keeps it numeric). */
export const round2 = (n: number) => Math.round(clean(n) * 100) / 100
