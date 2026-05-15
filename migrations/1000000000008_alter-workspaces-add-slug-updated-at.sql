-- Up Migration
ALTER TABLE organizations
  ADD COLUMN slug       VARCHAR(255) UNIQUE NOT NULL DEFAULT '',
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX idx_organizations_slug ON organizations (slug);

-- Down Migration
-- DROP INDEX idx_organizations_slug;
-- ALTER TABLE organizations DROP COLUMN slug, DROP COLUMN updated_at;
