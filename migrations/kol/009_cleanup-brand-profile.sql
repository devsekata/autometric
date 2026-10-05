-- Up Migration
--
-- Brand Profile cleanup: public.brand_profile keeps exactly the columns the
-- Brand Profile form and API use.
--
--   npm run migrate:kol
--
-- ── Scope: the KOL server only ──────────────────────────────────────────────
-- Applied by `scripts/apply-kol-migration.js` through `PG_*_KOL`. Never run by
-- `npm run migrate:up`, which targets the analytics warehouse.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- The Brand Profile form now follows the product prototype (`brandProfileHTML`):
-- Company Profile, Target Audience, Brand Identity, Ideal Creator Profile and
-- What Matters. These nine columns have no field in that form and no reader
-- anywhere — audited before this file was written:
--
--   brand_keywords, brand_hashtags, caption_terms   (was "Brand Keywords & Topics")
--   brand_tone, performance_targets                 (Brand Fit inputs from 002;
--                                                    no Brand Fit reads them)
--   min_followers, min_er_pct                       (Ideal Creator minimums)
--   require_category, verified_only                 (eligibility toggles)
--
-- The only code that read or wrote them was the Brand Profile service itself.
-- The Directory's own `minFollowers` / `minEr` / `verifiedOnly` are URL filters
-- with the same names, not these columns. No view, rule, function, index or
-- constraint depends on them.
--
-- Kept, although not a form field: id, organization_id (tenant, UNIQUE),
-- brand_id (returned by the API, rejected on write, indexed), created_at,
-- updated_at, updated_by.
--
-- ── Safe ────────────────────────────────────────────────────────────────────
-- DROP COLUMN only; no row is deleted, and no kept column changes. The table
-- held 0 rows when this was written. IF EXISTS makes a re-run a no-op.

ALTER TABLE public.brand_profile
  DROP COLUMN IF EXISTS brand_keywords,
  DROP COLUMN IF EXISTS brand_hashtags,
  DROP COLUMN IF EXISTS caption_terms,
  DROP COLUMN IF EXISTS brand_tone,
  DROP COLUMN IF EXISTS performance_targets,
  DROP COLUMN IF EXISTS min_followers,
  DROP COLUMN IF EXISTS min_er_pct,
  DROP COLUMN IF EXISTS require_category,
  DROP COLUMN IF EXISTS verified_only;

-- Down Migration
-- Intentionally not provided, matching 001/002/007/008: the dropped columns held
-- no rows. Re-adding one needs its own migration, with its own reason.
