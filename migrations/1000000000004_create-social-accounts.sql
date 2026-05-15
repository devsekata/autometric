-- Up Migration
-- Global registry of all social media accounts ever tracked.
-- oauth_token is populated when a brand connects via Graph API.
-- Competitors reuse the same row — if token exists, fetch from API; otherwise scrape.
CREATE TABLE social_accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id      UUID NOT NULL REFERENCES platforms (id) ON DELETE RESTRICT,
  username         VARCHAR(255) NOT NULL,
  display_name     VARCHAR(255),
  profile_url      TEXT,
  followers_count  BIGINT      NOT NULL DEFAULT 0,
  oauth_token      TEXT,
  token_expires_at TIMESTAMPTZ,
  connected        BOOLEAN     NOT NULL DEFAULT false,
  connected_at     TIMESTAMPTZ,
  last_synced_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_social_accounts_platform_username UNIQUE (platform_id, username)
);

CREATE INDEX idx_social_accounts_platform  ON social_accounts (platform_id);
CREATE INDEX idx_social_accounts_connected ON social_accounts (connected);

-- Down Migration
-- DROP TABLE social_accounts;
