-- Up Migration
--
-- What Matters on the Brand Profile: which of the six What Matters criteria a
-- workspace wants its Brand Match built from.
--
--   npm run migrate:kol
--
-- ── Scope: the KOL server only ──────────────────────────────────────────────
-- Applied by `scripts/apply-kol-migration.js` through `PG_*_KOL`. Never run by
-- `npm run migrate:up`, which targets the analytics warehouse.
--
-- ── Numbering ───────────────────────────────────────────────────────────────
-- 007, not 003: `public.pgmigrations` on the KOL server already records
-- 003_agency-kol-accounts-unique, 004_agency-kol-favorites,
-- 005_agency-kol-saved-filters and 006_agency-kol-accounts-monitoring.
--
-- ── Why a column on public.brand_profile ────────────────────────────────────
-- The product places "What matters most when evaluating creators?" inside the
-- Brand Profile form (Ideal Creator Profile), beside the other preferences this
-- table already holds (preferred_categories, preferred_platforms, ...). It is a
-- property of what the workspace wants, not of one user's working view — which
-- is why it is NOT a key inside `agency_kol_saved_filters`, whose rows are one
-- user's named filter snapshots.
--
-- Grain is therefore brand_profile's: one row per organization
-- (UNIQUE organization_id = public.agencies.id). One agency, one selection.
--
-- ── Shape ───────────────────────────────────────────────────────────────────
-- text[] of criterion keys, from a closed vocabulary of six:
--   strong_engagement, high_audience_quality, consistent_performance,
--   strong_community, high_reach, content_quality
-- Validated by the API (`WHAT_MATTERS_KEYS`), not by a CHECK — the same choice
-- 001 made for brand_category, so the vocabulary can change without a
-- migration. Brand Safety is not in it.
--
-- NOT NULL DEFAULT '{}': an empty selection is a real answer ("nothing chosen
-- yet") and makes Brand Match unavailable rather than invented. Every existing
-- row (0 today) gets '{}'.
--
-- No weights are stored: every selected criterion counts equally, and Brand
-- Match is the arithmetic mean of the selected scores that exist.
--
-- ── Additive and idempotent ────────────────────────────────────────────────
-- IF NOT EXISTS; no existing column changes, no row is read, rewritten or
-- deleted. Re-running is a no-op.

ALTER TABLE public.brand_profile
  ADD COLUMN IF NOT EXISTS what_matters text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.brand_profile.what_matters IS
  'What Matters the workspace chose for Brand Match. Keys, closed vocabulary '
  'validated by the API: strong_engagement, high_audience_quality, '
  'consistent_performance, strong_community, high_reach, content_quality. '
  'Brand Match = arithmetic mean of the KOL''s What Matters scores on these, '
  'equal weight, a missing score left out of the mean. Empty = nothing chosen, '
  'Brand Match unavailable. Grain follows brand_profile: one per organization.';

-- Down Migration
-- Intentionally not provided, matching 001/002 and the `migrations/`
-- convention in this repo: dropping the column would discard saved choices.
