-- Up Migration
--
-- Company Website and Brand Values on the Brand Profile.
--
--   npm run migrate:kol
--
-- ── Scope: the KOL server only ──────────────────────────────────────────────
-- Applied by `scripts/apply-kol-migration.js` through `PG_*_KOL`. Never run by
-- `npm run migrate:up`, which targets the analytics warehouse.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- The Brand Profile form follows the product prototype (`brandProfileHTML`):
-- Company Profile carries "Company Website (optional)" and Brand Identity
-- carries "Brand Values". Neither had a column, so the form showed them as
-- "not saved". This gives both a home beside the fields they sit next to.
--
-- Brand Values was left out of 002 on purpose while nothing read it; the
-- product now asks for it to be saved. Storing it does not make it an input to
-- anything: no Brand Match, What Matters or Brand Fit code reads either column.
--
-- ── Shape ───────────────────────────────────────────────────────────────────
--   company_website  text, NULL       like brand_description: free text, and
--                                     NULL is "not given" (the field is optional)
--   brand_values     text[] NOT NULL  like brand_personality / brand_tone: a
--                    DEFAULT '{}'     list, empty rather than NULL when nothing
--                                     is chosen
-- Validated by the API (trimmed, de-duplicated, capped), not by a CHECK — the
-- same choice 001 made for its lists.
--
-- ── Additive and idempotent ────────────────────────────────────────────────
-- IF NOT EXISTS; no existing column changes, no row is read, rewritten or
-- deleted. Every existing row gets NULL and '{}'. Re-running is a no-op.

ALTER TABLE public.brand_profile
  ADD COLUMN IF NOT EXISTS company_website text,
  ADD COLUMN IF NOT EXISTS brand_values text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.brand_profile.company_website IS
  'Company website from the Brand Profile form (optional, free text). Not read by any scoring.';

COMMENT ON COLUMN public.brand_profile.brand_values IS
  'Brand Values from the Brand Profile form: the prototype''s vocabulary plus custom values, '
  'cleaned by the API. Empty = none chosen. Not read by Brand Match, What Matters or Brand Fit.';

-- Down Migration
-- Intentionally not provided, matching 001/002/007 and the `migrations/`
-- convention in this repo: dropping the columns would discard saved values.
