-- Up Migration
--
-- Drop Brand personality and Brand values from public.brand_profile.
--
--   npm run migrate:kol
--
-- ── Scope: the KOL server only ──────────────────────────────────────────────
-- Applied by `scripts/apply-kol-migration.js` through `PG_*_KOL`. Never run by
-- `npm run migrate:up`, which targets the analytics warehouse.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- Brand personality and Brand values were removed from the Brand Profile form,
-- from the Brand Profile API and from Brand Fit scoring (its Values component).
-- Nothing reads or writes either column any more — audited before this file
-- was written:
--
--   brand_personality  (001)  was Brand Fit's Values input; no longer read
--   brand_values       (008)  stored and shown only; no longer read or written
--
-- No index, constraint, foreign key, trigger, view, rule, function, policy or
-- publication references them. Their only dependents are their own
-- `DEFAULT '{}'`, which DROP COLUMN removes with the column.
--
-- ── Data ────────────────────────────────────────────────────────────────────
-- DROP COLUMN discards the values held in these two columns (1 row had both
-- filled when this was written). No row is deleted and no other column
-- changes. IF EXISTS makes a re-run a no-op.

ALTER TABLE public.brand_profile
  DROP COLUMN IF EXISTS brand_personality,
  DROP COLUMN IF EXISTS brand_values;

-- Down Migration
-- Intentionally not provided, matching 001/002/007/008/009. Re-adding either
-- column needs its own migration, with its own reason.
