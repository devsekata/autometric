/**
 * What Matters Most — constants, ordinal ladders, and the Content Quality
 * rubrics.
 *
 * ── This is a PORT, and the port is checked ────────────────────────────────
 * Six of the seven criteria are copied from
 * `scripts/what-matters/what_matters_scoring.py`, vendored verbatim from the
 * scrapper repo at `0d6e571`. That file stays the reference implementation for
 * as long as both exist, and `scripts/verify-what-matters-port.ts` drives the
 * Python and asserts this TypeScript reproduces it value for value.
 *
 * It is ported rather than called because there is no transport: the scrapper
 * repo ships no HTTP server (`requirements.txt` is apify-client, psycopg2 and
 * python-dotenv), `search_kol.py` is an argparse CLI, and `search_kol_directory`
 * takes a live psycopg2 connection as its first argument. The one Python service
 * this repo does run, `services/mapping-engine`, connects through
 * `DATABASE_URL` — the warehouse — so routing a KOL feature through it would
 * break the database boundary this work exists to establish.
 *
 * ── The seventh criterion is NOT a port ────────────────────────────────────
 * `content_quality_score()` in the Python returns `None` unconditionally, with
 * a documented refusal: nothing in the database, the workbook or the prototype
 * states that Carousel beats Image or that one topic beats another, so scoring
 * them would be inventing a judgement.
 *
 * The product has since decided to score it anyway, at Engagement 40% + Format
 * 30% + Topic 30%. That decision is implemented here and the rubrics below are
 * the whole of it — written down, versioned, and auditable rather than buried
 * in an expression. The verifier therefore pins six criteria to the Python and
 * reports the seventh as a deliberate divergence.
 */

export const SKALA_MIN = 0
export const SKALA_MAX = 100

/** The seven criteria, in UI order. Keys match the Python's exactly. */
export const CRITERIA_ORDER = [
  'engagement', 'audience_quality', 'consistency',
  'community', 'reach', 'content_quality', 'brand_safety',
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
  brand_safety: 'Brand Safety',
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

/* ── Content Quality rubrics ──────────────────────────────────────────────── */

export const W_CQ_ENGAGEMENT = 40
export const W_CQ_FORMAT = 30
export const W_CQ_TOPIC = 30

/**
 * Format rubric — `l2_gold.kol_profile_card.format_dominant`.
 *
 * The column holds exactly three values across the 49 rows that carry one:
 * Carousel 24, Video 20, Image 5.
 *
 * ── This is a stated PRODUCT DECISION, not a measurement ───────────────────
 * Say so plainly, because the distinction is the whole reason this table is
 * written out instead of inlined. No column, workbook or prototype ranks these
 * formats. The ordering below encodes production effort and how much room a
 * format gives a brand message:
 *
 *   Video     100  motion and sound; carries demonstration, and costs the most
 *                  to make
 *   Carousel   85  multiple frames; carries a sequence — steps, before/after
 *   Image      60  a single frame
 *
 * Deriving it from the roster instead was considered and rejected: median ER by
 * format over 24/20/5 rows is a sample too small to separate three groups, and
 * a rubric recomputed from live data would change every creator's score
 * whenever the roster moved. A fixed table can at least be argued with.
 *
 * Matched case-insensitively. An unrecognised value scores null, not zero — a
 * format nobody has classified is not a bad format.
 */
export const FORMAT_RUBRIC: Record<string, number> = {
  video: 100,
  carousel: 85,
  image: 60,
}

/**
 * Topic rubric — `content_topic` and `content_topic_source`.
 *
 * ── It deliberately does NOT rank one topic above another ──────────────────
 * The column holds 13 values: religion, fitness, beauty, music, food,
 * parenting, travel, Fashion, Entertainment, photography, business, sports,
 * automotive. Nothing in this project states that food is worth more than
 * religion, and inventing that ordering would be both unfounded and, for some
 * of these values, plainly objectionable.
 *
 * What CAN be scored, from data already in the row, is how strong the evidence
 * behind the topic is. `content_topic_source` records exactly that:
 *
 *   content                   100  read from the creator's own captions
 *                                  (40 of the 42 rows that carry a topic)
 *   creator_category_fallback  50  inferred from the category the creator is
 *                                  tagged with, because no caption was
 *                                  available to read (2 rows)
 *
 * So the axis measures topical CLARITY — does this creator have an identifiable
 * subject, and did we read it or guess it — which is a quality of the content
 * signal rather than an opinion about the subject.
 *
 * A row with no topic at all scores null, not zero.
 */
export const TOPIC_SOURCE_RUBRIC: Record<string, number> = {
  content: 100,
  creator_category_fallback: 50,
}

/**
 * What a topic scores when it is present but its source is unrecorded.
 *
 * Between the two rubric values rather than at either end: the topic exists, so
 * it is not the null case, but nothing says whether it was read or guessed.
 */
export const TOPIC_SOURCE_UNKNOWN = 75
