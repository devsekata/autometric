-- Up Migration
-- Instagram dan Facebook sama-sama menyimpan Page Access Token yang tidak pernah expire.
-- Null out token_expires_at untuk kedua platform.
UPDATE social_accounts
SET token_expires_at = NULL
WHERE platform_id IN (
  SELECT id FROM platforms WHERE key IN ('instagram', 'facebook')
)
AND connected = true;

-- Down Migration
-- (no rollback — original values are unknown)
