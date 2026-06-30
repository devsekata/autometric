-- Up Migration
CREATE TABLE l0_raw.tt_profile_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID NOT NULL REFERENCES public.social_accounts (id),
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Profile
  open_id         VARCHAR(255),
  display_name    VARCHAR(255),
  bio_description TEXT,
  avatar_url      TEXT,
  is_verified     BOOLEAN,

  -- Stats
  follower_count  INTEGER,
  following_count INTEGER,
  likes_count     BIGINT,
  video_count     INTEGER
);

CREATE UNIQUE INDEX uq_tt_snapshot_daily     ON l0_raw.tt_profile_snapshots (social_account_id, DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'));
CREATE        INDEX idx_tt_snapshots_account ON l0_raw.tt_profile_snapshots (social_account_id);
CREATE        INDEX idx_tt_snapshots_date    ON l0_raw.tt_profile_snapshots (DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'));

-- Down Migration
-- DROP TABLE l0_raw.tt_profile_snapshots;
