-- Up Migration
--
-- My Creators monitoring state, per (agency, creator) — D015 / D051.
--
--   npm run migrate:kol
--
-- ── Scope: the KOL server only ──────────────────────────────────────────────
-- Applied by `scripts/apply-kol-migration.js` through `PG_*_KOL`. Never run by
-- `npm run migrate:up`, which targets the analytics warehouse.
--
-- ── Why here ────────────────────────────────────────────────────────────────
-- Monitoring is chosen per agency for each of its creators ("Monitored" or
-- "Paused" on a My Creators card), and `public.agency_kol_accounts` is exactly
-- that pair (unique on agency_id, kol_account_id — migration 003). No existing
-- column can hold it: `status` and `is_active` are the link's own state (My
-- Creators add/remove and Add KOL rewrite them), and
-- `kol_directory.refresh_tier` is per creator, shared by every agency.
--
-- The value is stored only. Nothing schedules or skips a scrape on it yet.
--
-- ── What this does to existing data ─────────────────────────────────────────
-- One additive column. Every existing link reads `true` through the column
-- DEFAULT (PostgreSQL 11+ stores a constant default in the catalog, so the
-- table is not rewritten and no row is updated). Every new link — Add KOL's
-- `ensureAgencyLink` and My Creators' `addMyCreator` both insert without
-- naming this column — starts Monitored. Reactivating an inactive link does
-- not touch the column, so a Paused creator stays Paused.
--
-- The lock timeout keeps the ALTER from queueing behind a long transaction
-- and blocking readers; it fails instead, and the transaction rolls back.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.agency_kol_accounts
  ADD COLUMN IF NOT EXISTS monitoring_enabled boolean NOT NULL DEFAULT true;

-- Down Migration
-- Intentionally not provided, matching the `migrations/` convention in this
-- repo. `ALTER TABLE public.agency_kol_accounts DROP COLUMN monitoring_enabled;`
-- would undo it (and discard every Paused choice).
