/**
 * FINAL audience classification for Discovery (detail, list filters): the same
 * rule scrapper-project `audience_classification.py` applies, in SQL, so the
 * reader and the classification agree cell for cell.
 *
 *   measured/inferred USABLE   -> the measured value
 *   measured/inferred unusable -> curated_* (migration 054, one row per account on
 *                                 feature.{ig,tt}_audience_analysis)
 *   neither                    -> NULL
 *
 * USABLE (audience_classification): at least MIN_KNOWN followers with a known
 * value and a UNIQUE top value. Gender: known = female + male in
 * `gender_breakdown`; the label is female/male when that side holds
 * >= GENDER_SHARE_MIN of the known split, otherwise balanced.
 *
 * Sources, identical to the classification's:
 *   gender   feature.*.gender_breakdown + female_pct/male_pct
 *   age      l2_gold.audience_demographics_daily 'measured' (newest measured day), else
 *            feature.*.age_gender_breakdown->'age'
 *   country/ l2_gold.audience_geo_daily: newest MEASURED day when the account has one,
 *   city     otherwise every inferred day summed (each day's batch holds different
 *            followers), `unknown` excluded
 *
 * IG rows come from feature.ig_audience_analysis and TikTok rows from
 * feature.tt_audience_analysis; `platform` says which, so a TikTok account can
 * never be answered from the Instagram table.
 */
export const MIN_KNOWN = 5
export const GENDER_SHARE_MIN = 60
export const AGE_BUCKETS = ['13-17', '18-24', '25-34', '35-44', '45+'] as const

/** What a curated gender label claims in `female_pct`/`male_pct` terms (see GENDER_SHARE_MIN). */
export const CURATED_GENDER_SHARE_MIN = GENDER_SHARE_MIN
export const CURATED_BALANCED_SHARE_MIN = 100 - GENDER_SHARE_MIN

/** Top key of a {key, v} set when usable (>= MIN_KNOWN known and a unique max), else NULL. */
const TOP_USABLE = (rows: string) => `(
  SELECT CASE WHEN r.known >= ${MIN_KNOWN} AND r.n_same = 1 THEN r.k END
    FROM (SELECT s.k, SUM(s.v) OVER () AS known,
                 RANK() OVER (ORDER BY s.v DESC) AS rk,
                 COUNT(*) OVER (PARTITION BY s.v) AS n_same
            FROM (${rows}) s) r
   WHERE r.rk = 1
   LIMIT 1)`

/** L2 geo rows for one account/level, with the classification's date semantics. */
const GEO_ROWS = (level: 'country' | 'city') => `
  SELECT g.geo_key AS k, SUM(g.audience_count) AS v
    FROM l2_gold.audience_geo_daily g
   WHERE g.social_account_id = fa.social_account_id
     AND g.geo_level = '${level}'
     AND g.geo_key <> '' AND lower(g.geo_key) <> 'unknown'
     AND (NOT EXISTS (SELECT 1 FROM l2_gold.audience_geo_daily m
                       WHERE m.social_account_id = fa.social_account_id AND m.confidence = 'measured')
          OR (g.confidence = 'measured'
              AND g.audience_date = (SELECT MAX(m.audience_date) FROM l2_gold.audience_geo_daily m
                                      WHERE m.social_account_id = fa.social_account_id
                                        AND m.confidence = 'measured')))
   GROUP BY g.geo_key
  HAVING SUM(g.audience_count) > 0`

const AGE_FEATURE_ROWS = `
  SELECT e.key AS k, e.value::numeric AS v
    FROM jsonb_each_text(COALESCE(fa.age_gender_breakdown -> 'age', '{}'::jsonb)) e
   WHERE e.key IN (${AGE_BUCKETS.map(b => `'${b}'`).join(', ')}) AND e.value::numeric > 0`

const AGE_MEASURED_ROWS = `
  SELECT d.dimension_key AS k, SUM(d.audience_count) AS v
    FROM l2_gold.audience_demographics_daily d
   WHERE d.social_account_id = fa.social_account_id AND d.audience_type = 'age' AND d.confidence = 'measured'
     AND d.dimension_key IN (${AGE_BUCKETS.map(b => `'${b}'`).join(', ')})
     AND d.audience_date = (SELECT MAX(x.audience_date) FROM l2_gold.audience_demographics_daily x
                             WHERE x.social_account_id = fa.social_account_id
                               AND x.audience_type = 'age' AND x.confidence = 'measured')
   GROUP BY d.dimension_key
  HAVING SUM(d.audience_count) > 0`

/**
 * One row per social account with an Analysis Audience row:
 *   *_measured  the usable measured value, NULL when unusable
 *   curated_*   the curated label (fallback)
 *   *_final     COALESCE(measured, curated) -- the value Discovery serves
 */
export const AUDIENCE_FINAL = `
  SELECT fa.social_account_id, fa.platform,
         fa.female_pct, fa.male_pct, fa.gender_breakdown, fa.age_gender_breakdown,
         fa.curated_gender, fa.curated_age, fa.curated_country, fa.curated_city,
         gk.known AS gender_known,
         CASE WHEN gk.known >= ${MIN_KNOWN} AND fa.female_pct IS NOT NULL AND fa.male_pct IS NOT NULL THEN
              CASE WHEN fa.female_pct = fa.male_pct THEN 'balanced'
                   WHEN fa.female_pct > fa.male_pct
                        THEN CASE WHEN fa.female_pct >= ${GENDER_SHARE_MIN} THEN 'female' ELSE 'balanced' END
                   ELSE CASE WHEN fa.male_pct >= ${GENDER_SHARE_MIN} THEN 'male' ELSE 'balanced' END
              END
         END AS gender_measured,
         COALESCE(${TOP_USABLE(AGE_MEASURED_ROWS)}, ${TOP_USABLE(AGE_FEATURE_ROWS)}) AS age_measured,
         ${TOP_USABLE(GEO_ROWS('country'))} AS country_measured,
         ${TOP_USABLE(GEO_ROWS('city'))} AS city_measured
    FROM (SELECT 'instagram' AS platform, social_account_id, female_pct, male_pct, gender_breakdown,
                 age_gender_breakdown, curated_gender, curated_age, curated_country, curated_city
            FROM feature.ig_audience_analysis
          UNION ALL
          SELECT 'tiktok', social_account_id, female_pct, male_pct, gender_breakdown,
                 age_gender_breakdown, curated_gender, curated_age, curated_country, curated_city
            FROM feature.tt_audience_analysis) fa
    CROSS JOIN LATERAL (
      SELECT COALESCE((fa.gender_breakdown ->> 'female')::numeric, 0)
           + COALESCE((fa.gender_breakdown ->> 'male')::numeric, 0) AS known) gk`

/** AUDIENCE_FINAL plus the served values. */
export const AUDIENCE_SERVED = `
  SELECT a.*,
         COALESCE(a.gender_measured,  a.curated_gender)  AS gender_final,
         COALESCE(a.age_measured,     a.curated_age)     AS age_final,
         COALESCE(a.country_measured, a.curated_country) AS country_final,
         COALESCE(a.city_measured,    a.curated_city)    AS city_final
    FROM (${AUDIENCE_FINAL}) a`

/**
 * L2 geo rows behind `country_measured`/`city_measured`, for the detail chart:
 * same date semantics (newest measured day, else every inferred day summed), so
 * the chart and the usability decision read the same numbers. `unknown` stays
 * in, for the chart's coverage figure. $1 = kol_id.
 */
export const GEO_FOR_KOL = `
  WITH acct AS (
    SELECT ksa.social_account_id AS sa,
           (SELECT MAX(m.audience_date) FROM l2_gold.audience_geo_daily m
             WHERE m.social_account_id = ksa.social_account_id AND m.confidence = 'measured') AS measured_date
      FROM public.kol_social_account ksa WHERE ksa.kol_id = $1)
  SELECT g.geo_level, g.geo_key AS key, SUM(g.audience_count) AS n
    FROM acct a
    JOIN l2_gold.audience_geo_daily g ON g.social_account_id = a.sa
   WHERE a.measured_date IS NULL OR (g.confidence = 'measured' AND g.audience_date = a.measured_date)
   GROUP BY g.geo_level, g.geo_key`
