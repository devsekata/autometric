-- Up Migration
ALTER TABLE l0_raw.ig_stories DROP COLUMN impressions;

-- Down Migration
-- ALTER TABLE l0_raw.ig_stories ADD COLUMN impressions INTEGER;
