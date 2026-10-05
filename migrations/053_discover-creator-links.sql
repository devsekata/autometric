-- Up Migration
-- My Creators and Tracked Accounts, for creators that live in the KOL database.
--
-- Discovery's creator pool is `public.kol_directory` on the commercial KOL
-- server (see @/lib/kolDb) — 7.7k creators, global, read-only from here. Two
-- things an organization does with one of those creators had nowhere to be
-- written:
--
--   * "put this one in our working roster"  — My Creators
--   * "watch this one from now on"          — Tracked Accounts
--
-- Neither is a property of the creator. Both are a property of the relationship
-- between one organization and one creator, so both belong here, in the app
-- database, beside `discover_favorites` — and NOT as a copy of the creator row.
-- Duplicating the roster into the warehouse would give every org its own
-- divergent snapshot of a creator the KOL database is already keeping fresh.
--
-- ── Why one table and not two ───────────────────────────────────────────────
-- `in_roster` and `tracking_status` are two facts about the same relationship,
-- and every screen that shows a creator card needs both at once: the Creator
-- Database grid draws a "Saved" state and a "Tracking" state on the same row.
-- Two tables would mean two round trips and two sets of ids to reconcile per
-- page. One row per (org, creator) answers both in one read, and a creator with
-- neither fact set simply has no row.
--
-- ── Why `target_id` is not a foreign key ────────────────────────────────────
-- Same reason as `discover_favorites`, and the note there is the long version:
-- a Discovery creator is either a row in this database (`discover_creators`,
-- the creators this org profiled itself) or a row on the KOL server, which is a
-- different Postgres instance entirely. A UUID from that server cannot be
-- constrained here, so `target_source` carries which id space the value belongs
-- to — the same `account` / `roster` split `useDiscoverSelection` encodes as a
-- `roster:` key prefix and `discover_favorites` already stores as a column.
--
-- ── Org-scoped, not user-scoped ─────────────────────────────────────────────
-- Unlike a favourite, which is one person's bookmark, My Creators is the
-- organization's working roster and tracking spends the organization's refresh
-- budget. Both are decisions the whole workspace sees, so neither is keyed by
-- user. `roster_added_by` records who did it, for attribution only.
CREATE TABLE IF NOT EXISTS public.discover_creator_links (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_source       VARCHAR(10) NOT NULL,
  target_id           UUID        NOT NULL,

  -- My Creators membership.
  --
  -- Only meaningful for `target_source = 'roster'`. A row in
  -- `public.discover_creators` is already this org's own creator by
  -- construction — it has an `organization_id` column — so adopting one would
  -- be a fact stated twice, and the two could then disagree. My Creators reads
  -- as the union of that table and the rows flagged here.
  in_roster           BOOLEAN     NOT NULL DEFAULT false,
  roster_added_at     TIMESTAMPTZ,
  roster_added_by     UUID        REFERENCES public.users(id) ON DELETE SET NULL,

  -- Monitoring.
  --
  -- 'none' rather than a nullable column so the three states are one closed
  -- set: never tracked, tracked, tracked-but-paused. A creator that was tracked
  -- and then stopped keeps its row and its history — `tracking_started_at`
  -- still says when it began — because "we watched them for a month and
  -- stopped" is a different fact from "we never watched them".
  tracking_status     VARCHAR(10) NOT NULL DEFAULT 'none',
  tracking_started_at TIMESTAMPTZ,
  tracking_changed_at TIMESTAMPTZ,
  tracking_started_by UUID        REFERENCES public.users(id) ON DELETE SET NULL,

  -- When a refresh was last requested, and when one is next due.
  --
  -- `last_checked_at` is the request, not the result: every refresh path is
  -- asynchronous, so nothing at the moment of writing knows whether new numbers
  -- will land. How old the data is comes from the creator's own record instead.
  -- Neither column is written by this table's decision writers, and both stay
  -- null until something acts, so a screen can say "not checked yet" rather than
  -- printing the moment tracking was switched on as if it were a collection.
  --
  -- `next_check_at` has no writer yet: no scheduler runs in this app, and the
  -- screens print a due date only when the column actually carries one rather
  -- than inventing an interval nothing would honour.
  last_checked_at     TIMESTAMPTZ,
  next_check_at       TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.discover_creator_links
  DROP CONSTRAINT IF EXISTS chk_discover_creator_links_source;
ALTER TABLE public.discover_creator_links
  ADD CONSTRAINT chk_discover_creator_links_source
  CHECK (target_source IN ('account', 'roster'));

ALTER TABLE public.discover_creator_links
  DROP CONSTRAINT IF EXISTS chk_discover_creator_links_tracking;
ALTER TABLE public.discover_creator_links
  ADD CONSTRAINT chk_discover_creator_links_tracking
  CHECK (tracking_status IN ('none', 'active', 'paused'));

-- One relationship per (org, creator). The upserts in @/lib/discover/creatorLinks
-- rely on this: pressing Save and Track in quick succession both land on the
-- same row instead of racing to create two.
CREATE UNIQUE INDEX IF NOT EXISTS uq_discover_creator_links
  ON public.discover_creator_links (organization_id, target_source, target_id);

-- My Creators reads only the flagged rows, so the index carries the predicate
-- rather than making the planner scan an org's whole link set to find them.
CREATE INDEX IF NOT EXISTS idx_discover_creator_links_roster
  ON public.discover_creator_links (organization_id, roster_added_at DESC)
  WHERE in_roster;

-- Tracked Accounts reads the two live states; 'none' rows are history and are
-- never listed.
CREATE INDEX IF NOT EXISTS idx_discover_creator_links_tracking
  ON public.discover_creator_links (organization_id, tracking_status, tracking_changed_at DESC)
  WHERE tracking_status <> 'none';

-- Down Migration
-- DROP TABLE IF EXISTS public.discover_creator_links;
