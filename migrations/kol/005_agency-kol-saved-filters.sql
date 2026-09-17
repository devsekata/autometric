-- Up Migration
--
-- Saved Lists: named Creator Database filter sets, per user within an agency.
--
--   npm run migrate:kol
--
-- ── Scope: the KOL server only ──────────────────────────────────────────────
-- Applied by `scripts/apply-kol-migration.js` through `PG_*_KOL`. Never run by
-- `npm run migrate:up`, which targets the analytics warehouse.
--
-- ── What it stores ──────────────────────────────────────────────────────────
-- The "Saved Lists" popover in `KolDirectoryPage.tsx`: "Save current filters"
-- names the current filter set, a click reapplies it, the bin removes it, and
-- the toolbar shows how many exist. Until now the array lived in the browser
-- under `autometric.kolDirectory.lists.<org>`.
--
-- What is saved is exactly what the UI saves: a name and the `KolFilters`
-- object (`KolDirectoryFilters.tsx`). The search box is not part of it. The
-- filters are JSONB rather than columns because the object is a snapshot of a
-- UI shape that gains a key whenever a filter is added, and nothing queries its
-- contents — the page merges it over `KOL_FILTERS_DEFAULT` when applying.
--
-- ── Ownership: (agency, user) ───────────────────────────────────────────────
-- A saved list is one person's working view, the same reading this project's
-- earlier warehouse design recorded (`discover_saved_lists`, keyed by
-- organization AND user). Reads and writes are authorised against
-- `agency_members` first.
--
-- ── Lifecycle ───────────────────────────────────────────────────────────────
-- Agency or user deleted → their lists go with them (CASCADE). Saving under a
-- name that already exists updates that list (the unique index below), which
-- is why updated_at exists.

CREATE TABLE IF NOT EXISTS public.agency_kol_saved_filters (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id  UUID        NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES public."user"(id)   ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  filters    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_agency_kol_saved_filters_name CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT chk_agency_kol_saved_filters_filters CHECK (jsonb_typeof(filters) = 'object')
);

-- One list per name for a user in an agency; "Beauty Q3" and "beauty q3" are
-- the same list to a reader.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_kol_saved_filters_name
  ON public.agency_kol_saved_filters (agency_id, user_id, lower(btrim(name)));

-- The popover read: one user's lists in one agency, most recently saved first.
CREATE INDEX IF NOT EXISTS idx_agency_kol_saved_filters_owner
  ON public.agency_kol_saved_filters (agency_id, user_id, updated_at DESC);

-- Down Migration
-- Intentionally not provided, matching the `migrations/` convention in this
-- repo: dropping the table would discard users' saved lists.
