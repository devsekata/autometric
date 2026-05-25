-- Up Migration
-- Remove duplicate rows, keep only the latest per media_id
DELETE FROM l0_raw.ig_media_snapshots
WHERE id NOT IN (
  SELECT DISTINCT ON (media_id) id
  FROM l0_raw.ig_media_snapshots
  ORDER BY media_id, fetched_at DESC
);

-- Replace daily unique index with per-media unique index
DROP INDEX IF EXISTS l0_raw.uq_ig_media_snapshot_daily;
CREATE UNIQUE INDEX uq_ig_media_snapshot ON l0_raw.ig_media_snapshots (media_id);

-- Down Migration
-- DROP INDEX IF EXISTS l0_raw.uq_ig_media_snapshot;
-- CREATE UNIQUE INDEX uq_ig_media_snapshot_daily ON l0_raw.ig_media_snapshots (media_id, DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'));
