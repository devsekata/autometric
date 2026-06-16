-- Up Migration
CREATE TABLE l0_raw.ig_competitor_snapshots (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID        NOT NULL REFERENCES public.social_accounts (id) ON DELETE CASCADE,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  username          VARCHAR(255),
  full_name         VARCHAR(255),
  biography         TEXT,
  is_verified       BOOLEAN,
  follower_count    INTEGER,
  following_count   INTEGER,
  media_count       INTEGER
);

CREATE UNIQUE INDEX uq_ig_competitor_snapshot_daily   ON l0_raw.ig_competitor_snapshots (social_account_id, DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'));
CREATE        INDEX idx_ig_competitor_snapshots_account ON l0_raw.ig_competitor_snapshots (social_account_id);
CREATE        INDEX idx_ig_competitor_snapshots_date    ON l0_raw.ig_competitor_snapshots (DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'));

-- Down Migration
-- DROP TABLE l0_raw.ig_competitor_snapshots;
