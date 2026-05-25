-- Up Migration
ALTER TABLE l0_raw.ig_media_snapshots
  ADD COLUMN collaborators JSONB;

-- Down Migration
-- ALTER TABLE l0_raw.ig_media_snapshots DROP COLUMN collaborators;
