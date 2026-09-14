/**
 * Brand Fit — POC calculator.  TESTING ONLY, NOT PRODUCTION.
 *
 * ── Read this before using any number out of here ──────────────────────────
 * Brand Fit has NO agreed business rule. `FEATURE_METRICS_BACKLOG.md` §6 says
 * so in as many words — *"BLOCKED — LOGIC belum didefinisikan"* — and the data
 * dictionary leaves its formula column empty. What exists is a CANDIDATE rule
 * set in `Brand_Fit_Dummy_Data.xlsx`, whose own column header reads *"Dummy
 * Calculation Rule"* and whose entries say *"dummy proxy"*, *"temporary dummy
 * proxy"* and *"25% each for dummy testing only"*.
 *
 * This module exists to prove the calculation FLOW and the OUTPUT SHAPE work.
 * It is not a statement about what Brand Fit should be.
 *
 * ── What the workbook actually demonstrates, and what it does not ──────────
 * Audited against all 48 sample rows:
 *
 *   Values Fit         DERIVED AND VERIFIED. Recomputed from the raw
 *                      personality/tone attributes on all 48 rows, 48/48 exact.
 *   Partnership Score  DERIVED AND VERIFIED. Simple average of the four,
 *                      48/48 exact.
 *
 *   Category Fit       NOT DEMONSTRATED. Every one of the 48 rows scores 0,
 *                      because the workbook's brand vocabulary ("LifeWear /
 *                      Everyday Essentials") and its creator vocabulary
 *                      ("Fashion") never intersect. The stated 100/50 tiers
 *                      never occur, and "related" is defined nowhere.
 *   Audience Fit       NOT DEMONSTRATED. Constant 40 on all 48 rows across all
 *                      four brands — a placeholder, not a computation.
 *   Performance Fit    NOT A RULE. The pair→score map is hand-assigned and
 *                      internally contradictory: "Massive Reach & Emotional
 *                      Resonance" scores 0 against "High Reach" but 70 against
 *                      "High Engagement".
 *
 * So the three undemonstrated parts are INJECTED rather than implemented. A
 * caller supplies the resolver; this file refuses to invent one. That is also
 * what makes the rules swappable when the real ones are agreed.
 *
 * Pure: no `pg`, no fetch, no database access, nothing written anywhere.
 */

/** The engine's own sentinel for "not measured". Never 0. */
export type Score = number | null

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)

/**
 * Rounds to the 2 decimals `numeric(5,2)` stores, and clamps to 0..100.
 *
 * Clamping is a guard, not a rule: nothing below should be able to leave the
 * range, and if it does the caller should see 0 or 100 rather than a value the
 * column cannot hold.
 */
export function toScore(v: number | null | undefined): Score {
  if (!isNum(v)) return null
  return Math.round(Math.min(100, Math.max(0, v)) * 100) / 100
}

/* ── 1. Category Fit — rule INJECTED ──────────────────────────────────────── */

export type CategoryVerdict = 'match' | 'related' | 'unrelated'

/**
 * Decides how a brand category relates to one creator category.
 *
 * UNRESOLVED — the caller must supply this. The workbook states
 * "100 same; 50 related; 0 unrelated" but never shows a 100 or a 50, and never
 * says what makes two categories "related". Guessing a threshold here would
 * turn an open question into a silent decision.
 */
export type CategoryResolver = (
  brandCategory: string,
  creatorCategory: string,
) => CategoryVerdict

const CATEGORY_POINTS: Record<CategoryVerdict, number> = {
  match: 100,
  related: 50,
  unrelated: 0,
}

export interface CategoryFitResult {
  score: Score
  /** `category_fit_tags` — one entry per category the creator carries. */
  tags: { tag: string; fit: CategoryVerdict }[]
}

/**
 * The creator's best-fitting category decides the score; every category they
 * carry still appears in the tags.
 *
 * Best rather than average because a creator tagged Beauty AND Tech is a
 * genuine Beauty creator, and averaging would punish them for breadth. Marked
 * as an ASSUMPTION: the workbook gives each creator exactly one category, so it
 * never had to answer this.
 */
export function categoryFit(
  brandCategory: string | null,
  creatorCategories: readonly string[],
  resolve: CategoryResolver,
): CategoryFitResult {
  if (!brandCategory || !creatorCategories.length) return { score: null, tags: [] }
  const tags = creatorCategories.map(tag => ({ tag, fit: resolve(brandCategory, tag) }))
  const best = Math.max(...tags.map(t => CATEGORY_POINTS[t.fit]))
  return { score: toScore(best), tags }
}

/* ── 2. Audience Fit — "average of available dimensions" ──────────────────── */

export type AudienceDimension = 'gender' | 'age' | 'location' | 'interest'

/**
 * Per-dimension similarity, 0..100, or null where either side has nothing.
 *
 * The dimension SCORES are injected: the workbook's own audience column is a
 * constant 40 on every row, so it demonstrates no way of computing them. What
 * this function owns is the part the workbook does state — averaging only the
 * dimensions that are available.
 */
export type AudienceDimensions = Partial<Record<AudienceDimension, Score>>

export interface AudienceFitResult {
  score: Score
  /** Which dimensions carried a value, in canonical order. */
  measured: AudienceDimension[]
  missing: AudienceDimension[]
}

const DIMENSION_ORDER: AudienceDimension[] = ['gender', 'age', 'location', 'interest']

export function audienceFit(dims: AudienceDimensions): AudienceFitResult {
  const measured = DIMENSION_ORDER.filter(d => isNum(dims[d]))
  const missing = DIMENSION_ORDER.filter(d => d in dims && !isNum(dims[d]))
  if (!measured.length) return { score: null, measured: [], missing }
  // The denominator is the AVAILABLE dimensions, never the four. A dimension
  // nobody measured must not drag the average toward zero.
  const sum = measured.reduce((a, d) => a + (dims[d] as number), 0)
  return { score: toScore(sum / measured.length), measured, missing }
}

/* ── 3. Values Fit — DERIVED AND VERIFIED ─────────────────────────────────── */

/**
 * `matched attributes / brand attributes x 100`.
 *
 * The one component recomputed from the workbook's raw data rather than taken
 * from its output column: brand personality + brand tone against creator
 * personality + creator tone, matched case-insensitively. Verified on all 48
 * sample rows, 48/48 exact.
 *
 * The denominator is the BRAND's attribute count — the question is "how much of
 * what this brand asks for does the creator have", not the reverse. A creator
 * with fifty traits does not score higher for breadth.
 *
 * De-duplicated before counting, so a brand that lists "Warm" under both
 * personality and tone does not get a denominator of 2 for one idea.
 */
export function valuesFit(
  brandAttributes: readonly string[],
  creatorAttributes: readonly string[],
): Score {
  const norm = (xs: readonly string[]) =>
    [...new Set(xs.map(a => a.trim().toLowerCase()).filter(Boolean))]
  const brand = norm(brandAttributes)
  // No stated attributes means the brand asked for nothing — that is unmeasured,
  // not a zero match.
  if (!brand.length) return null
  const creator = new Set(norm(creatorAttributes))
  const matched = brand.filter(a => creator.has(a)).length
  return toScore((matched / brand.length) * 100)
}

/* ── 4. Performance Fit — lookup INJECTED ─────────────────────────────────── */

export type PerformanceVerdict = 'same' | 'related' | 'less_aligned' | 'incompatible'

const PERFORMANCE_POINTS: Record<PerformanceVerdict, number> = {
  same: 100,
  related: 70,
  less_aligned: 50,
  incompatible: 0,
}

/**
 * Compares a brand performance archetype with a creator one.
 *
 * UNRESOLVED, and more so than Category. No `archetype` column exists anywhere
 * in the database — not on the brand side, not on the creator side — so both
 * inputs are workbook labels today. And the workbook's own assignments do not
 * follow a rule: "Massive Reach & Emotional Resonance" scores 0 against "High
 * Reach" but 70 against "High Engagement".
 *
 * The caller supplies the verdict. This file will not reverse-engineer a rule
 * out of a table that contradicts itself.
 */
export type PerformanceResolver = (
  brandArchetype: string,
  creatorArchetype: string,
) => PerformanceVerdict

export function performanceFit(
  brandArchetype: string | null,
  creatorArchetype: string | null,
  resolve: PerformanceResolver,
): Score {
  if (!brandArchetype || !creatorArchetype) return null
  return toScore(PERFORMANCE_POINTS[resolve(brandArchetype, creatorArchetype)])
}

/* ── 5. Partnership Score — DERIVED AND VERIFIED ──────────────────────────── */

export interface SubScores {
  category: Score
  audience: Score
  values: Score
  performance: Score
}

/**
 * The mean of the four, over the ones that have a value.
 *
 * Verified against all 48 workbook rows (48/48 exact) — but only in the case
 * where all four are present, which is the only case the workbook contains.
 *
 * `minComponents` is an ASSUMPTION this file makes explicit rather than hides.
 * The workbook never shows a partial row, so it says nothing about what a score
 * built from one component means. Defaulting to 2: a single component
 * renormalised to 100% would read as a full Brand Fit when only one thing was
 * measured. Pass 1 to reproduce naive renormalisation, or 4 to require all.
 */
export function partnershipScore(subs: SubScores, minComponents = 2): Score {
  const present = Object.values(subs).filter(isNum)
  if (present.length < minComponents) return null
  return toScore(present.reduce((a, b) => a + b, 0) / present.length)
}

/* ── output shape ─────────────────────────────────────────────────────────── */

/**
 * The six columns of `feature.brand_fit_analysis`, as this POC would fill them.
 *
 * `audience_overlap_pct` is the SINGLE SOURCE OF TRUTH for the audience number,
 * and `sub_scores.audience_overlap` therefore carries a status and a pointer
 * but no `score` of its own — the table's own COMMENT requires exactly that:
 * *"Jangan menyalin audience_overlap_pct ke sini"*.
 */
export interface BrandFitOutput {
  partnership_score: Score
  sub_scores: {
    category_matching: { score: Score; status: string }
    audience_overlap: { status: string; source: 'audience_overlap_pct' }
    values_alignment: { score: Score; status: string }
    past_performance: { score: Score; status: string }
  }
  audience_overlap_pct: Score
  overlap_summary: string | null
  category_fit_tags: { tag: string; fit: CategoryVerdict }[]
  recommendations: { code: string; title: string; detail: string }[]
}

const statusOf = (s: Score) => (isNum(s) ? 'measured' : 'not_measured')

/**
 * Deterministic narrative. POC PLACEHOLDER — no agreed rule exists for this
 * field, and no LLM or external API is involved. It restates which dimensions
 * were measured and does not interpret them.
 */
function summarise(a: AudienceFitResult): string | null {
  if (!a.measured.length) return 'Tidak ada dimensi audiens yang bisa dibandingkan.'
  const label: Record<AudienceDimension, string> = {
    gender: 'gender', age: 'umur', location: 'lokasi', interest: 'minat',
  }
  const yes = a.measured.map(d => label[d]).join(', ')
  const no = a.missing.map(d => label[d]).join(', ')
  return `Dibandingkan pada ${yes}.` + (no ? ` Belum terukur: ${no}.` : '')
}

/**
 * Deterministic recommendations. POC PLACEHOLDER — the rule set below is NOT
 * agreed, and is written as data so it can be replaced without touching logic.
 */
function recommend(subs: SubScores): BrandFitOutput['recommendations'] {
  const out: BrandFitOutput['recommendations'] = []
  if (isNum(subs.category) && subs.category < 50) {
    out.push({
      code: 'category_low',
      title: 'Kategori creator berbeda dari kategori brand',
      detail: 'Pertimbangkan untuk tujuan awareness, bukan konversi langsung.',
    })
  }
  if (isNum(subs.values) && subs.values >= 60) {
    out.push({
      code: 'values_strong',
      title: 'Karakter creator sejalan dengan brand',
      detail: 'Cocok untuk konten bernarasi, bukan sekadar penempatan produk.',
    })
  }
  if (!isNum(subs.audience)) {
    out.push({
      code: 'audience_unmeasured',
      title: 'Audiens belum terukur',
      detail: 'Skor belum memperhitungkan kesesuaian audiens.',
    })
  }
  return out
}

/** Assembles the six output columns. Computes nothing new. */
export function buildOutput(
  subs: SubScores,
  tags: CategoryFitResult['tags'],
  audience: AudienceFitResult,
  minComponents = 2,
): BrandFitOutput {
  return {
    partnership_score: partnershipScore(subs, minComponents),
    sub_scores: {
      category_matching: { score: subs.category, status: statusOf(subs.category) },
      audience_overlap: { status: statusOf(subs.audience), source: 'audience_overlap_pct' },
      values_alignment: { score: subs.values, status: statusOf(subs.values) },
      past_performance: { score: subs.performance, status: statusOf(subs.performance) },
    },
    audience_overlap_pct: subs.audience,
    overlap_summary: summarise(audience),
    category_fit_tags: tags,
    recommendations: recommend(subs),
  }
}
