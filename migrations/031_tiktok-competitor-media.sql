-- Up Migration
CREATE TABLE l0_raw.tiktok_competitor_media (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID         NOT NULL REFERENCES public.social_accounts (id) ON DELETE CASCADE,
  post_id           VARCHAR(255) NOT NULL,
  fetched_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  post_date         TIMESTAMPTZ,
  caption           TEXT,
  caption_language  VARCHAR(100),
  media_type        VARCHAR(100),
  slide_count       INTEGER,

  like_count        BIGINT,
  comment_count     BIGINT,
  play_count        BIGINT,
  saved_count       BIGINT,
  share_count       BIGINT,
  video_duration    BIGINT,

  hashtags_list     TEXT[],
  hashtags_count    INTEGER,
  mentions          TEXT[],

  url               TEXT,
  cover_image       TEXT,
  is_pinned         BOOLEAN,
  is_sponsored      BOOLEAN,
  is_ad             BOOLEAN,
  music_title       VARCHAR(255),
  music_author      VARCHAR(255),

  CONSTRAINT uq_tiktok_competitor_media UNIQUE (social_account_id, post_id)
);

CREATE INDEX idx_tiktok_competitor_media_account ON l0_raw.tiktok_competitor_media (social_account_id);
CREATE INDEX idx_tiktok_competitor_media_posted  ON l0_raw.tiktok_competitor_media (post_date);

-- Down Migration
-- DROP TABLE l0_raw.tiktok_competitor_media;
