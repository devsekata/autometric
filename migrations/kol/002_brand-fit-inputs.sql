-- Up Migration
--
-- Brand-side inputs that Brand Fit needs and nothing else supplies yet.
--
--   npm run migrate:kol
--
-- ── Scope: the KOL server only ──────────────────────────────────────────────
-- This file lives under `migrations/kol/` and is applied by
-- `scripts/apply-kol-migration.js`, which dials `PG_*_KOL`. It must never be
-- run by `npm run migrate:up` — that command targets the warehouse `tsdb`
-- through `DATABASE_URL`, and Brand Fit reads and writes nothing there.
--
-- ── Why `public.brand_profile` and not `public.brand` ───────────────────────
-- Brand Fit's grain is `(agency_kol_account_id, brand_id)` and its `brand_id`
-- is a FK to `public.brand`, so `public.brand` is the identity of the brand
-- being scored and stays exactly as it is. What it does NOT carry is matching
-- configuration — it has `category`, `brand_keywords` and `brand_hashtags` and
-- nothing else — and migration 001 already recorded why widening it is the
-- wrong move: six modules (`inspirations`, `campaigns`, `campaign_orders`,
-- `kol_reports`, `brand_members` and `brand_fit_analysis`) read it for identity
-- and all six are out of scope.
--
-- `public.brand_profile` is this app's own table on this same server, created
-- by 001 to hold precisely this kind of configuration, and it already carries
-- five of the eight inputs Brand Fit needs:
--
--   brand_category      already constrained to the nine canonical categories
--   brand_personality   text[]
--   gender_majority     Any / Female / Male / Balanced
--   target_country      ISO-2
--   target_city
--   audience_interests  text[]
--
-- So three inputs are missing, and they are added here rather than in a new
-- table: a second brand-side table would be a duplicate source for the same
-- question, which is the one thing Brand Fit's own column comment on
-- `sub_scores` warns against.
--
-- ── Additive and idempotent ────────────────────────────────────────────────
-- Every statement is `IF NOT EXISTS`, every new column is nullable or has a
-- default, and no existing row is read, rewritten or deleted. Re-running is a
-- no-op. Nothing here computes a score or inserts a brand.

ALTER TABLE public.brand_profile
  ADD COLUMN IF NOT EXISTS brand_tone text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.brand_profile
  ADD COLUMN IF NOT EXISTS target_age_min smallint;

ALTER TABLE public.brand_profile
  ADD COLUMN IF NOT EXISTS target_age_max smallint;

ALTER TABLE public.brand_profile
  ADD COLUMN IF NOT EXISTS performance_targets jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.brand_profile.brand_tone IS
  'Brand Fit — Values Alignment. Joined with brand_personality to form the '
  'brand attribute set, which is the DENOMINATOR of matched/brand x 100. Kept '
  'separate from brand_personality because the two are different questions '
  '(who the brand is vs how it speaks) and Brand Match reads only the former.';

COMMENT ON COLUMN public.brand_profile.target_age_min IS
  'Brand Fit — Audience Overlap, age dimension. Inclusive lower bound of the '
  'brand target age. NULL means the brand states no age target, and the age '
  'dimension is then NOT MEASURED rather than scored 0.';

COMMENT ON COLUMN public.brand_profile.target_age_max IS
  'Brand Fit — Audience Overlap, age dimension. Inclusive upper bound. NULL '
  'means no age target; see target_age_min.';

COMMENT ON COLUMN public.brand_profile.performance_targets IS
  'Brand Fit — Past Performance, Option B (direct metric). Object of '
  'metric -> target value, e.g. {"engagement_rate": 3, "median_views": 50000}. '
  'Recognised keys: engagement_rate, median_views, followers_growth, '
  'post_frequency_reliability, performance_stability. A metric with no target '
  'is NOT MEASURED, and {} means Past Performance as a whole is NOT MEASURED. '
  'Deliberately NOT a performance archetype: the POC showed the workbook''s '
  'archetype pairs contradict one another and cannot be generalised.';

-- Brand Fit is read per brand ("score this brand against the roster") far more
-- often than per creator, and the existing UNIQUE index is on
-- (agency_kol_account_id, brand_id), whose leading column is the wrong one for
-- that query.
CREATE INDEX IF NOT EXISTS idx_brand_fit_analysis_brand
  ON feature.brand_fit_analysis (brand_id);

-- Down Migration
-- Intentionally not provided, matching 001 and the `migrations/` convention in
-- this repo. Dropping these columns would discard brand-side configuration that
-- exists nowhere else; removing the index is not worth a migration.
