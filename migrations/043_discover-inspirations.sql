-- Up Migration
-- Saved content for the Discover module ("Inspirations").
--
-- Discover browses two different post tables — l1_silver.unified_post for the
-- org's own brand posts and l1_silver.unified_competitor_post for competitor
-- posts — and both use a bigint surrogate id that is only unique within its own
-- table. A single `post_id BIGINT` column would therefore silently collide
-- across sources, so the reference is the pair (source, post_row_id) and every
-- lookup carries both.
--
-- No foreign key to either post table on purpose. The medallion layers are
-- rebuilt by the ingest pipeline (rows are deleted and re-inserted on re-sync),
-- so an FK would either block the pipeline or cascade users' saved items away
-- on an unrelated refresh. Reads resolve the join at query time and simply skip
-- rows whose post no longer exists, which is the behaviour we want anyway.
--
-- Scope is the organization, not the user: the Discover panel is a shared
-- shortlist a team builds together for briefs, so anyone in the org sees the
-- same list. `saved_by_user_id` records who added it (shown in the UI and used
-- for "added by you" affordances) but is deliberately NOT part of the unique
-- key — two people saving the same post is one entry, not two.
CREATE TABLE IF NOT EXISTS public.discover_inspirations (
  id               BIGSERIAL   PRIMARY KEY,
  organization_id  UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  saved_by_user_id UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  source           VARCHAR(10) NOT NULL,
  post_row_id      BIGINT      NOT NULL,
  platform         VARCHAR(20) NOT NULL,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 'brand'      -> l1_silver.unified_post.id
-- 'competitor' -> l1_silver.unified_competitor_post.id
ALTER TABLE public.discover_inspirations
  DROP CONSTRAINT IF EXISTS chk_discover_inspirations_source;
ALTER TABLE public.discover_inspirations
  ADD CONSTRAINT chk_discover_inspirations_source
  CHECK (source IN ('brand', 'competitor'));

-- One entry per post per org — the toggle is an upsert against this key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_discover_inspirations_org_post
  ON public.discover_inspirations (organization_id, source, post_row_id);

-- The panel lists an org's saves newest-first on every Discover page load.
CREATE INDEX IF NOT EXISTS idx_discover_inspirations_org_created
  ON public.discover_inspirations (organization_id, created_at DESC);

-- Down Migration
-- DROP INDEX IF EXISTS idx_discover_inspirations_org_created;
-- DROP INDEX IF EXISTS uq_discover_inspirations_org_post;
-- DROP TABLE IF EXISTS public.discover_inspirations;
