-- Up Migration
ALTER TABLE social_accounts
  ADD COLUMN followers_count  BIGINT       NOT NULL DEFAULT 0,
  ADD COLUMN display_name     VARCHAR(255),
  ADD COLUMN profile_url      TEXT,
  ADD COLUMN last_synced_at   TIMESTAMPTZ;

CREATE INDEX idx_social_accounts_last_synced ON social_accounts (last_synced_at);

-- Down Migration
-- DROP INDEX idx_social_accounts_last_synced;
-- ALTER TABLE social_accounts DROP COLUMN followers_count, DROP COLUMN display_name, DROP COLUMN profile_url, DROP COLUMN last_synced_at;
