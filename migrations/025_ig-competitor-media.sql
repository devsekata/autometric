-- Up Migration
CREATE TABLE l0_raw.ig_competitor_media (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID        NOT NULL REFERENCES public.social_accounts (id) ON DELETE CASCADE,
  media_id          VARCHAR(255) NOT NULL,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  posted_at         TIMESTAMPTZ,
  caption           TEXT,
  media_type        VARCHAR(50),
  permalink         TEXT,
  cover_image       TEXT,

  like_count        INTEGER,
  comment_count     INTEGER,
  view_count        INTEGER,

  CONSTRAINT uq_ig_competitor_media UNIQUE (social_account_id, media_id)
);

CREATE INDEX idx_ig_competitor_media_account ON l0_raw.ig_competitor_media (social_account_id);
CREATE INDEX idx_ig_competitor_media_posted  ON l0_raw.ig_competitor_media (posted_at);

-- Down Migration
-- DROP TABLE l0_raw.ig_competitor_media;
