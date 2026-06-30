-- Up Migration
ALTER TABLE l0_raw.ig_competitor_snapshots
  ADD COLUMN IF NOT EXISTS is_private       BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_business      BOOLEAN,
  ADD COLUMN IF NOT EXISTS account_category VARCHAR(255),
  ADD COLUMN IF NOT EXISTS external_url     TEXT,
  ADD COLUMN IF NOT EXISTS bio_links        TEXT[];

-- Down Migration
-- ALTER TABLE l0_raw.ig_competitor_snapshots
--   DROP COLUMN IF EXISTS is_private,
--   DROP COLUMN IF EXISTS is_business,
--   DROP COLUMN IF EXISTS account_category,
--   DROP COLUMN IF EXISTS external_url,
--   DROP COLUMN IF EXISTS bio_links;
