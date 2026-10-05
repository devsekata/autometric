/**
 * The three brand preference profiles the distribution test runs.
 *
 * Each one is an existing brand from `comparison-brands.mjs` — same canonical
 * category, same keywords, same interest keys — paired with an ELIGIBILITY rule
 * that decides which creators are in its comparison population.
 *
 * The eligibility rules matter as much as the brands. Normalized Score divides
 * by the maximum "dalam populasi yang sama", so a preference is not just a
 * scoring profile: it is a population. Three preferences that admitted the same
 * creators would produce three normalisations of one population and could not
 * show whether the normalisation travels.
 *
 * Every filter used here is a HARD FILTER the catalogue marks DONE — one that is
 * wired end to end today and whose count actually moves:
 *
 *   platform          kol_directory.platform_id → platforms.key      97,1%
 *   minFollowers      kol_directory.followers_count                  97,1%
 *   requireCategory   category_ids → kol_categories                  54,1%
 *   requireEr         kol_directory.engagement_rate                  22,6%
 *
 * Nothing here filters on a BLOCKED BY DATA column. A gate on a column that is
 * 0% filled does not select a population, it empties one.
 */

import { BRANDS } from './comparison-brands.mjs'

const brand = name => {
  const b = BRANDS.find(x => x.brand_name === name)
  if (!b) throw new Error(`distribution preference names a brand that does not exist: ${name}`)
  return b
}

/**
 * `eligibility` is both the filter and its own documentation: `test` decides,
 * `criteria` is what gets printed on the Preference_Profiles sheet. They are
 * defined together so the sheet cannot describe a rule the code does not apply.
 */
export const PREFERENCES = [
  {
    id: 'A',
    label: 'Preference A',
    brand: brand('LumiSkin'),
    rationale:
      'A beauty brand buying on Instagram. Beauty is the second-largest category on the server (1.206 creators), '
      + 'so this preference has a deep pool of on-category creators and a female-audience target that most of the '
      + 'roster can be measured against.',
    criteria: [
      ['Platform', 'Instagram only'],
      ['Minimum followers', '10.000 (Micro and above)'],
      ['Category requirement', 'must carry at least one kol_categories row'],
      ['Brand category', 'Beauty'],
      ['Gender target', 'Female'],
    ],
    test: r => r.platform === 'Instagram'
      && Number.isFinite(r.followers) && r.followers >= 10_000
      && (r.rawCategories?.length ?? 0) > 0,
  },
  {
    id: 'B',
    label: 'Preference B',
    brand: brand('DailyBite'),
    rationale:
      'A mass-market F&B brand with the broadest possible reach: both platforms, no category requirement. '
      + 'This is the largest of the three populations and the one most exposed to creators the database knows '
      + 'almost nothing about, which is exactly what makes it worth measuring.',
    criteria: [
      ['Platform', 'Instagram and TikTok'],
      ['Minimum followers', '10.000 (Micro and above)'],
      ['Category requirement', 'none'],
      ['Brand category', 'Food'],
      ['Gender target', 'Balanced'],
    ],
    test: r => Number.isFinite(r.followers) && r.followers >= 10_000,
  },
  {
    id: 'C',
    label: 'Preference C',
    brand: brand('NovaTech'),
    rationale:
      'A B2B software brand buying large accounts with measured engagement. Tech is the SMALLEST canonical '
      + 'category on the server — 4 creators carry it — so this preference tests what the model does when almost '
      + 'nobody in the population is on-category, and the engagement-rate gate makes it the only one of the three '
      + 'where every creator has a Performance Score.',
    criteria: [
      ['Platform', 'Instagram and TikTok'],
      ['Minimum followers', '100.000 (Macro and above)'],
      ['Minimum engagement rate', 'must be measured (kol_directory.engagement_rate not null)'],
      ['Brand category', 'Tech'],
      ['Gender target', 'Balanced'],
    ],
    test: r => Number.isFinite(r.followers) && r.followers >= 100_000 && r.er !== null,
  },
]
