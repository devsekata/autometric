-- Up Migration
ALTER TABLE l0_raw.ig_media_snapshots
  DROP COLUMN clips_replays_count;

-- Down Migration
-- ALTER TABLE l0_raw.ig_media_snapshots ADD COLUMN clips_replays_count INTEGER;
