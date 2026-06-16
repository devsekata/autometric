-- Up Migration
CREATE TABLE l0_raw.tiktok_competitor_snapshots (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id      UUID        NOT NULL REFERENCES public.social_accounts (id) ON DELETE CASCADE,
  fetched_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  username               VARCHAR(255),
  account_id             VARCHAR(255),
  account_nickname       VARCHAR(255),
  following_count        BIGINT,
  follower_count         BIGINT,
  video_count            BIGINT,
  like_count             BIGINT,
  is_verified            BOOLEAN,
  bio_signature          VARCHAR(255),
  bio_link               TEXT,
  is_private             BOOLEAN,
  is_seller              BOOLEAN,
  is_commerce_user       BOOLEAN,
  commerce_user_category VARCHAR(255),
  avatar                 TEXT
);

CREATE UNIQUE INDEX uq_tiktok_competitor_snapshot_daily    ON l0_raw.tiktok_competitor_snapshots (social_account_id, DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'));
CREATE        INDEX idx_tiktok_competitor_snapshots_account ON l0_raw.tiktok_competitor_snapshots (social_account_id);
CREATE        INDEX idx_tiktok_competitor_snapshots_date    ON l0_raw.tiktok_competitor_snapshots (DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'));

-- Down Migration
-- DROP TABLE l0_raw.tiktok_competitor_snapshots;
