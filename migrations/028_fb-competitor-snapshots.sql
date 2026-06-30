-- Up Migration
CREATE TABLE l0_raw.fb_competitor_snapshots (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID        NOT NULL REFERENCES public.social_accounts (id) ON DELETE CASCADE,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  username          VARCHAR(255),
  account_id        VARCHAR(255),
  page_id           VARCHAR(255),
  page_name         VARCHAR(255),
  page_title        VARCHAR(255),
  follower_count    BIGINT,
  like_count        BIGINT,
  rating_count      BIGINT,
  email             VARCHAR(255),
  creation_date     DATE,
  categories        TEXT[],
  info              TEXT,
  intro             TEXT,
  websites_link     TEXT[],
  page_url          TEXT,
  profile_photo     TEXT
);

CREATE UNIQUE INDEX uq_fb_competitor_snapshot_daily    ON l0_raw.fb_competitor_snapshots (social_account_id, DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'));
CREATE        INDEX idx_fb_competitor_snapshots_account ON l0_raw.fb_competitor_snapshots (social_account_id);
CREATE        INDEX idx_fb_competitor_snapshots_date    ON l0_raw.fb_competitor_snapshots (DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'));

-- Down Migration
-- DROP TABLE l0_raw.fb_competitor_snapshots;
