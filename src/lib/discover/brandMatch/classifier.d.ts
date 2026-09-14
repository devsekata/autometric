/**
 * Types for `scripts/brand-match/classify.mjs`, which is imported rather than
 * ported.
 *
 * The classifier is ~900 lines between it and `taxonomy.mjs`, it is pure (its
 * only imports are `node:fs`/`node:path`/`node:url`, used by a snapshot helper
 * this app never calls), and it pulls in no `exceljs` — which is the single
 * reason `scoring.mjs` had to be ported at all. Two copies of a classifier is
 * two classifiers, and the roster snapshot, the distribution test and the live
 * Creator Database would then be filing the same creator under different
 * categories. So the app runs the same file the workbook ran.
 *
 * Server-only: `taxonomy.mjs` imports `node:fs` at module scope, so anything
 * reaching this must stay out of a client bundle.
 */
declare module '*/brand-match/classify.mjs' {
  export interface ClassificationTopic {
    label: string
    points: number
    evidence: string[]
  }

  export interface Classification {
    /** The winning taxonomy label, or null when nothing scored. */
    category: string | null
    /** 'live' when a kol_categories row decided it, 'calculated' when keywords did. */
    basis: string | null
    topics: ClassificationTopic[]
    categoryScores: { label: string; points: number; evidence: string[] }[]
  }

  export function classify(
    bio: string | null | undefined,
    captions: string[],
    hashtags: string[],
  ): Classification

  /**
   * Builds the classifier-label -> canonical-`taxonomy_key` resolver from a
   * live `public.kol_categories` name -> taxonomy_key map. A label with no row
   * resolves to null, so a creator stays uncategorised rather than being filed
   * under an invented key.
   */
  export function canonicaliser(
    keyOfName: Map<string, string | null>,
  ): (label: string | null | undefined) => string | null

  export const CLASSIFIER_LABEL_TO_DB_NAME: Record<string, string>
}
