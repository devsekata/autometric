-- Up Migration
-- Recreate snapshot deduplication indexes using WIB (Asia/Jakarta, UTC+7) day boundaries.
-- Previously used UTC, which caused the "day" boundary to fall at 07:00 WIB instead of midnight.

DROP INDEX IF EXISTS l0_raw.uq_ig_snapshot_daily;
DROP INDEX IF EXISTS l0_raw.idx_ig_snapshots_date;
DROP INDEX IF EXISTS l0_raw.uq_ig_media_snapshot_daily;

CREATE UNIQUE INDEX uq_ig_snapshot_daily     ON l0_raw.ig_profile_snapshots (social_account_id, DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'));
CREATE        INDEX idx_ig_snapshots_date    ON l0_raw.ig_profile_snapshots (DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'));
CREATE UNIQUE INDEX uq_ig_media_snapshot_daily ON l0_raw.ig_media_snapshots (media_id, DATE(fetched_at AT TIME ZONE 'Asia/Jakarta'));

-- Down Migration
-- DROP INDEX IF EXISTS l0_raw.uq_ig_snapshot_daily;
-- DROP INDEX IF EXISTS l0_raw.idx_ig_snapshots_date;
-- DROP INDEX IF EXISTS l0_raw.uq_ig_media_snapshot_daily;
-- CREATE UNIQUE INDEX uq_ig_snapshot_daily     ON l0_raw.ig_profile_snapshots (social_account_id, DATE(fetched_at AT TIME ZONE 'UTC'));
-- CREATE        INDEX idx_ig_snapshots_date    ON l0_raw.ig_profile_snapshots (DATE(fetched_at AT TIME ZONE 'UTC'));
-- CREATE UNIQUE INDEX uq_ig_media_snapshot_daily ON l0_raw.ig_media_snapshots (media_id, DATE(fetched_at AT TIME ZONE 'UTC'));
