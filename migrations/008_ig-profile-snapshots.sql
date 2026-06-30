-- Up Migration
CREATE SCHEMA IF NOT EXISTS l0_raw;

CREATE TABLE l0_raw.ig_profile_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID NOT NULL REFERENCES public.social_accounts (id),
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Profile
  username              VARCHAR(255),
  name                  VARCHAR(255),
  biography             TEXT,
  website               TEXT,
  followers_count       INTEGER,
  follows_count         INTEGER,
  media_count           INTEGER,

  -- Insights day (total_value per metric)
  accounts_engaged      INTEGER,
  comments              INTEGER,
  likes                 INTEGER,
  profile_links_taps    INTEGER,
  reach                 INTEGER,
  replies               INTEGER,
  reposts               INTEGER,
  saves                 INTEGER,
  shares                INTEGER,
  total_interactions    INTEGER,
  views                 INTEGER,

  -- Insights day dengan breakdown
  follows_and_unfollows JSONB,

  -- Insights lifetime demographics
  demographics_age      JSONB,
  demographics_city     JSONB,
  demographics_country  JSONB,
  demographics_gender   JSONB
);

CREATE UNIQUE INDEX uq_ig_snapshot_daily     ON l0_raw.ig_profile_snapshots (social_account_id, DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'));
CREATE        INDEX idx_ig_snapshots_account ON l0_raw.ig_profile_snapshots (social_account_id);
CREATE        INDEX idx_ig_snapshots_date    ON l0_raw.ig_profile_snapshots (DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'));

-- Down Migration
-- DROP TABLE l0_raw.ig_profile_snapshots;
