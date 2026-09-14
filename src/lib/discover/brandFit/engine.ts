/**
 * Brand Fit — the engine. Pure: inputs in, one analysis out.
 *
 *     BrandFitInputs  ->  analyseBrandFit()  ->  BrandFitAnalysis
 *
 * No database, no network, no clock, no LLM. `./records.ts` does the reading and
 * `./store.ts` does the writing; this file only decides. That separation is what
 * lets the whole of Brand Fit be tested without a connection, and it is why the
 * verification script can assert every branch of the NULL handling.
 *
 * The four components come from three places, and none of them lives here:
 *
 *   Category     `categoryFit()` in ./calculator, with `categoryResolver`
 *   Audience     `audienceFit()` in ./calculator, with `audienceDimensions`
 *   Values       `valuesFit()`   in ./calculator
 *   Performance  `performanceFit()` in ./rules
 *
 * `./calculator.ts` is not modified by any of this. It was written for the POC
 * with its rules left injectable, and this file is the production caller that
 * injects them.
 */
import {
  audienceFit, categoryFit, toScore, valuesFit,
  type AudienceDimension, type AudienceFitResult, type CategoryVerdict, type Score,
} from './calculator'
import {
  COMPONENT_WEIGHTS, MIN_COMPONENTS, VERDICT_LABEL, audienceDimensions, categoryResolver,
  performanceFit,
  type BrandAudienceTarget, type ComponentKey, type CreatorAudience, type CreatorPerformance,
  type PerformanceFitResult, type PerformanceTargets,
} from './rules'

/* ── inputs ───────────────────────────────────────────────────────────────── */

/** Everything the brand side supplies. Read from `public.brand_profile`. */
export interface BrandFitBrand {
  brandId: string
  brandName: string | null
  /** One of the nine canonical categories, or null while unset. */
  category: string | null
  /** `brand_personality` + `brand_tone`, already concatenated by the reader. */
  attributes: string[]
  audience: BrandAudienceTarget
  performanceTargets: PerformanceTargets
}

/** Everything the creator side supplies. Read from the KOL roster. */
export interface BrandFitCreator {
  agencyKolAccountId: string
  /** `public.agency_kol_accounts.platform_id` — never inferred from a table name. */
  platformId: string | null
  username: string | null
  /** Canonical `kol_categories.taxonomy_key` values. */
  categories: string[]
  /** Labels from `kol_attribute_map` -> `kol_attribute`. Empty means UNMAPPED. */
  attributes: string[]
  /**
   * Whether the creator has ever been tagged at all. Distinct from an empty
   * `attributes`: absent data is NOT MEASURED, whereas a creator who was tagged
   * and matched none of the brand's attributes genuinely scores 0.
   */
  hasAttributeMapping: boolean
  audience: CreatorAudience | null
  performance: CreatorPerformance
}

export interface BrandFitInputs {
  brand: BrandFitBrand
  creator: BrandFitCreator
}

/* ── output ───────────────────────────────────────────────────────────────── */

export type ComponentStatus = 'measured' | 'not_measured'

export interface CategoryFitTag {
  tag: string
  fit: CategoryVerdict
  /** The Indonesian label the UI chips render. */
  label: string
}

export interface Recommendation {
  code: string
  title: string
  detail: string
}

/**
 * The six columns of `feature.brand_fit_analysis`, plus the diagnostics a
 * caller needs to explain them.
 */
export interface SubScore {
  score: Score
  status: ComponentStatus
}

/**
 * `audience_overlap` carries a status and a pointer but NO score of its own.
 *
 * The column comment on `feature.brand_fit_analysis.sub_scores` requires exactly
 * that — *"Jangan menyalin audience_overlap_pct ke sini -- turunkan dari
 * kolomnya agar tidak ada dua sumber kebenaran"* — so the audience number lives
 * in its dedicated column and is read from there by anything that needs it.
 */
export interface AudienceSubScore {
  status: ComponentStatus
  source: 'audience_overlap_pct'
}

export interface BrandFitAnalysis {
  partnership_score: Score
  sub_scores: {
    category_matching: SubScore
    audience_overlap: AudienceSubScore
    values_alignment: SubScore
    past_performance: SubScore
  }
  audience_overlap_pct: Score
  overlap_summary: string | null
  category_fit_tags: CategoryFitTag[]
  recommendations: Recommendation[]
  /** Not persisted as a column — returned so the API can explain a result. */
  meta: {
    componentsAvailable: number
    /** Percentage of the four components that carried a value. */
    coverage: number
    status: Record<ComponentKey, ComponentStatus>
    audienceMeasured: AudienceDimension[]
    audienceMissing: AudienceDimension[]
    performance: PerformanceFitResult
    /** Why a component is not measured, for the UI and for support. */
    notes: string[]
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/* ── the analysis ─────────────────────────────────────────────────────────── */

export function analyseBrandFit({ brand, creator }: BrandFitInputs): BrandFitAnalysis {
  const notes: string[] = []

  /* 1 ── Category ---------------------------------------------------------- */
  const category = categoryFit(brand.category, creator.categories, categoryResolver)
  if (category.score === null) {
    notes.push(brand.category
      ? 'Category: creator belum punya kategori kanonik di kol_categories.taxonomy_key.'
      : 'Category: brand_profile.brand_category belum diisi.')
  }

  /* 2 ── Audience ---------------------------------------------------------- */
  const dims = creator.audience
    ? audienceDimensions(brand.audience, creator.audience)
    : { gender: null, age: null, location: null, interest: null }
  const audience = audienceFit(dims)
  if (audience.score === null) {
    notes.push(creator.audience
      ? 'Audience: tidak ada dimensi yang terisi di kedua sisi.'
      : 'Audience: creator tidak punya baris di feature.ig/tt_audience_analysis.')
  }

  /* 3 ── Values ------------------------------------------------------------ */
  // Availability is checked BEFORE calling: `valuesFit(brandAttrs, [])` returns
  // 0 because nothing matched, which is the wrong answer for a creator who was
  // never tagged at all. Absent inputs are NOT MEASURED.
  const values: Score = !brand.attributes.length || !creator.hasAttributeMapping
    ? null
    : valuesFit(brand.attributes, creator.attributes)
  if (values === null) {
    notes.push(!brand.attributes.length
      ? 'Values: brand belum punya brand_personality / brand_tone.'
      : 'Values: creator belum punya baris di public.kol_attribute_map.')
  }

  /* 4 ── Past Performance -------------------------------------------------- */
  const performance = performanceFit(brand.performanceTargets, creator.performance)
  if (performance.score === null) {
    notes.push(Object.keys(brand.performanceTargets).length
      ? 'Performance: creator tidak punya metrik untuk target yang diminta brand.'
      : 'Performance: brand_profile.performance_targets masih kosong.')
  }

  /* 5 ── Partnership score ------------------------------------------------- */
  const components: Record<ComponentKey, Score> = {
    category: category.score,
    audience: audience.score,
    values,
    performance: performance.score,
  }
  const partnership = partnershipScore(components)
  const available = (Object.keys(COMPONENT_WEIGHTS) as ComponentKey[])
    .filter(k => isNum(components[k]))

  return {
    partnership_score: partnership,
    sub_scores: {
      category_matching: { score: category.score, status: statusOf(category.score) },
      // Status only — the number is `audience_overlap_pct` and nowhere else.
      audience_overlap: { status: statusOf(audience.score), source: 'audience_overlap_pct' },
      values_alignment: { score: values, status: statusOf(values) },
      past_performance: { score: performance.score, status: statusOf(performance.score) },
    },
    audience_overlap_pct: audience.score,
    overlap_summary: summarise(audience, creator, brand),
    category_fit_tags: category.tags
      .map(t => ({ tag: t.tag, fit: t.fit, label: VERDICT_LABEL[t.fit] }))
      // Deterministic order: strongest fit first, then alphabetically, so the
      // same creator always yields byte-identical JSON.
      .sort((a, b) => RANK[a.fit] - RANK[b.fit] || a.tag.localeCompare(b.tag)),
    recommendations: recommend(components, category.tags, performance),
    meta: {
      componentsAvailable: available.length,
      coverage: toScore((available.length / 4) * 100) as number,
      status: {
        category: statusOf(category.score),
        audience: statusOf(audience.score),
        values: statusOf(values),
        performance: statusOf(performance.score),
      },
      audienceMeasured: audience.measured,
      audienceMissing: audience.missing,
      performance,
      notes,
    },
  }
}

const RANK: Record<CategoryVerdict, number> = { match: 0, related: 1, unrelated: 2 }
const statusOf = (s: Score): ComponentStatus => (isNum(s) ? 'measured' : 'not_measured')

/**
 * The weighted mean of the components that carry a value.
 *
 * The denominator is the sum of the AVAILABLE weights, never the full 100: a
 * component nobody could measure must not drag the score toward zero. With the
 * current equal weights this is the plain mean of what was measured, and the
 * verification script asserts exactly that against the calculator's own
 * unweighted `partnershipScore` — so the two can never drift apart silently.
 *
 * Below `MIN_COMPONENTS`, the result is NULL rather than a number built from
 * too little.
 */
export function partnershipScore(components: Record<ComponentKey, Score>): Score {
  let weighted = 0
  let weight = 0
  let count = 0
  for (const key of Object.keys(COMPONENT_WEIGHTS) as ComponentKey[]) {
    const value = components[key]
    if (!isNum(value)) continue
    weighted += value * COMPONENT_WEIGHTS[key]
    weight += COMPONENT_WEIGHTS[key]
    count += 1
  }
  if (count < MIN_COMPONENTS || weight <= 0) return null
  return toScore(weighted / weight)
}

/* ── narrative, derived and deterministic ─────────────────────────────────── */

const DIMENSION_LABEL: Record<AudienceDimension, string> = {
  gender: 'gender', age: 'umur', location: 'lokasi', interest: 'minat',
}

/**
 * Restates what was compared. It never introduces a number the score does not
 * already contain, and it is not generative — the same inputs always produce
 * the same sentence.
 *
 * NULL when there is nothing to say, rather than a sentence that implies a
 * measurement happened.
 */
function summarise(
  audience: AudienceFitResult,
  creator: BrandFitCreator,
  brand: BrandFitBrand,
): string | null {
  if (!audience.measured.length) {
    if (!creator.audience) return null
    const asked = brand.audience.gender !== 'Any'
      || isNum(brand.audience.ageMin) || isNum(brand.audience.ageMax)
      || !!brand.audience.country || !!brand.audience.city
      || brand.audience.interests.length > 0
    return asked
      ? 'Audiens creator tersedia, tetapi tidak ada dimensi yang bisa dibandingkan dengan target brand.'
      : 'Brand belum menetapkan target audiens, sehingga tidak ada yang bisa dibandingkan.'
  }
  const measured = audience.measured.map(d => DIMENSION_LABEL[d]).join(', ')
  const missing = audience.missing.map(d => DIMENSION_LABEL[d]).join(', ')
  const pct = audience.score === null ? '—' : `${audience.score}%`
  return `Kesesuaian audiens ${pct}, dibandingkan pada ${measured}.`
    + (missing ? ` Belum terukur: ${missing}.` : '')
}

/**
 * Recommendations derived from the scores that were just computed.
 *
 * Deterministic and rule-based — no LLM, no generation, no wording that depends
 * on anything outside these inputs. Where a component was not measured, the
 * recommendation says so instead of inventing advice about it.
 */
function recommend(
  components: Record<ComponentKey, Score>,
  tags: { tag: string; fit: CategoryVerdict }[],
  performance: PerformanceFitResult,
): Recommendation[] {
  const out: Recommendation[] = []
  const { category, audience, values, performance: perf } = components

  if (isNum(category)) {
    const exact = tags.filter(t => t.fit === 'match').map(t => t.tag)
    const related = tags.filter(t => t.fit === 'related').map(t => t.tag)
    if (exact.length) {
      out.push({
        code: 'category_match',
        title: 'Kategori creator sama dengan kategori brand',
        detail: `Cocok untuk konten produk langsung pada kategori ${exact.join(', ')}.`,
      })
    } else if (related.length) {
      out.push({
        code: 'category_related',
        title: 'Kategori creator berdekatan dengan kategori brand',
        detail: `Kategori ${related.join(', ')} bersinggungan; cocok untuk kampanye lintas kategori.`,
      })
    } else {
      out.push({
        code: 'category_unrelated',
        title: 'Kategori creator berbeda dari kategori brand',
        detail: 'Pertimbangkan untuk tujuan awareness, bukan konversi langsung.',
      })
    }
  }

  if (isNum(audience)) {
    out.push(audience >= 60
      ? {
        code: 'audience_strong',
        title: 'Audiens creator sesuai target brand',
        detail: `Kesesuaian audiens ${audience}% pada dimensi yang terukur.`,
      }
      : {
        code: 'audience_weak',
        title: 'Audiens creator belum sesuai target brand',
        detail: `Kesesuaian audiens ${audience}% — periksa dimensi mana yang meleset sebelum memakai creator ini untuk targeting ketat.`,
      })
  } else {
    out.push({
      code: 'audience_unmeasured',
      title: 'Audiens belum terukur',
      detail: 'Skor belum memperhitungkan kesesuaian audiens.',
    })
  }

  if (isNum(values)) {
    out.push(values >= 60
      ? {
        code: 'values_strong',
        title: 'Karakter creator sejalan dengan brand',
        detail: 'Cocok untuk konten bernarasi, bukan sekadar penempatan produk.',
      }
      : {
        code: 'values_weak',
        title: 'Karakter creator belum sejalan dengan brand',
        detail: `Baru ${values}% atribut brand yang dimiliki creator — siapkan brief yang lebih terarah.`,
      })
  } else {
    out.push({
      code: 'values_unmeasured',
      title: 'Karakter creator belum dipetakan',
      detail: 'Values alignment belum bisa dihitung sampai atribut creator terisi.',
    })
  }

  if (isNum(perf)) {
    const weakest = [...performance.metrics].sort((a, b) => a.score - b.score)[0]
    out.push(perf >= 60
      ? {
        code: 'performance_strong',
        title: 'Performa creator memenuhi target brand',
        detail: `Rata-rata ${perf}% terhadap target pada ${performance.measured.length} metrik.`,
      }
      : {
        code: 'performance_weak',
        title: 'Performa creator di bawah target brand',
        detail: weakest
          ? `Metrik terlemah: ${weakest.metric} (${weakest.value} terhadap target ${weakest.target}).`
          : `Rata-rata ${perf}% terhadap target brand.`,
      })
  } else {
    out.push({
      code: 'performance_unmeasured',
      title: 'Performa belum dinilai',
      detail: 'Brand belum menetapkan target performa, atau metrik creator belum tersedia.',
    })
  }

  return out
}
