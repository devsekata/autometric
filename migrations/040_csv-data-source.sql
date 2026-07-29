-- Up Migration
-- CSV/FPK upload as a third data source, alongside Meta/TikTok OAuth and Apify.
--
-- Why a marker column at all: a CSV-sourced account has no token, so it is
-- created with connected = false — which already makes the scheduler skip it
-- (src/lib/monitoring/scheduler.ts filters `WHERE sa.connected = true`). But
-- `connected = false` also describes an account whose OAuth simply expired, and
-- those two must not be confused: the exclusive-per-platform rule needs to know
-- whether a platform is *held* by CSV before allowing an OAuth connect, and the
-- UI needs to label the source honestly.
ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS data_source VARCHAR(10) NOT NULL DEFAULT 'api';

ALTER TABLE social_accounts
  DROP CONSTRAINT IF EXISTS chk_social_accounts_data_source;
ALTER TABLE social_accounts
  ADD CONSTRAINT chk_social_accounts_data_source
  CHECK (data_source IN ('api', 'csv'));

CREATE INDEX IF NOT EXISTS idx_social_accounts_data_source
  ON social_accounts (data_source) WHERE data_source = 'csv';

-- Per-file upload history. initial_scrape_logs gets one aggregate row per batch
-- (that is what the scheduled medallion procedure keys off), but it has no
-- column for a file name or category — and the Data Sources tab has to show the
-- user which file succeeded and which failed. Hence this table.
CREATE TABLE IF NOT EXISTS csv_upload_logs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          UUID        NOT NULL,
  brand_id          UUID        NOT NULL REFERENCES brands (id) ON DELETE RESTRICT,
  social_account_id UUID        REFERENCES social_accounts (id),
  platform          VARCHAR(20) NOT NULL,
  -- Internal mapping-engine category ('Post', 'Profile Reach', 'Audience', …).
  category          VARCHAR(60),
  file_name         TEXT        NOT NULL,
  file_size         INTEGER,
  status            VARCHAR(10) NOT NULL,
  rows_written      INTEGER,
  target_table      TEXT,
  error_message     TEXT,
  -- Latest data date carried by the file, so the UI can say "data through X"
  -- without re-reading l0_raw.
  data_through      DATE,
  uploaded_by       UUID        REFERENCES users (id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_csv_upload_logs_status CHECK (status IN ('success', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_csv_upload_logs_brand
  ON csv_upload_logs (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_csv_upload_logs_batch
  ON csv_upload_logs (batch_id);

-- Down Migration
-- DROP TABLE IF EXISTS csv_upload_logs;
-- DROP INDEX IF EXISTS idx_social_accounts_data_source;
-- ALTER TABLE social_accounts DROP CONSTRAINT IF EXISTS chk_social_accounts_data_source;
-- ALTER TABLE social_accounts DROP COLUMN IF EXISTS data_source;
