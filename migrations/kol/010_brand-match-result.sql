-- Up Migration
--
-- Brand Match results, computed in the background and kept per agency.
--
--   npm run migrate:kol
--
-- ── Scope: the KOL server only ──────────────────────────────────────────────
-- Applied by `scripts/apply-kol-migration.js` through `PG_*_KOL`. Never run by
-- `npm run migrate:up`, which targets the analytics warehouse.
--
-- ── Why a table is needed ───────────────────────────────────────────────────
-- Brand Match used to be computed only while the Directory asked for it
-- (`?match=1`). The requirement now is automation: a Brand Profile save, or KOL
-- data reaching L2, must RECALCULATE Brand Match in the background and leave
-- the latest result available. A result computed by a job has to be kept
-- somewhere, and no existing table can hold it: `feature.brand_fit_analysis` is
-- Brand Fit, keyed to `public.brand` (0 rows) — a different score.
--
-- ── Not a second source of truth ───────────────────────────────────────────
-- Every row is DERIVED: the output of the existing Brand Match calculation
-- (`whatMatters/brandMatch.ts`) over `brand_profile.what_matters` and the KOL
-- tables. Nothing is copied from a creator; a row carries the two versions it
-- was computed from, and a reader uses it only while both are still current —
-- otherwise the Directory computes on demand, as before.
--
--   brand_match_result   one row per (agency, creator): Match % and breakdown
--   brand_match_state    one row per agency: the last job's status, versions,
--                        row count, timings and error
--
-- ── Additive and idempotent ────────────────────────────────────────────────
-- New tables only, IF NOT EXISTS; nothing existing is read or changed.

CREATE TABLE IF NOT EXISTS public.brand_match_result (
  agency_id           uuid        NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  kol_directory_id    uuid        NOT NULL REFERENCES public.kol_directory(id) ON DELETE CASCADE,
  -- Mean of the chosen What Matters scores that exist; NULL when none do.
  match_pct           numeric,
  -- 'no_scores' when every chosen criterion is unmeasured; NULL otherwise.
  unavailable         text,
  contributing        smallint    NOT NULL,
  selected            smallint    NOT NULL,
  breakdown           jsonb       NOT NULL,
  -- The versions this row was computed from.
  profile_updated_at  timestamptz NOT NULL,
  data_version        text        NOT NULL,
  calculated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, kol_directory_id)
);

CREATE TABLE IF NOT EXISTS public.brand_match_state (
  agency_id           uuid        PRIMARY KEY REFERENCES public.agencies(id) ON DELETE CASCADE,
  status              text        NOT NULL
                      CHECK (status IN ('running', 'done', 'no_selection', 'failed')),
  -- What triggered the last run: 'brand_profile', 'kol_data', 'manual'.
  trigger             text,
  profile_updated_at  timestamptz,
  data_version        text,
  rows_written        integer,
  started_at          timestamptz,
  finished_at         timestamptz,
  error               text
);

COMMENT ON TABLE public.brand_match_result IS
  'Brand Match per (agency, creator), computed in the background by the existing Brand Match '
  'calculation. Derived, never edited. Valid only while profile_updated_at equals the agency''s '
  'brand_profile.updated_at and data_version equals the current KOL data fingerprint.';
COMMENT ON TABLE public.brand_match_state IS
  'Last Brand Match background job per agency: status, the versions it computed from, row count, error.';

-- Down Migration
-- Intentionally not provided, matching 001/002/007/008/009: rows here are
-- derived and are rebuilt by the next Brand Match job.
