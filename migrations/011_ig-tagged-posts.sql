-- Up Migration
CREATE TABLE l0_raw.ig_tagged_posts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID NOT NULL REFERENCES public.social_accounts (id),
  media_id          VARCHAR(255) NOT NULL,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at         TIMESTAMPTZ,
  caption           TEXT,
  media_type        VARCHAR(50),
  permalink         TEXT,
  tagged_by         VARCHAR(255),
  like_count        INTEGER,
  comment_count     INTEGER,
  cover_image       TEXT
);

CREATE UNIQUE INDEX uq_ig_tagged_post          ON l0_raw.ig_tagged_posts (social_account_id, media_id);
CREATE        INDEX idx_ig_tagged_posts_account ON l0_raw.ig_tagged_posts (social_account_id);
CREATE        INDEX idx_ig_tagged_posts_date    ON l0_raw.ig_tagged_posts (posted_at);

-- Down Migration
-- DROP TABLE l0_raw.ig_tagged_posts;
