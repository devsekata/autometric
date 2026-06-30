-- Up Migration
CREATE TABLE l0_raw.fb_competitor_media (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id   UUID         NOT NULL REFERENCES public.social_accounts (id) ON DELETE CASCADE,
  post_id             VARCHAR(255) NOT NULL,
  fetched_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  post_date           TIMESTAMPTZ,
  caption             TEXT,
  url                 TEXT,
  page_name           VARCHAR(255),

  like_count          BIGINT,
  share_count         BIGINT,
  top_reactions_count BIGINT,

  media_count         INTEGER,
  media               TEXT[],
  hashtags_list       TEXT[],
  hashtags_count      INTEGER,

  CONSTRAINT uq_fb_competitor_media UNIQUE (social_account_id, post_id)
);

CREATE INDEX idx_fb_competitor_media_account ON l0_raw.fb_competitor_media (social_account_id);
CREATE INDEX idx_fb_competitor_media_posted  ON l0_raw.fb_competitor_media (post_date);

-- Down Migration
-- DROP TABLE l0_raw.fb_competitor_media;
