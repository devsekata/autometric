-- Up Migration

-- Drop junction table (1 brand = 1 org)
DROP TABLE IF EXISTS organization_brands;

-- brands: add organization_id, remove avatar_url
ALTER TABLE brands
  ADD COLUMN organization_id UUID NOT NULL DEFAULT gen_random_uuid() REFERENCES organizations (id) ON DELETE CASCADE,
  DROP COLUMN avatar_url;

ALTER TABLE brands ALTER COLUMN organization_id DROP DEFAULT;

-- social_accounts: add avatar_url (profile picture from platform)
ALTER TABLE social_accounts
  ADD COLUMN avatar_url TEXT;

-- Index
CREATE INDEX idx_brands_organization ON brands (organization_id);

-- Down Migration
DROP INDEX IF EXISTS idx_brands_organization;

ALTER TABLE social_accounts DROP COLUMN avatar_url;

ALTER TABLE brands
  DROP COLUMN organization_id,
  ADD COLUMN avatar_url TEXT;

CREATE TABLE organization_brands (
  organization_id UUID        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  brand_id        UUID        NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, brand_id)
);
