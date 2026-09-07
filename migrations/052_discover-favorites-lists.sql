-- Up Migration
-- Favourites and Saved Lists — the two Discovery features that were being kept
-- in the browser.
--
-- Both already existed and both were `localStorage` only: `useDiscoverSelection`
-- persisted favourites under `autometric:discover:fav:<org>`, and two separate
-- `useSavedLists` hooks (one in `DiscoverDirectoryView`, one in
-- `KolDirectoryPage`) each kept their own array under their own key. That works
-- until the user opens a second browser, and it means a shortlist built over an
-- afternoon dies with a cleared cache. Neither is temporary UI state, so both
-- move here.
--
-- Scoped by (organization, user) rather than by organization alone. A favourite
-- is a personal mark — "I want to come back to this creator" — and an org-wide
-- favourite list would mix five people's shortlists into one pile. Compare and
-- Cart deliberately stay in the browser: those are a single session's working
-- set, not a saved decision.

-- ── favourites ──────────────────────────────────────────────────────────────
-- One row per creator a user has starred.
--
-- `target_id` is NOT a foreign key, and that is the point. Discovery spans two
-- databases: a creator card is either an account this org tracks in the
-- warehouse (`discover_creators` / `social_accounts`) or a row from the
-- commercial KOL roster, which lives on a different Postgres server entirely
-- (see @/lib/kolDb). A UUID from that server cannot be constrained here, so
-- `target_source` carries which id space the value belongs to — the same
-- `account` / `roster` split `useDiscoverSelection` already encodes as a
-- `roster:` key prefix, lifted out of the string and into a column.
CREATE TABLE IF NOT EXISTS public.discover_favorites (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_source   VARCHAR(10) NOT NULL,
  target_id       UUID        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.discover_favorites
  DROP CONSTRAINT IF EXISTS chk_discover_favorites_source;
ALTER TABLE public.discover_favorites
  ADD CONSTRAINT chk_discover_favorites_source
  CHECK (target_source IN ('account', 'roster'));

-- Favouriting twice is the same fact, not two. The toggle relies on this:
-- `INSERT … ON CONFLICT DO NOTHING` is what makes a double-click idempotent
-- rather than a duplicate row the count then double-counts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_discover_favorites
  ON public.discover_favorites (organization_id, user_id, target_source, target_id);

-- The list read: one user's favourites in an org, newest first.
CREATE INDEX IF NOT EXISTS idx_discover_favorites_owner
  ON public.discover_favorites (organization_id, user_id, created_at DESC);

-- ── saved lists ─────────────────────────────────────────────────────────────
-- A named filter configuration, and optionally the creators picked under it.
--
-- `scope` exists because Discovery has two directories with different filter
-- shapes: the Creator Database (`KolDirectoryPage`, filtering the commercial
-- roster) and Tracked Accounts (`DiscoverDirectoryView`, filtering the org's own
-- accounts). A list saved against one is meaningless applied to the other — the
-- field names do not even overlap — so the column keeps them apart instead of
-- letting a Tracked Accounts list silently no-op on the database grid.
--
-- `filters` is JSONB rather than columns because it is a snapshot of a UI shape
-- that changes whenever a filter is added, and nothing here is ever queried by
-- its contents. The reading component validates it; a list saved before a filter
-- existed simply lacks that key.
CREATE TABLE IF NOT EXISTS public.discover_saved_lists (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scope           VARCHAR(16) NOT NULL DEFAULT 'database',
  name            TEXT        NOT NULL,
  description     TEXT,
  filters         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.discover_saved_lists
  DROP CONSTRAINT IF EXISTS chk_discover_saved_lists_scope;
ALTER TABLE public.discover_saved_lists
  ADD CONSTRAINT chk_discover_saved_lists_scope
  CHECK (scope IN ('database', 'tracked'));

ALTER TABLE public.discover_saved_lists
  DROP CONSTRAINT IF EXISTS chk_discover_saved_lists_name;
ALTER TABLE public.discover_saved_lists
  ADD CONSTRAINT chk_discover_saved_lists_name
  CHECK (length(btrim(name)) BETWEEN 1 AND 80);

-- Saving over an existing name updates it rather than making a second list with
-- the same label, which is what the old localStorage hooks did by array index.
-- Case-insensitive because "Beauty Q3" and "beauty q3" are one list to a reader.
CREATE UNIQUE INDEX IF NOT EXISTS uq_discover_saved_lists_name
  ON public.discover_saved_lists (organization_id, user_id, scope, LOWER(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_discover_saved_lists_owner
  ON public.discover_saved_lists (organization_id, user_id, scope, updated_at DESC);

-- ── saved list membership ───────────────────────────────────────────────────
-- The creators explicitly pinned into a list, for the case where a list is a
-- collection rather than a query.
--
-- Same two-id-space problem as favourites, solved the same way, for the same
-- reason — see the note above `discover_favorites`.
CREATE TABLE IF NOT EXISTS public.discover_saved_list_items (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_list_id UUID        NOT NULL REFERENCES public.discover_saved_lists(id) ON DELETE CASCADE,
  target_source VARCHAR(10) NOT NULL,
  target_id     UUID        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.discover_saved_list_items
  DROP CONSTRAINT IF EXISTS chk_discover_saved_list_items_source;
ALTER TABLE public.discover_saved_list_items
  ADD CONSTRAINT chk_discover_saved_list_items_source
  CHECK (target_source IN ('account', 'roster'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_discover_saved_list_items
  ON public.discover_saved_list_items (saved_list_id, target_source, target_id);

CREATE INDEX IF NOT EXISTS idx_discover_saved_list_items_list
  ON public.discover_saved_list_items (saved_list_id, created_at);

-- Down Migration
-- DROP TABLE IF EXISTS public.discover_saved_list_items;
-- DROP TABLE IF EXISTS public.discover_saved_lists;
-- DROP TABLE IF EXISTS public.discover_favorites;
