-- Up Migration
--
-- One My Creators link per (agency, creator).
--
--   npm run migrate:kol
--
-- ── Scope: the KOL server only ──────────────────────────────────────────────
-- Applied by `scripts/apply-kol-migration.js` through `PG_*_KOL`. Never run by
-- `npm run migrate:up`, which targets the analytics warehouse.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- `public.agency_kol_accounts` is the agency ↔ creator relation My Creators
-- reads and writes (`src/lib/discover/myCreators.ts`, and Add KOL's
-- `ensureAgencyLink`). The table has no constraint on the pair and no index on
-- `agency_id` at all — only its primary key — so both writers had to rely on an
-- advisory lock to avoid inserting the same link twice, and every My Creators
-- read scanned the table.
--
-- `kol_account_id` already fixes the platform (a `kol_directory` row belongs to
-- one platform), so the pair is the natural key. Removal deactivates the row
-- (`is_active = false`) and re-adding reactivates the same row, so inactive
-- links are covered by the same key.
--
-- Checked before writing this (17 Sep 2026, read-only): 7,431 rows, 0 duplicate
-- pairs, 0 rows with a NULL agency_id or kol_account_id. The index therefore
-- builds without touching or removing a single row.
--
-- The index also serves the My Creators lookup `WHERE agency_id = $1`.

CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_kol_accounts_agency_kol
  ON public.agency_kol_accounts (agency_id, kol_account_id);

-- Down Migration
-- Intentionally not provided, matching the `migrations/` convention in this
-- repo. `DROP INDEX public.uq_agency_kol_accounts_agency_kol;` would undo it.
