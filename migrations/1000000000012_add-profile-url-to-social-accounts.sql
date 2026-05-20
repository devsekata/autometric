-- Up Migration
ALTER TABLE social_accounts
  ADD COLUMN profile_url TEXT;

-- Down Migration
-- ALTER TABLE social_accounts DROP COLUMN profile_url;
