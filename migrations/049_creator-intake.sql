-- Up Migration
-- Creator intake: the accounts an org adds by hand, and what profiling learned
-- about them.
--
-- Discover has had two rosters and no way to add to either. `public.kol_directory`
-- is the commercial platform's roster and is read-only from here (see
-- @/lib/kolDb); `social_accounts` holds the org's own brand and competitor links,
-- which are tracked for dashboards and are not creators to hire. Neither one
-- answers "we heard about this creator, put them in our database" — which is the
-- whole intake flow: paste a handle, validate it against the platform, check it
-- is not already known, profile it, keep it fresh.
--
-- So this is a third roster, org-scoped, and the only one this app writes.

-- ── the creator ─────────────────────────────────────────────────────────────
-- One row per (org, platform, handle). Everything below the identity block is
-- nullable and stays null until profiling measures it: a creator added while
-- Apify is down is a real row with a real handle and no numbers, and writing 0
-- followers for "not measured yet" would make that indistinguishable from an
-- account nobody follows — the same distinction `er_pct` already carries on the
-- commercial roster.
CREATE TABLE IF NOT EXISTS public.discover_creators (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform           VARCHAR(20)   NOT NULL,
  username           TEXT          NOT NULL,
  profile_url        TEXT,
  display_name       TEXT,
  avatar_url         TEXT,
  bio                TEXT,
  -- What validation saw at the platform. 'private' is a first-class outcome,
  -- not an error: the flow deliberately lets a private account through with
  -- whatever little is public, and the profile has to keep saying which one it
  -- is so nobody reads a thin profile as a failed one.
  visibility         VARCHAR(10)   NOT NULL DEFAULT 'unknown',
  verified           BOOLEAN       NOT NULL DEFAULT false,
  category           TEXT,
  city               TEXT,
  followers          BIGINT,
  following          BIGINT,
  posts_count        BIGINT,
  avg_likes          NUMERIC(14,2),
  avg_comments       NUMERIC(14,2),
  avg_views          NUMERIC(14,2),
  -- Percentage points, e.g. 3.250 means 3.25% — the same unit and meaning as
  -- `kol_directory.engagement_rate`, so the two rosters can be read side by side.
  er_pct             NUMERIC(6,3),
  tier               VARCHAR(20),
  -- What the sampled posts looked like: dominant formats, recurring hashtags,
  -- posting cadence, top posts. JSONB rather than columns because this is
  -- descriptive output that will grow, and none of it is ever filtered on in SQL.
  content            JSONB,
  -- Profiling is asynchronous (Apify takes 1-8 minutes), so its state is a
  -- column and not something the request holds open.
  profiling_status   VARCHAR(12)   NOT NULL DEFAULT 'queued',
  profiling_error    TEXT,
  monitoring_enabled BOOLEAN       NOT NULL DEFAULT true,
  last_refreshed_at  TIMESTAMPTZ,
  created_by         UUID          REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE public.discover_creators
  DROP CONSTRAINT IF EXISTS chk_discover_creators_visibility;
ALTER TABLE public.discover_creators
  ADD CONSTRAINT chk_discover_creators_visibility
  CHECK (visibility IN ('public', 'private', 'unknown'));

ALTER TABLE public.discover_creators
  DROP CONSTRAINT IF EXISTS chk_discover_creators_status;
ALTER TABLE public.discover_creators
  ADD CONSTRAINT chk_discover_creators_status
  CHECK (profiling_status IN ('queued', 'running', 'ready', 'failed'));

-- The duplicate check the intake flow performs is this index. Handles are
-- case-insensitive on all three platforms, so @Raditya and @raditya are one
-- creator; storing both would give the org two profiles of the same person and
-- two refresh jobs fighting over one account.
CREATE UNIQUE INDEX IF NOT EXISTS uq_discover_creators_handle
  ON public.discover_creators (organization_id, platform, LOWER(username));

-- The roster list, which is ordered by recency within an org.
CREATE INDEX IF NOT EXISTS idx_discover_creators_org
  ON public.discover_creators (organization_id, created_at DESC);

-- ── profiling runs ──────────────────────────────────────────────────────────
-- One row per profiling attempt, initial or refresh, carrying the six steps the
-- progress screen draws.
--
-- Separate from the creator row because a refresh must not overwrite the record
-- of what the last run did, and because "profiled three times, failed twice at
-- the statistics step" is the answer to why a profile looks thin. `steps` is the
-- log itself, appended to as each step settles, so the screen renders from
-- stored state rather than from a guess about elapsed time.
CREATE TABLE IF NOT EXISTS public.discover_creator_runs (
  id          BIGSERIAL     PRIMARY KEY,
  creator_id  UUID          NOT NULL REFERENCES public.discover_creators(id) ON DELETE CASCADE,
  kind        VARCHAR(10)   NOT NULL DEFAULT 'initial',
  status      VARCHAR(10)   NOT NULL DEFAULT 'running',
  -- How many of the six have settled. Denormalised from `steps` so the polling
  -- endpoint can answer "4 of 6" without unpacking the array.
  step        SMALLINT      NOT NULL DEFAULT 0,
  steps       JSONB         NOT NULL DEFAULT '[]'::jsonb,
  error       TEXT,
  started_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

ALTER TABLE public.discover_creator_runs
  DROP CONSTRAINT IF EXISTS chk_discover_creator_runs_kind;
ALTER TABLE public.discover_creator_runs
  ADD CONSTRAINT chk_discover_creator_runs_kind
  CHECK (kind IN ('initial', 'refresh'));

ALTER TABLE public.discover_creator_runs
  DROP CONSTRAINT IF EXISTS chk_discover_creator_runs_status;
ALTER TABLE public.discover_creator_runs
  ADD CONSTRAINT chk_discover_creator_runs_status
  CHECK (status IN ('running', 'done', 'failed'));

-- Every read of this table asks for one creator's latest run.
CREATE INDEX IF NOT EXISTS idx_discover_creator_runs_latest
  ON public.discover_creator_runs (creator_id, started_at DESC);

-- ── monitoring history ──────────────────────────────────────────────────────
-- One row per creator per day, written by every completed run.
--
-- Without it a refresh is destructive: the new follower count lands on the
-- creator row and the old one is gone, so "is this creator growing" — the reason
-- monitoring exists at all — becomes unanswerable after the first refresh. Keyed
-- by Jakarta date so refreshing twice in a day corrects that day rather than
-- adding a second point, matching the snapshot tables in l0_raw.
CREATE TABLE IF NOT EXISTS public.discover_creator_snapshots (
  creator_id   UUID          NOT NULL REFERENCES public.discover_creators(id) ON DELETE CASCADE,
  captured_on  DATE          NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Jakarta')::date),
  followers    BIGINT,
  following    BIGINT,
  posts_count  BIGINT,
  er_pct       NUMERIC(6,3),
  avg_likes    NUMERIC(14,2),
  avg_comments NUMERIC(14,2),
  captured_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (creator_id, captured_on)
);

-- Down Migration
-- DROP TABLE IF EXISTS public.discover_creator_snapshots;
-- DROP TABLE IF EXISTS public.discover_creator_runs;
-- DROP TABLE IF EXISTS public.discover_creators;
