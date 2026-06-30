-- Up Migration
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS refresh_token TEXT;

-- Down Migration
-- ALTER TABLE social_accounts DROP COLUMN IF EXISTS refresh_token;
