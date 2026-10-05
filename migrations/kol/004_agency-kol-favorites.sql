-- Up Migration
--
-- Favorite creators, per user within an agency.
--
--   npm run migrate:kol
--
-- ── Scope: the KOL server only ──────────────────────────────────────────────
-- Applied by `scripts/apply-kol-migration.js` through `PG_*_KOL`. Never run by
-- `npm run migrate:up`, which targets the analytics warehouse.
--
-- ── What it stores ──────────────────────────────────────────────────────────
-- The Favorite toggle on a Creator Database card, table row, Quick Insight and
-- creator profile (`KolDirectoryPage.tsx`, `KolCreatorWorkspace.tsx`) and the
-- favorites count in the directory header. Until now that set lived in the
-- browser (`useDiscoverSelection(orgId, 'fav')`), so it was lost with a cleared
-- cache and never followed the user to another device.
--
-- ── Ownership: (agency, user) ───────────────────────────────────────────────
-- A favorite is a personal mark — "I want to come back to this creator" — the
-- same reading this project's earlier warehouse design recorded
-- (`discover_favorites`, keyed by organization AND user). An agency-wide list
-- would mix every member's picks into one pile. The agency is still part of
-- the key: a user who belongs to two agencies keeps two separate lists, and
-- every read and write is authorised against `agency_members` first.
--
-- ── Lifecycle ───────────────────────────────────────────────────────────────
--   * agency deleted  → its favorites go with it (CASCADE).
--   * user deleted    → their favorites go with them (CASCADE).
--   * creator deleted → the favorite goes with it (CASCADE). The other foreign
--     keys to kol_directory are NO ACTION; this one is not, because a personal
--     bookmark must never be the reason the platform cannot remove a creator.
--   * a member leaving an agency keeps their rows, but every API read requires
--     an active membership, so they are unreachable until the user returns.
--
-- No updated_at: a favorite is created or removed, never edited.

CREATE TABLE IF NOT EXISTS public.agency_kol_favorites (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id      UUID        NOT NULL REFERENCES public.agencies(id)      ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES public."user"(id)        ON DELETE CASCADE,
  kol_account_id UUID        NOT NULL REFERENCES public.kol_directory(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Favoriting twice is one fact. `INSERT … ON CONFLICT DO NOTHING` relies on it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_kol_favorites
  ON public.agency_kol_favorites (agency_id, user_id, kol_account_id);

-- The list read: one user's favorites in one agency, newest first.
CREATE INDEX IF NOT EXISTS idx_agency_kol_favorites_owner
  ON public.agency_kol_favorites (agency_id, user_id, created_at DESC);

-- Deleting a creator has to find its favorites without a scan.
CREATE INDEX IF NOT EXISTS idx_agency_kol_favorites_kol
  ON public.agency_kol_favorites (kol_account_id);

-- Down Migration
-- Intentionally not provided, matching the `migrations/` convention in this
-- repo: dropping the table would discard users' favorites.
