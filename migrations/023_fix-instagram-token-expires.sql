-- Up Migration
-- Instagram via Facebook uses Page Access Tokens which never expire.
-- Null out any stored token_expires_at for existing Instagram accounts.
UPDATE social_accounts
SET token_expires_at = NULL
WHERE platform_id = (SELECT id FROM platforms WHERE key = 'instagram')
  AND connected = true;

-- Down Migration
-- (no rollback — original values are unknown)
