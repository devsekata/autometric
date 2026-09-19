/**
 * What Matters Most — constants, ordinal ladders, and the Content Quality
 * weights and stability cut-offs.
 *
 * ── This is a PORT, and the port is checked ────────────────────────────────
 * All six criteria are copied from `scripts/what-matters/what_matters_scoring.py`,
 * vendored verbatim from the scrapper repo at `5cf0578`. That file stays the reference implementation for as long as both exist, and
 * `scripts/verify-what-matters-port.ts` drives the Python and asserts this
 * TypeScript reproduces it value for value.
 *
 * It is ported rather than called because there is no transport: the scrapper
 * repo ships no HTTP server (`requirements.txt` is apify-client, psycopg2 and
 * python-dotenv), `search_kol.py` is an argparse CLI, and `search_kol_directory`
 * takes a live psycopg2 connection as its first argument. The one Python service
 * this repo does run, `services/mapping-engine`, connects through
 * `DATABASE_URL` — the warehouse — so routing a KOL feature through it would
 * break the database boundary this work exists to establish.
 *
 * ── Content Quality is a port too, since 5cf0578 ──────────────────────────
 * It used to be this file's one deliberate divergence: the Python returned
 * `None`, and this port scored Engagement 40 + Format 30 + Topic 30 from two
 * product rubrics. The reference now scores it itself — Engagement 50% +
 * Views 30% + Consistency 20% over `l2_gold.post_metric` — and this port
 * follows it. The format and topic rubrics are gone with that change, not kept
 * alongside: two definitions of one criterion is how they drift.
 *
 * ── Brand Safety is not a criterion ────────────────────────────────────────
 * Out of scope for What Matters and Brand Match since scrapper `50b6a16`. It is
 * not a key here, so `parseMatters` and Brand Match's `cleanWhatMatters` drop
 * `brand_safety` like any unknown key — no score, no proxy, no default.
 */

export const SKALA_MIN = 0
export const SKALA_MAX = 100

/** The six criteria, in UI order. Keys match the Python's exactly. */
export const CRITERIA_ORDER = [
  'engagement', 'audience_quality', 'consistency',
  'community', 'reach', 'content_quality',
] as const
export type CriterionKey = (typeof CRITERIA_ORDER)[number]

export const CRITERIA_LABELS: Record<CriterionKey, string> = {
  engagement: 'Strong Engagement',
  audience_quality: 'High Audience Quality',
  consistency: 'Consistent Performance',
  /**
   * Deliberately NOT "Strong Community".
   *
   * The score is `audience_quality x 0.70 + engagement percentile x 0.30`. No
   * column anywhere in this database measures a community — not membership, not
   * retention, not repeat commenters. What the two signals jointly indicate is
   * an audience that is real and that reacts, which is what the label now says.
   */
  community: 'Audiens Aktif & Asli',
  reach: 'High Reach',
  content_quality: 'Content Quality',
}

/* ── ordinal ladders ──────────────────────────────────────────────────────── */

/**
 * Position on the ladder, normalised to 0..100. Three levels give 0 / 50 / 100.
 *
 * This is ORDER, not measurement: "Medium" does not mean half as good as
 * "High", only that it sits between. Both ladders come from
 * `metrics_thresholds` upstream, whose cut-offs are already decided — reading
 * the label means reading those cut-offs rather than writing a second
 * definition over the raw number.
 */
export const TINGKAT_STABILITAS = ['Low Stability', 'Medium Stability', 'High Stability'] as const
export const TINGKAT_RELIABILITAS = ['Low', 'Medium', 'High'] as const

/* ── Content Quality ──────────────────────────────────────────────────────── */

/**
 * Content Quality = Engagement 50% + Views 30% + Consistency 20%.
 *
 * `BOBOT_CQ_*` in the reference, written as 50/30/20 like this file's other
 * weights; `weighted()` renormalises, so the scale does not change a score.
 */
export const W_CQ_ENGAGEMENT = 50
export const W_CQ_VIEWS = 30
export const W_CQ_CONSISTENCY = 20

/**
 * The stability cut-offs of `metrics_thresholds.klasifikasi_stability`,
 * applied by Content Quality to the standard deviation of per-post ER in
 * percentage points. Copied, not re-decided: the reference reuses the
 * thresholds that already label `performance_stability`, and so does this.
 *
 * Fewer than three posts with an ER is NOT "stable": two points always have a
 * small deviation, and labelling that High would sell missing data as
 * consistency. Below the minimum the component is null.
 */
export const STABILITY_HIGH_MAX = 1.0
export const STABILITY_MEDIUM_MAX = 3.0
export const STABILITY_MIN_SAMPLES = 3
