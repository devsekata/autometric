-- Up Migration
CREATE TABLE l0_raw.ig_stories (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID NOT NULL REFERENCES public.social_accounts (id),
  media_id          VARCHAR(255) NOT NULL,
  posted_at         TIMESTAMPTZ,
  media_type        VARCHAR(50),
  permalink         TEXT,
  media_url         TEXT,
  thumbnail_url     TEXT,

  -- Metrics
  reach             INTEGER,
  impressions       INTEGER,
  replies           INTEGER,
  shares            INTEGER,
  follows           INTEGER,
  profile_visits    INTEGER,
  profile_activity  INTEGER,
  reposts           INTEGER,
  total_interactions INTEGER,
  total_views       INTEGER,
  facebook_views    INTEGER,
  navigation        JSONB,

  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_ig_story       ON l0_raw.ig_stories (media_id);
CREATE        INDEX idx_ig_story_acct ON l0_raw.ig_stories (social_account_id);
CREATE        INDEX idx_ig_story_time ON l0_raw.ig_stories (posted_at);

-- Down Migration
-- DROP TABLE l0_raw.ig_stories;
