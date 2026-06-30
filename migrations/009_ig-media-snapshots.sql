-- Up Migration
CREATE TABLE l0_raw.ig_media_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID NOT NULL REFERENCES public.social_accounts (id),
  media_id          VARCHAR(255) NOT NULL,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Post metadata
  posted_at    TIMESTAMPTZ,
  caption      TEXT,
  media_type   VARCHAR(50),
  permalink    TEXT,
  cover_image  TEXT,

  -- Common metrics (all types)
  reach               INTEGER,
  saved               INTEGER,
  comments            INTEGER,
  shares              INTEGER,
  total_interactions  INTEGER,
  likes               INTEGER,
  views               INTEGER,
  reposts             INTEGER,

  -- Image / Carousel / Video metrics
  follows         INTEGER,
  profile_visits  INTEGER,

  -- Reel metrics
  reel_avg_watch_time        NUMERIC(10, 4),
  reel_video_view_total_time BIGINT,

  -- Extra metadata
  video_duration       NUMERIC(10, 3),
  carousel_media_count INTEGER
);

CREATE UNIQUE INDEX uq_ig_media_snapshot ON l0_raw.ig_media_snapshots (media_id);
CREATE        INDEX idx_ig_media_account ON l0_raw.ig_media_snapshots (social_account_id);
CREATE        INDEX idx_ig_media_posted  ON l0_raw.ig_media_snapshots (posted_at);
CREATE        INDEX idx_ig_media_id      ON l0_raw.ig_media_snapshots (media_id);

-- Down Migration
-- DROP TABLE l0_raw.ig_media_snapshots;
