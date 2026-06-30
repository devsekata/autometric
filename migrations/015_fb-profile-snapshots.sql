-- Up Migration
CREATE TABLE l0_raw.fb_profile_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID NOT NULL REFERENCES public.social_accounts (id),
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Profile
  page_id         VARCHAR(255),
  name            VARCHAR(255),
  about           TEXT,
  category        VARCHAR(255),
  website         TEXT,
  fan_count       INTEGER,
  followers_count INTEGER,
  cover_url       TEXT,
  avatar_url      TEXT,
  page_link       TEXT,

  -- Page Insights daily (active metrics as of 2026)
  page_follows                 BIGINT,
  page_daily_follows_unique    INTEGER,
  page_media_view              BIGINT,
  page_total_media_view_unique BIGINT,
  page_video_views             BIGINT,
  page_views_total             BIGINT,
  content_interactions         BIGINT,
  link_clicks                  BIGINT,
  profile_reach                BIGINT
);

CREATE UNIQUE INDEX uq_fb_snapshot_daily     ON l0_raw.fb_profile_snapshots (social_account_id, DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'));
CREATE        INDEX idx_fb_snapshots_account ON l0_raw.fb_profile_snapshots (social_account_id);
CREATE        INDEX idx_fb_snapshots_date    ON l0_raw.fb_profile_snapshots (DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'));

-- Down Migration
-- DROP TABLE l0_raw.fb_profile_snapshots;
