-- Up Migration
-- KOL Intelligence: the ordering flow and the campaign lifecycle that follows it.
--
-- Migration 045 gave an order its campaign context (objective, window, frozen
-- estimates). That covered planning. What it did not cover is everything after
-- the money moves: an order became "paid" and then had nowhere left to go, so
-- Campaign Management could only ever infer state from the payment status and
-- the calendar. This migration adds the three things the flow was missing.

-- ── 1. campaign lifecycle ───────────────────────────────────────────────────
-- Payment status and campaign status are different axes and must not share a
-- column. An order can be paid while its campaign is still being briefed, and a
-- campaign can be completed while an invoice is outstanding. Collapsing them —
-- which is what deriving campaign state from `status` + dates did — makes both
-- unanswerable.
--
-- The lifecycle is deliberately advanced by a human. autometric does not ingest
-- per-order delivery, so nothing in the warehouse can tell us a creator moved
-- from "briefed" to "in progress". A field somebody updates is honest; a field
-- we infer from a date would be a guess wearing a status badge.
ALTER TABLE public.discover_orders
  ADD COLUMN IF NOT EXISTS campaign_status VARCHAR(20) NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS key_message     TEXT,
  ADD COLUMN IF NOT EXISTS deadline        DATE,
  -- Which rail the buyer chose at Step 3. The gateway still decides what it
  -- accepts; this records the intent, and drives the invoice path, which does
  -- not go through the gateway at all.
  ADD COLUMN IF NOT EXISTS payment_method  VARCHAR(20),
  -- Content picked from Discovery as reference for the brief, frozen as
  -- [{source, postRowId, platform}]. Frozen rather than joined: the medallion
  -- layers rewrite post rows on re-sync, and a brief must keep saying what it
  -- said when it was approved.
  ADD COLUMN IF NOT EXISTS inspirations    JSONB;

ALTER TABLE public.discover_orders
  DROP CONSTRAINT IF EXISTS chk_discover_orders_campaign_status;
ALTER TABLE public.discover_orders
  ADD CONSTRAINT chk_discover_orders_campaign_status
  CHECK (campaign_status IN (
    'draft', 'planning', 'briefed', 'in_progress',
    'content_review', 'published', 'monitoring', 'completed'
  ));

ALTER TABLE public.discover_orders
  DROP CONSTRAINT IF EXISTS chk_discover_orders_payment_method;
ALTER TABLE public.discover_orders
  ADD CONSTRAINT chk_discover_orders_payment_method
  CHECK (payment_method IS NULL OR payment_method IN ('card', 'bank_transfer', 'invoice'));

-- Campaign Management lists by lifecycle, so that is what the index serves.
CREATE INDEX IF NOT EXISTS idx_discover_orders_campaign_status
  ON public.discover_orders (organization_id, campaign_status);

-- ── 2. per-creator target ───────────────────────────────────────────────────
-- One campaign can ask different things of different creators: a macro creator
-- carries awareness, a micro creator with a tight niche carries conversions.
-- Storing a single objective on the order forced every creator to share one
-- goal, which then made "did this creator hit their target" unanswerable.
--
-- Null means "inherit the campaign-level objective", so an order that does not
-- use per-creator targets stays exactly as simple as it is today.
ALTER TABLE public.discover_order_items
  ADD COLUMN IF NOT EXISTS target_objective  VARCHAR(40),
  ADD COLUMN IF NOT EXISTS target_reach      BIGINT,
  ADD COLUMN IF NOT EXISTS target_engagement BIGINT;

-- ── 3. custom pricing, kept auditable ───────────────────────────────────────
-- Negotiated rates are normal in this business, so a line must be able to
-- deviate from the rate card. But an overridden price with nothing recorded
-- beside it is indistinguishable from a pricing bug six months later, so the
-- rate-card price the override replaced is stored next to it.
--
-- `unit_price` remains the price actually charged — every existing total stays
-- correct and nothing needs backfilling.
ALTER TABLE public.discover_order_items
  ADD COLUMN IF NOT EXISTS list_unit_price NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS price_overridden BOOLEAN NOT NULL DEFAULT false;

-- ── 4. per-creator delivery progress ────────────────────────────────────────
-- Campaign Management shows which deliverables are done. Same reasoning as the
-- lifecycle above: this is recorded, not inferred.
ALTER TABLE public.discover_order_items
  ADD COLUMN IF NOT EXISTS progress_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS published_url   TEXT,
  ADD COLUMN IF NOT EXISTS published_at    TIMESTAMPTZ;

ALTER TABLE public.discover_order_items
  DROP CONSTRAINT IF EXISTS chk_discover_items_progress;
ALTER TABLE public.discover_order_items
  ADD CONSTRAINT chk_discover_items_progress
  CHECK (progress_status IN ('pending', 'briefed', 'in_progress', 'review', 'published'));

-- Existing paid orders predate the lifecycle column and would all read "draft",
-- which is wrong in the one direction that matters — it would show live work as
-- unstarted. Seed them from what is known: paid means the campaign is at least
-- under way, and a window that has already closed means it finished.
UPDATE public.discover_orders
   SET campaign_status = CASE
         WHEN end_date IS NOT NULL AND end_date < CURRENT_DATE THEN 'completed'
         ELSE 'in_progress'
       END
 WHERE status = 'paid' AND campaign_status = 'draft';

-- Down Migration
-- DROP INDEX IF EXISTS idx_discover_orders_campaign_status;
-- ALTER TABLE public.discover_order_items
--   DROP CONSTRAINT IF EXISTS chk_discover_items_progress,
--   DROP COLUMN IF EXISTS published_at, DROP COLUMN IF EXISTS published_url,
--   DROP COLUMN IF EXISTS progress_status, DROP COLUMN IF EXISTS price_overridden,
--   DROP COLUMN IF EXISTS list_unit_price, DROP COLUMN IF EXISTS target_engagement,
--   DROP COLUMN IF EXISTS target_reach, DROP COLUMN IF EXISTS target_objective;
-- ALTER TABLE public.discover_orders
--   DROP CONSTRAINT IF EXISTS chk_discover_orders_payment_method,
--   DROP CONSTRAINT IF EXISTS chk_discover_orders_campaign_status,
--   DROP COLUMN IF EXISTS inspirations, DROP COLUMN IF EXISTS payment_method,
--   DROP COLUMN IF EXISTS deadline, DROP COLUMN IF EXISTS key_message,
--   DROP COLUMN IF EXISTS campaign_status;
