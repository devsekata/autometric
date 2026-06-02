-- Up Migration
CREATE TABLE l0_raw.fb_comments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID NOT NULL REFERENCES public.social_accounts (id),
  post_id           VARCHAR(255) NOT NULL,
  comment_id        VARCHAR(255) NOT NULL,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  link_post        TEXT,
  link_comment     TEXT,
  post_date        TIMESTAMPTZ,
  comment_time     TIMESTAMPTZ,
  comment_text     TEXT,
  comment_username VARCHAR(255),
  comment_user_id  VARCHAR(255),
  likes_count      INTEGER NOT NULL DEFAULT 0,
  replies_count    INTEGER NOT NULL DEFAULT 0,
  reactions_count  INTEGER NOT NULL DEFAULT 0,
  has_attachment   BOOLEAN NOT NULL DEFAULT FALSE,
  parent_id        VARCHAR(255)
);

CREATE UNIQUE INDEX uq_fb_comment          ON l0_raw.fb_comments (comment_id);
CREATE        INDEX idx_fb_comment_post    ON l0_raw.fb_comments (post_id);
CREATE        INDEX idx_fb_comment_account ON l0_raw.fb_comments (social_account_id);

-- Down Migration
-- DROP TABLE l0_raw.fb_comments;
