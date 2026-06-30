-- Up Migration
CREATE TABLE l0_raw.tt_video_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID NOT NULL REFERENCES public.social_accounts (id),
  video_id          VARCHAR(255) NOT NULL,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Video metadata
  posted_at       TIMESTAMPTZ,
  title           TEXT,
  description     TEXT,
  duration        INTEGER,
  cover_image_url TEXT,
  share_url       TEXT,

  -- Metrics
  like_count    BIGINT,
  comment_count BIGINT,
  share_count   BIGINT,
  view_count    BIGINT,

  -- Calculated
  engagement_rate NUMERIC(8, 4)
);

CREATE UNIQUE INDEX uq_tt_video_snapshot_daily ON l0_raw.tt_video_snapshots (video_id, DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'));
CREATE        INDEX idx_tt_video_account        ON l0_raw.tt_video_snapshots (social_account_id);
CREATE        INDEX idx_tt_video_posted         ON l0_raw.tt_video_snapshots (posted_at);
CREATE        INDEX idx_tt_video_id             ON l0_raw.tt_video_snapshots (video_id);

-- Down Migration
-- DROP TABLE l0_raw.tt_video_snapshots;
