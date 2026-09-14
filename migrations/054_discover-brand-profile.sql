-- Up Migration
-- The Brand Profile: what a workspace wants from a creator, in the shape the
-- Brand Match Engine scores against.
--
-- Until now nothing in autometric recorded what a brand IS. The Creator
-- Database could rank by follower count and engagement rate, and the "match"
-- it showed was a restatement of the filters the user had just set — it could
-- not answer "is this creator right for US", because nothing had ever been
-- told who "us" is. This table is that missing half.
--
-- ── Why here and not in an existing brands table ────────────────────────────
-- Two brand tables already exist and neither can hold this:
--
--   `public.brands` (this database) is org membership and a profile URL —
--   id, organization_id, name, profile_url. It carries no category, no
--   keywords, no targeting, and widening it would put matching configuration
--   into the table the Brands module, Campaign and Reports all read for
--   identity. Those modules are explicitly out of scope.
--
--   `public.brand` on the KOL server DOES have `category`, `brand_keywords`
--   and `brand_hashtags` — and the engine's field names follow it deliberately.
--   But it belongs to the commercial KOL platform, is keyed by `agency_id`
--   rather than by an autometric organization, and this app only ever writes to
--   that server through the Add-KOL pipeline. A workspace's own matching
--   configuration is not an agency's brand record.
--
-- So this is a `discover_*` table beside `discover_favorites`,
-- `discover_saved_lists` and `discover_creator_links` — the same shape of thing
-- they are: a fact about what one organization wants, not about what a creator
-- is.
--
-- ── One profile per organization ────────────────────────────────────────────
-- `brand_id` is nullable and carries no uniqueness of its own: it labels the
-- profile with an existing brand when the workspace has one, and the profile
-- still exists when it does not. The Creator Database asks "what does this
-- workspace want", which is a question with one answer — so the unique key is
-- the organization. Per-brand profiles are a later change to this constraint,
-- not a different table.
--
-- ── Brand Values is deliberately absent ─────────────────────────────────────
-- Brand Personality and Brand Category are here and are load-bearing.
-- Brand Values is not, and must not be added to the Brand Identity section: the
-- engine's Values Match (W_BP_VALUES) scores against a creator-values column
-- that does not exist on the KOL server, so the whole Brand Personality Fit
-- component resolves to N/A and renormalises away. Collecting values from a
-- user would be asking them to fill in a field that cannot affect any score.
--
-- ── Every array column is an engine input, and each is honest about reach ───
-- The columns below feed `src/lib/discover/brandMatch/score.ts` directly. Three
-- of them are sparse on the creator side today and the UI says so where it
-- collects them: keywords and caption terms are searched in bios (~12% filled)
-- and captions (50 creators), hashtags in a harvest that reaches ~300 posts.
-- They stay because when they hit they are strong evidence, and because they
-- improve as the pipeline fills out.
CREATE TABLE IF NOT EXISTS public.discover_brand_profiles (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL UNIQUE
                                   REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Labels the profile with one of the org's brands. ON DELETE SET NULL, not
  -- CASCADE: deleting a brand must not silently delete the workspace's matching
  -- configuration along with it.
  brand_id             UUID        REFERENCES public.brands(id) ON DELETE SET NULL,

  /* ── Brand Identity ─────────────────────────────────────────────────────── */

  brand_name           VARCHAR(160),
  brand_description    TEXT,
  -- One of the nine canonical `public.kol_categories.taxonomy_key` values, which
  -- is the vocabulary both halves of every comparison speak. Not free text: a
  -- category the creator side cannot express is a category that scores nothing.
  -- Left unconstrained by a CHECK so the nine can grow on the KOL server without
  -- a migration here; `CANONICAL_CATEGORIES` in model.ts is what validates it,
  -- and the API rejects anything else.
  brand_category       VARCHAR(40),
  -- Descriptive, and currently unscored — see the Brand Values note above. Kept
  -- because it is real brand configuration the product asks for, and because it
  -- is what Personality Match will read the day a creator-personality signal
  -- exists.
  brand_personality    TEXT[]      NOT NULL DEFAULT '{}',

  /* ── Engine inputs: Brand & Business, and Content & Category ────────────── */

  brand_keywords       TEXT[]      NOT NULL DEFAULT '{}',
  brand_hashtags       TEXT[]      NOT NULL DEFAULT '{}',
  -- Terms searched in the creator's own captions for Topic Match. Separate from
  -- keywords because the schema treats them separately: a hashtag is what a post
  -- is filed under, a keyword is a word that appeared in a sentence, and a
  -- caption term is what the creator talks about.
  caption_terms        TEXT[]      NOT NULL DEFAULT '{}',

  /* ── Engine inputs: Target Audience ─────────────────────────────────────── */

  -- 'Any' | 'Female' | 'Male' | 'Balanced'. 'Any' scores 100 for everyone by
  -- design — it is the brand saying gender does not enter the decision, which is
  -- different from having no opinion recorded.
  gender_majority      VARCHAR(10) NOT NULL DEFAULT 'Any',
  target_country       VARCHAR(60),
  -- A key from `l2_gold.audience_geo_daily.geo_key`, not a display name.
  target_city          VARCHAR(60),
  -- Keys from `l2_gold.audience_interest_daily.interest_key`, lower case, with
  -- `sports` distinct from `fitness` because the database keeps them distinct.
  audience_interests   TEXT[]      NOT NULL DEFAULT '{}',

  /* ── Ideal Creator Profile ──────────────────────────────────────────────── */
  --
  -- These do not enter the score. They define the ELIGIBLE POPULATION — which
  -- creators the Creator Database offers at all — and each one maps to a filter
  -- the directory already runs server-side against a column that is actually
  -- filled. A preference expressed as a gate on an empty column does not select
  -- a population, it empties one, so nothing here targets a blocked field.

  preferred_categories TEXT[]      NOT NULL DEFAULT '{}',
  preferred_platforms  TEXT[]      NOT NULL DEFAULT '{}',
  preferred_tiers      TEXT[]      NOT NULL DEFAULT '{}',
  -- Collected and shown, not scored: `feature.*_post_analysis.content_category`
  -- is NULL in all 212 rows, so Content Style Match is N/A for every creator.
  -- Stored so the preference survives until the column is filled.
  content_styles       TEXT[]      NOT NULL DEFAULT '{}',

  -- Creator Evaluation Preferences. NULL means "no bound" throughout; 0 is a
  -- real value and is not the same thing.
  min_followers        BIGINT,
  min_er_pct           NUMERIC(6,3),
  require_category     BOOLEAN     NOT NULL DEFAULT false,
  verified_only        BOOLEAN     NOT NULL DEFAULT false,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by           UUID        REFERENCES public.users(id) ON DELETE SET NULL
);

-- The Creator Database reads this on every request that carries a match score,
-- so the org lookup is the hot path. UNIQUE on organization_id already indexes
-- it; this covers the "which brand is this profile for" join only.
CREATE INDEX IF NOT EXISTS discover_brand_profiles_brand_idx
  ON public.discover_brand_profiles (brand_id)
  WHERE brand_id IS NOT NULL;

-- Down Migration
-- DROP TABLE IF EXISTS public.discover_brand_profiles;
