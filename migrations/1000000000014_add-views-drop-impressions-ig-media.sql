-- Up Migration
ALTER TABLE l0_raw.ig_media_snapshots
  ADD COLUMN views               INTEGER,
  ADD COLUMN clips_replays_count INTEGER,
  DROP COLUMN impressions,
  DROP COLUMN reel_plays,
  DROP COLUMN video_views;

-- Down Migration
-- ALTER TABLE l0_raw.ig_media_snapshots
--   DROP COLUMN views,
--   DROP COLUMN clips_replays_count,
--   ADD COLUMN impressions  INTEGER,
--   ADD COLUMN reel_plays   INTEGER,
--   ADD COLUMN video_views  INTEGER;
