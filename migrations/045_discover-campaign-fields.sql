-- Up Migration
-- Campaign fields on Discover orders.
--
-- The workflow is Directory -> Shortlist -> Setup -> Brief -> Budget -> Review
-- -> Checkout -> Payment -> Campaign Dashboard. An order and a campaign are the
-- same row at different points on that path rather than two tables kept in
-- sync: the quotation IS the campaign once it is paid, and splitting them would
-- mean every dashboard read had to reconcile two sources of truth for one
-- number.
--
-- Everything here is nullable. An order created straight from the cart, with no
-- brief and no goals, stays perfectly valid — the campaign fields fill in as the
-- user walks the flow.
ALTER TABLE public.discover_orders
  ADD COLUMN IF NOT EXISTS objective        VARCHAR(40),
  ADD COLUMN IF NOT EXISTS brief            TEXT,
  ADD COLUMN IF NOT EXISTS hashtags         TEXT,
  ADD COLUMN IF NOT EXISTS mentions         TEXT,
  ADD COLUMN IF NOT EXISTS start_date       DATE,
  ADD COLUMN IF NOT EXISTS end_date         DATE,
  ADD COLUMN IF NOT EXISTS budget           NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS goal_reach       BIGINT,
  ADD COLUMN IF NOT EXISTS goal_engagement  BIGINT,
  -- Target audience for the demographic-match factor of the success model.
  ADD COLUMN IF NOT EXISTS target_ages      TEXT,
  ADD COLUMN IF NOT EXISTS target_gender    VARCHAR(10);

-- Estimates are frozen at checkout alongside the priced line items. The success
-- rate shown when someone approved the spend must remain readable afterwards,
-- even though the underlying creator metrics keep moving with every sync.
ALTER TABLE public.discover_orders
  ADD COLUMN IF NOT EXISTS est_reach        BIGINT,
  ADD COLUMN IF NOT EXISTS est_engagement   BIGINT,
  ADD COLUMN IF NOT EXISTS est_emv          NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS success_rate     INTEGER,
  ADD COLUMN IF NOT EXISTS success_factors  JSONB;

ALTER TABLE public.discover_orders
  DROP CONSTRAINT IF EXISTS chk_discover_orders_target_gender;
ALTER TABLE public.discover_orders
  ADD CONSTRAINT chk_discover_orders_target_gender
  CHECK (target_gender IS NULL OR target_gender IN ('all', 'female', 'male'));

ALTER TABLE public.discover_orders
  DROP CONSTRAINT IF EXISTS chk_discover_orders_dates;
ALTER TABLE public.discover_orders
  ADD CONSTRAINT chk_discover_orders_dates
  CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date);

-- The Campaign Dashboard lists live campaigns; only paid rows qualify.
CREATE INDEX IF NOT EXISTS idx_discover_orders_paid
  ON public.discover_orders (organization_id, paid_at DESC)
  WHERE status = 'paid';

-- Down Migration
-- DROP INDEX IF EXISTS idx_discover_orders_paid;
-- ALTER TABLE public.discover_orders
--   DROP CONSTRAINT IF EXISTS chk_discover_orders_dates,
--   DROP CONSTRAINT IF EXISTS chk_discover_orders_target_gender,
--   DROP COLUMN IF EXISTS success_factors, DROP COLUMN IF EXISTS success_rate,
--   DROP COLUMN IF EXISTS est_emv, DROP COLUMN IF EXISTS est_engagement,
--   DROP COLUMN IF EXISTS est_reach, DROP COLUMN IF EXISTS target_gender,
--   DROP COLUMN IF EXISTS target_ages, DROP COLUMN IF EXISTS goal_engagement,
--   DROP COLUMN IF EXISTS goal_reach, DROP COLUMN IF EXISTS budget,
--   DROP COLUMN IF EXISTS end_date, DROP COLUMN IF EXISTS start_date,
--   DROP COLUMN IF EXISTS mentions, DROP COLUMN IF EXISTS hashtags,
--   DROP COLUMN IF EXISTS brief, DROP COLUMN IF EXISTS objective;
