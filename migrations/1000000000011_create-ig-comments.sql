-- Up Migration
CREATE TABLE l0_raw.ig_comments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID NOT NULL REFERENCES public.social_accounts (id),
  media_id          VARCHAR(255) NOT NULL,
  comment_id        VARCHAR(255) NOT NULL,
  link_post         TEXT,
  link_comment      TEXT,
  comment_time      TIMESTAMPTZ,
  comment_text      TEXT,
  comment_username  VARCHAR(255),
  likes_count       INTEGER NOT NULL DEFAULT 0,
  replies_count     INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_ig_comment            ON l0_raw.ig_comments (comment_id);
CREATE        INDEX idx_ig_comments_media    ON l0_raw.ig_comments (media_id);
CREATE        INDEX idx_ig_comments_account  ON l0_raw.ig_comments (social_account_id);
CREATE        INDEX idx_ig_comments_time     ON l0_raw.ig_comments (comment_time);

-- Down Migration
-- DROP TABLE l0_raw.ig_comments;
