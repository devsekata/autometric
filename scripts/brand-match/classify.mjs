/**
 * Content classification from a creator's own words, per CLASSIFICATION_RULES in
 * `taxonomy.mjs`.
 *
 * Extracted from `roster-fetch.mjs` so the 24-creator roster and the
 * multi-thousand-creator population run the same classifier. Two copies of a
 * classifier is two classifiers, and the distribution test would then be
 * measuring the difference between them rather than the shape of the scores.
 *
 * The one thing that changed in the move is that every keyword regex is compiled
 * ONCE at module load instead of once per creator per keyword. The rules are
 * identical; at 24 creators the cost did not matter, and at 7.000 it is the
 * difference between a few seconds and several minutes.
 */

import { TAXONOMY, CATEGORIES } from './taxonomy.mjs'

/**
 * Every taxonomy node flattened, with its keyword regexes pre-compiled and the
 * chain of labels a hit credits.
 *
 * Rule 3: an L3 hit scores 3, an L2 hit 2, an L1 hit 1. Hits roll up, so the
 * chain carries the node's own label and every label above it.
 */
const NODES = []
for (const cat of TAXONOMY) {
  const push = (label, kw, points, chain) => {
    NODES.push({
      label,
      points,
      chain,
      // Word-boundary, not containment. Substring matching makes "art" hit
      // "start" and "kartu", which is how a keyword classifier quietly turns
      // into a random number generator. Several keywords carry regex
      // metacharacters, so each is escaped before compiling.
      terms: kw.map(k => ({
        kw: k,
        re: new RegExp(`(^|[^\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'iu'),
      })),
    })
  }
  push(cat.label, cat.kw, 1, [cat.label])
  for (const sub of cat.subs) {
    push(sub.label, sub.kw, 2, [cat.label, sub.label])
    for (const t of sub.topics) push(t.label, t.kw, 3, [cat.label, sub.label, t.label])
  }
}

const CATEGORY_SET = new Set(CATEGORIES)

/**
 * Scores every taxonomy node against a creator's own words.
 *
 * Rule 2: the bio is the creator describing themselves, so it weighs x2;
 * captions and hashtags weigh x1. Audience interest is deliberately not scored
 * here — the rule makes it a tie-break, because what an audience likes is not
 * what the creator makes.
 */
export function classify(bio, captions, hashtags) {
  const evidence = [
    { text: (bio ?? '').toLowerCase(), weight: 2, source: 'bio' },
    { text: captions.join(' \n ').toLowerCase(), weight: 1, source: 'caption' },
    { text: hashtags.join(' ').toLowerCase(), weight: 1, source: 'hashtag' },
  ].filter(e => e.text)

  // A creator with no bio, no captions and no hashtags has nothing to classify.
  // Returning here skips ~640 regex compilations' worth of iteration per creator,
  // which matters at 7.000 creators and changes no result: with no evidence every
  // node would score zero anyway.
  if (!evidence.length) return { category: null, basis: null, topics: [], categoryScores: [] }

  const score = new Map()
  const hits = new Map()
  const add = (label, points, kw, source) => {
    score.set(label, (score.get(label) ?? 0) + points)
    if (!hits.has(label)) hits.set(label, new Set())
    hits.get(label).add(`${kw} (${source})`)
  }

  for (const node of NODES) {
    for (const { kw, re } of node.terms) {
      for (const ev of evidence) {
        if (!re.test(ev.text)) continue
        for (const label of node.chain) add(label, node.points * ev.weight, kw, ev.source)
      }
    }
  }

  const ranked = [...score.entries()]
    .map(([label, points]) => ({ label, points, evidence: [...hits.get(label)].slice(0, 6) }))
    .sort((a, b) => b.points - a.points || a.label.localeCompare(b.label))

  const cats = ranked.filter(r => CATEGORY_SET.has(r.label))
  const leader = cats[0]
  const runner = cats[1]

  /**
   * Rule 4 at the category level, plus one condition the rule implies but does
   * not spell out: the leader must be carried by at least two DISTINCT keywords.
   *
   * Points alone cannot tell "this creator makes beauty content" from "this
   * creator once wrote the word shade". Without it a single L1 hit in one
   * caption clears the >= 3 threshold, and a comedy account comes back Beauty on
   * the strength of one word. Falling through to Uncategorized scores
   * CAL_NEUTRAL against every brand — neither credited nor punished for
   * something nobody measured, which is the right answer to "we do not know".
   */
  const distinct = leader ? new Set(leader.evidence.map(e => e.replace(/ \(\w+\)$/, ''))).size : 0
  let assigned = null
  let basis = null
  if (leader && distinct >= 2 && leader.points >= 6 && (!runner || leader.points - runner.points >= 2)) {
    assigned = leader.label
    basis = 'calculated'
  } else if (leader && distinct >= 2 && leader.points >= 3) {
    assigned = leader.label
    basis = 'estimated'
  }

  return {
    category: assigned,
    basis,
    topics: ranked.filter(r => !CATEGORY_SET.has(r.label)).slice(0, 3),
    categoryScores: cats.slice(0, 4),
  }
}

/**
 * How a classifier label is expressed as a DB canonical category.
 *
 * Not a hand-written opinion: the label is looked up as a category NAME in
 * `public.kol_categories` and the answer is whatever `taxonomy_key` the database
 * already assigned it. The entries below are only the labels whose classifier
 * spelling differs from the database spelling, and each points at a row that
 * exists. A label with no row resolves to null, and the creator stays
 * uncategorised rather than being filed under an invented key.
 */
export const CLASSIFIER_LABEL_TO_DB_NAME = {
  Parenting: 'Parenting and family',
  'Home & Living': 'Home Decor',
  Automotive: 'Automotive and motorsports',
  Finance: 'Business and entrepreneurship',
  Tech: 'Technology and gadgets',
}

/** Builds `label -> canonical taxonomy_key` from the category master. */
export function canonicaliser(keyOfName) {
  return label => {
    if (!label) return null
    return keyOfName.get(CLASSIFIER_LABEL_TO_DB_NAME[label] ?? label) ?? null
  }
}
