-- Up Migration
ALTER TABLE l0_raw.ig_media_snapshots
  ADD COLUMN video_duration        NUMERIC(10, 3),
  ADD COLUMN carousel_media_count  INTEGER;

-- Down Migration
-- ALTER TABLE l0_raw.ig_media_snapshots
--   DROP COLUMN video_duration,
--   DROP COLUMN carousel_media_count;
