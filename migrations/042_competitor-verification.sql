-- Up Migration
-- Competitor add-flow verification + a posts schedule that survives a missed run.
--
-- Why verification state at all: POST /competitors used to create the link and
-- return 201 without ever confirming the account exists. A typo produced a row
-- that the daily scheduler then re-scraped and re-failed forever, invisible in
-- the UI (that is exactly what `Facebook page "BNI" not found` has been doing).
-- Now the add flow does a cheap 404 pre-check, the row starts 'pending', and the
-- background Apify sync either promotes it to 'verified' or — when the platform
-- definitively says the account is gone — deletes the link.
--
-- State lives on brand_competitors rather than social_accounts because
-- social_accounts is shared with owned/OAuth accounts, which are never in this
-- lifecycle. Existing rows are backfilled to 'verified': they have been scraping
-- successfully for weeks, so re-verifying them would be busywork.
ALTER TABLE public.brand_competitors
  ADD COLUMN IF NOT EXISTS verification_status VARCHAR(10) NOT NULL DEFAULT 'verified',
  ADD COLUMN IF NOT EXISTS verified_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_error  TEXT;

ALTER TABLE public.brand_competitors
  DROP CONSTRAINT IF EXISTS chk_brand_competitors_verification_status;
ALTER TABLE public.brand_competitors
  ADD CONSTRAINT chk_brand_competitors_verification_status
  CHECK (verification_status IN ('pending', 'verified'));

-- Only 'pending' rows are ever filtered on (UI spinner, scheduler promotion).
CREATE INDEX IF NOT EXISTS idx_brand_competitors_pending
  ON public.brand_competitors (verification_status)
  WHERE verification_status = 'pending';

UPDATE public.brand_competitors
   SET verified_at = COALESCE(verified_at, now())
 WHERE verification_status = 'verified' AND verified_at IS NULL;

-- ── Posts schedule: elapsed-time instead of calendar-date ──
--
-- posts_day_of_month required the WIB date AND the WIB minute to line up exactly.
-- Miss that one minute — app restart, deploy, host down — and competitor posts go
-- unsynced for a whole month with no catch-up and no log line. That is not a
-- hypothetical: scheduler_logs has never recorded a single 'competitor_posts'
-- entry, and l0_raw.*_competitor_media has not been written since 2026-07-14.
--
-- Replaced by "has it been at least N days since the last posts sync", which
-- self-heals: a missed run just means the next scheduled run picks it up.
ALTER TABLE public.competitor_scheduler_config
  ADD COLUMN IF NOT EXISTS posts_interval_days INTEGER     NOT NULL DEFAULT 28,
  ADD COLUMN IF NOT EXISTS last_posts_sync_at  TIMESTAMPTZ;

ALTER TABLE public.competitor_scheduler_config
  DROP CONSTRAINT IF EXISTS chk_competitor_config_posts_interval;
ALTER TABLE public.competitor_scheduler_config
  ADD CONSTRAINT chk_competitor_config_posts_interval
  CHECK (posts_interval_days BETWEEN 1 AND 90);

ALTER TABLE public.competitor_scheduler_config
  DROP COLUMN IF EXISTS posts_day_of_month;

-- Daily profile snapshot moves to 00:05 WIB.
UPDATE public.competitor_scheduler_config
   SET schedule_times = '[{"hour":0,"minute":5}]'::jsonb,
       updated_at     = now();

ALTER TABLE public.competitor_scheduler_config
  ALTER COLUMN schedule_times SET DEFAULT '[{"hour":0,"minute":5}]';

-- Down Migration
-- ALTER TABLE public.competitor_scheduler_config
--   ADD COLUMN IF NOT EXISTS posts_day_of_month INTEGER NOT NULL DEFAULT 1
--     CHECK (posts_day_of_month BETWEEN 1 AND 28);
-- ALTER TABLE public.competitor_scheduler_config
--   DROP COLUMN IF EXISTS last_posts_sync_at,
--   DROP COLUMN IF EXISTS posts_interval_days;
-- ALTER TABLE public.brand_competitors
--   DROP CONSTRAINT IF EXISTS chk_brand_competitors_verification_status,
--   DROP COLUMN IF EXISTS verification_error,
--   DROP COLUMN IF EXISTS verified_at,
--   DROP COLUMN IF EXISTS verification_status;
