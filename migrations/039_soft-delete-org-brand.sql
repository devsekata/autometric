-- Up Migration
-- Soft delete for organizations and brands.
--
-- A hard DELETE is impossible here: the medallion layers declare their FKs to
-- public.brands as ON DELETE RESTRICT (see scripts/add-medallion-fks.js), so
-- deleting a brand that has any l2_gold rows aborts the whole statement — and
-- deleting an organization aborts too, because it cascades into brands.
-- Marking `deleted_at` hides the row from the app while leaving every medallion
-- FK untouched. Restore is a manual `UPDATE ... SET deleted_at = NULL`.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE brands        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Every read path filters on `deleted_at IS NULL`, so index only the live rows.
CREATE INDEX IF NOT EXISTS idx_organizations_live
  ON organizations (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_brands_org_live
  ON brands (organization_id) WHERE deleted_at IS NULL;

-- Down Migration
-- DROP INDEX IF EXISTS idx_brands_org_live;
-- DROP INDEX IF EXISTS idx_organizations_live;
-- ALTER TABLE brands        DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE organizations DROP COLUMN IF EXISTS deleted_at;
