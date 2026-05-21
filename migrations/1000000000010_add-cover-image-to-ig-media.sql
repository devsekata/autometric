-- Up Migration
ALTER TABLE l0_raw.ig_media_snapshots
  ADD COLUMN cover_image TEXT;

-- Down Migration
-- ALTER TABLE l0_raw.ig_media_snapshots DROP COLUMN cover_image;
