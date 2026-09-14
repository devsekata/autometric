/**
 * Brand Fit Analysis — public surface.
 *
 *     Brand Profile + KOL roster  ->  analyseBrandFit()  ->  feature.brand_fit_analysis
 *
 * A feature in its own right, and NOT Match Score. Match Score ranks the whole
 * Creator Database for one workspace from six weighted components; Brand Fit
 * answers a narrower question about one creator and one specific brand, at the
 * grain `(agency_kol_account_id, brand_id)`, and writes the four sub-scores that
 * `feature.brand_fit_analysis` was built for. Neither reads the other, and
 * nothing here touches `@/lib/discover/brandMatch/score.ts`.
 *
 * The one thing Brand Fit borrows from Brand Match is the `CATEGORY_RELATEDNESS`
 * matrix, imported read-only in `./rules.ts` and not modified. Reusing it is
 * what keeps a second category taxonomy from coming into existence.
 */
export {
  analyseBrandFit, partnershipScore,
  type BrandFitAnalysis, type BrandFitBrand, type BrandFitCreator, type BrandFitInputs,
  type CategoryFitTag, type ComponentStatus, type Recommendation, type SubScore,
} from './engine'

export {
  COMPONENT_WEIGHTS, MIN_COMPONENTS, PERFORMANCE_METRICS, RELATED_THRESHOLD,
  audienceDimensions, categoryResolver, performanceFit,
  type BrandAudienceTarget, type ComponentKey, type CreatorAudience,
  type CreatorPerformance, type GenderTarget, type PerformanceMetric,
  type PerformanceTargets,
} from './rules'

export { loadBrand, loadCreators } from './records'
export {
  getBrandFit, getBrandFitForBrand, saveBrandFit,
  type AnalysisToStore, type StoredBrandFit,
} from './store'

export type { Score } from './calculator'

import { analyseBrandFit, type BrandFitAnalysis } from './engine'
import { loadBrand, loadCreators } from './records'
import { saveBrandFit } from './store'

export interface BrandFitRunResult {
  brandId: string
  brandName: string | null
  analysed: number
  stored: number
  /** How many pairs produced a partnership score rather than NULL. */
  measurable: number
  results: { agencyKolAccountId: string; username: string | null; analysis: BrandFitAnalysis }[]
}

/**
 * Scores one brand against the roster and stores the result.
 *
 * `agencyKolAccountIds` narrows it to specific roster entries; omitted, it runs
 * the whole roster. `persist: false` computes without writing, which is what a
 * preview and the verification script both want.
 *
 * Pairs that score NULL are stored too, deliberately. "We looked and could not
 * measure this" is a finding the UI needs in order to show the set-up prompt
 * instead of an empty gauge, and re-deriving it on every page load would mean
 * re-reading the whole roster to learn nothing new.
 */
export async function runBrandFit(
  brandId: string,
  options: { agencyKolAccountIds?: string[]; persist?: boolean } = {},
): Promise<BrandFitRunResult> {
  const brand = await loadBrand(brandId)
  if (!brand) throw new BrandFitNotFound(`No brand with id ${brandId} on the KOL server.`)

  const creators = await loadCreators(options.agencyKolAccountIds)
  const results = creators.map(creator => ({
    agencyKolAccountId: creator.agencyKolAccountId,
    username: creator.username,
    analysis: analyseBrandFit({ brand, creator }),
  }))

  const stored = options.persist === false
    ? 0
    : await saveBrandFit(results.map(r => ({
      agencyKolAccountId: r.agencyKolAccountId,
      brandId: brand.brandId,
      analysis: r.analysis,
    })))

  return {
    brandId: brand.brandId,
    brandName: brand.brandName,
    analysed: results.length,
    stored,
    measurable: results.filter(r => r.analysis.partnership_score !== null).length,
    results,
  }
}

export class BrandFitNotFound extends Error {}
