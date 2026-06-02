-- Up Migration
CREATE TABLE l0_raw.fb_post_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID NOT NULL REFERENCES public.social_accounts (id),
  post_id           VARCHAR(255) NOT NULL,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Metadata
  posted_at     TIMESTAMPTZ,
  message       TEXT,
  story         TEXT,
  full_picture  TEXT,
  permalink_url TEXT,
  post_type     VARCHAR(50),

  -- Counts from post object
  reactions_count INTEGER,
  likes_count     INTEGER,
  comments_count  INTEGER,
  shares_count    INTEGER NOT NULL DEFAULT 0,

  -- Per-post insights (lifetime cumulative, active metrics as of 2026)
  impressions       BIGINT,
  reach             BIGINT,
  clicks            BIGINT,
  reactions_by_type JSONB,
  video_views       BIGINT
);

CREATE UNIQUE INDEX uq_fb_post_snapshot ON l0_raw.fb_post_snapshots (post_id);
CREATE        INDEX idx_fb_post_account ON l0_raw.fb_post_snapshots (social_account_id);
CREATE        INDEX idx_fb_post_posted  ON l0_raw.fb_post_snapshots (posted_at);

-- Down Migration
-- DROP TABLE l0_raw.fb_post_snapshots;
