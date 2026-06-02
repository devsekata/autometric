-- Up Migration
CREATE TABLE social_accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id      UUID NOT NULL REFERENCES platforms (id) ON DELETE RESTRICT,
  platform_user_id VARCHAR(255),
  username         VARCHAR(255) NOT NULL,
  oauth_token      TEXT,
  token_expires_at TIMESTAMPTZ,
  avatar_url       TEXT,
  profile_url      TEXT,
  connected        BOOLEAN NOT NULL DEFAULT false,
  connected_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_social_accounts_platform_username UNIQUE (platform_id, username)
);

CREATE INDEX idx_social_accounts_platform  ON social_accounts (platform_id);
CREATE INDEX idx_social_accounts_connected ON social_accounts (connected);

-- Down Migration
-- DROP TABLE social_accounts;
