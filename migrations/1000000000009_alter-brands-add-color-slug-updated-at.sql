-- Up Migration
ALTER TABLE brands
  ADD COLUMN slug       VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN color      VARCHAR(7)   NOT NULL DEFAULT '#3d7e96',
  ADD COLUMN updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX idx_brands_org_slug ON brands (organization_id, slug);

-- Down Migration
-- DROP INDEX idx_brands_org_slug;
-- ALTER TABLE brands DROP COLUMN slug, DROP COLUMN color, DROP COLUMN updated_at;
