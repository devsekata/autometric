-- Up Migration
ALTER TABLE l0_raw.ig_media_snapshots
  ADD COLUMN reposts INTEGER;

-- Down Migration
-- ALTER TABLE l0_raw.ig_media_snapshots DROP COLUMN reposts;
