-- Up Migration
-- Enforce 1 account per platform per brand by storing platform_id in the junction table

ALTER TABLE brand_social_accounts
  ADD COLUMN platform_id UUID REFERENCES platforms (id) ON DELETE RESTRICT;

-- Backfill from social_accounts
UPDATE brand_social_accounts bsa
SET platform_id = sa.platform_id
FROM social_accounts sa
WHERE bsa.social_account_id = sa.id;

ALTER TABLE brand_social_accounts
  ALTER COLUMN platform_id SET NOT NULL;

-- The key constraint: a brand can only have one account per platform
ALTER TABLE brand_social_accounts
  ADD CONSTRAINT uq_brand_platform UNIQUE (brand_id, platform_id);

-- Down Migration
-- ALTER TABLE brand_social_accounts DROP CONSTRAINT uq_brand_platform;
-- ALTER TABLE brand_social_accounts DROP COLUMN platform_id;
