-- Up Migration
--
-- Brand Profile, on the KOL server.
--
-- ── Why this table exists at all ────────────────────────────────────────────
-- Brand Match had one half of its comparison on each of two different database
-- servers: the creator side on the KOL server (`public.kol_directory` and the
-- medallion schemas, read through `kolDb()`), and the brand side on the
-- analytics warehouse `tsdb` (`public.discover_brand_profiles`, read through
-- `@/lib/db`). A score could not be produced without both, which made an
-- ostensibly KOL feature hard-depend on a database it has no other reason to
-- touch.
--
-- This migration puts the brand side beside the creator side. After it,
-- everything Brand Match reads lives in one database and one pool.
--
-- ── Why NOT `public.brand` ──────────────────────────────────────────────────
-- Checked first, because reuse beats a new table. `public.brand` already
-- carries `category`, `brand_keywords` and `brand_hashtags` — the engine's
-- field names deliberately follow it. It was still rejected, on three counts:
--
--   Wrong grain      It is keyed by `agency_id` -> `agencies`. Brand Match is
--                    scoped per autometric ORGANIZATION, which is not a concept
--                    this database has. Adding `organization_id` to it would
--                    push an autometric concept into the commercial KOL
--                    platform's own brand record.
--
--   Six dependants   `inspirations`, `campaigns`, `campaign_orders`,
--                    `kol_reports`, `brand_members` and `brand_fit_analysis`
--                    all carry a FK to `brand(id)` and read it for IDENTITY.
--                    Widening it with eight matching-configuration columns
--                    enlarges the surface every one of those modules sees, and
--                    those modules are out of scope.
--
--   Still short      No `gender_majority`, `target_country`, `target_city`,
--                    `audience_interests`, `brand_personality`, and none of the
--                    Ideal Creator Profile fields.
--
-- ── Why the name is NOT `discover_brand_profiles` ───────────────────────────
-- That name is taken, on the OTHER server, by the table this one replaces. The
-- medallion schemas already demonstrate the hazard of one name on two servers:
-- `l1_silver` / `l2_gold` / `feature` exist on both, so a query sent to the
-- wrong pool returns different numbers without erroring once.
--
-- A distinct name removes that failure mode here. A query for `brand_profile`
-- sent to `tsdb` raises `relation does not exist` immediately; a query for
-- `discover_brand_profiles` sent to `tsdb` would quietly return zero rows and
-- present as "this workspace has no Brand Profile" — the exact wrong answer,
-- indistinguishable from the right one.
--
-- The `tsdb` table is left in place, untouched. Dropping it is a separate
-- decision that belongs to whoever owns that database.
--
-- ── No foreign keys leave this database ─────────────────────────────────────
-- `organization_id` and `updated_by` are bare UUIDs. `organizations` and
-- `users` live on `tsdb`; a FK to either would re-create across a schema
-- boundary exactly the cross-database dependency this migration removes.
-- PostgreSQL cannot express such a FK anyway, so the choice is between an
-- unenforced column and no column — and the column is what scopes the row.
--
-- `brand_id` carries no FK either, and that is deliberate rather than lazy:
-- `public.brand` here is the commercial platform's agency-scoped brand, whose
-- id space is NOT the one an autometric workspace labels itself with. A FK
-- would assert a correspondence that does not hold. It stays an opaque label
-- that nothing in the scoring path reads.
--
-- ── Additive only ───────────────────────────────────────────────────────────
-- No existing table is altered, no column added to one, no row read, written or
-- deleted. Every statement is `IF NOT EXISTS`, so re-running is a no-op.

CREATE TABLE IF NOT EXISTS public.brand_profile (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The autometric organization this profile belongs to. Unique because the
  -- Creator Database asks "what does this workspace want", which has one
  -- answer. Per-brand profiles are a later change to this constraint.
  organization_id      UUID        NOT NULL UNIQUE,
  -- Opaque label. See the note above on why it carries no FK.
  brand_id             UUID,

  /* ── Brand Identity ─────────────────────────────────────────────────────── */

  brand_name           VARCHAR(160),
  brand_description    TEXT,
  -- One of the nine canonical `public.kol_categories.taxonomy_key` values —
  -- the vocabulary both halves of every comparison speak. Left without a CHECK
  -- so the nine can grow without a migration; `CANONICAL_CATEGORIES` in
  -- `model.ts` validates it and the API rejects anything else.
  brand_category       VARCHAR(40),
  -- Collected and shown, NOT scored. There is no creator-personality column
  -- anywhere on this server, so Brand Personality Fit resolves to N/A for every
  -- creator and renormalises out of the weights. Kept because it is real brand
  -- configuration, and because it is what Personality Match will read on the
  -- day a creator-side signal exists.
  brand_personality    TEXT[]      NOT NULL DEFAULT '{}',

  /* ── Engine inputs: Brand & Business, and Content & Category ────────────── */

  brand_keywords       TEXT[]      NOT NULL DEFAULT '{}',
  brand_hashtags       TEXT[]      NOT NULL DEFAULT '{}',
  -- Terms searched in the creator's own captions for Topic Match. Separate from
  -- keywords because the schema treats them separately: a hashtag is what a
  -- post is filed under, a keyword is a word in a sentence, and a caption term
  -- is what the creator talks about.
  caption_terms        TEXT[]      NOT NULL DEFAULT '{}',

  /* ── Engine inputs: Target Audience ─────────────────────────────────────── */

  -- 'Any' | 'Female' | 'Male' | 'Balanced'. 'Any' scores 100 for everyone by
  -- design — the brand saying gender does not enter the decision, which is not
  -- the same as having no opinion recorded.
  gender_majority      VARCHAR(10) NOT NULL DEFAULT 'Any',
  target_country       VARCHAR(60),
  -- A key from `l2_gold.audience_geo_daily.geo_key`, not a display name.
  target_city          VARCHAR(60),
  -- Keys from `l2_gold.audience_interest_daily.interest_key`, lower case, with
  -- `sports` kept distinct from `fitness` because the database keeps them so.
  audience_interests   TEXT[]      NOT NULL DEFAULT '{}',

  /* ── Ideal Creator Profile — eligibility, not score ─────────────────────── */
  --
  -- These never enter the score. They define which creators the Creator
  -- Database offers at all, and each maps to a filter that already runs
  -- server-side against a column that is actually filled.

  preferred_categories TEXT[]      NOT NULL DEFAULT '{}',
  preferred_platforms  TEXT[]      NOT NULL DEFAULT '{}',
  preferred_tiers      TEXT[]      NOT NULL DEFAULT '{}',
  -- Stored and shown, not scored and not filtered on: the creator-side column
  -- is NULL in every row, so a gate on it would not select a population, it
  -- would empty one.
  content_styles       TEXT[]      NOT NULL DEFAULT '{}',

  -- NULL means "no bound" throughout. 0 is a real lower bound and is not the
  -- same thing.
  min_followers        BIGINT,
  min_er_pct           NUMERIC(6,3),
  require_category     BOOLEAN     NOT NULL DEFAULT false,
  verified_only        BOOLEAN     NOT NULL DEFAULT false,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The autometric user who last saved it. Bare UUID; see the FK note above.
  updated_by           UUID
);

-- The Creator Database reads this on every request that carries a match score,
-- so the organization lookup is the hot path — and UNIQUE already indexes it.
-- This one covers "which profiles point at this brand", the only other access
-- pattern the API has.
CREATE INDEX IF NOT EXISTS brand_profile_brand_idx
  ON public.brand_profile (brand_id)
  WHERE brand_id IS NOT NULL;

COMMENT ON TABLE public.brand_profile IS
  'What one autometric workspace wants from a creator, in the shape the Brand '
  'Match Engine scores against. Replaces tsdb.public.discover_brand_profiles, '
  'which is left in place but is no longer read. organization_id and '
  'updated_by are unenforced UUIDs: their tables live on another server.';

-- Down Migration
-- DROP TABLE IF EXISTS public.brand_profile;
