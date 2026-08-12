-- Up Migration
-- Rate cards and campaign orders for the Discover module.
--
-- The source KOL platform priced everything off a `rate` field baked into its
-- hardcoded creator array, multiplied by a per-deliverable factor. autometric
-- has no commercial data at all, so the base rate becomes a real per-account
-- row an org fills in; the deliverable multipliers stay in code (see
-- lib/discover/rates.ts) because they are catalogue definitions, not org data.

-- ── rate cards ──────────────────────────────────────────────────────────────
-- One base rate per (org, account). Scoped to the org rather than global: two
-- orgs tracking the same competitor account negotiate their own numbers, and
-- neither should see the other's.
--
-- No FK to social_accounts: competitor links come and go as brands are edited,
-- and losing a negotiated rate because an account was briefly unlinked would be
-- silent data loss. Orphan rows are harmless — reads join through the org's
-- current account list.
CREATE TABLE IF NOT EXISTS public.discover_rate_cards (
  organization_id   UUID           NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  social_account_id UUID           NOT NULL,
  base_rate         NUMERIC(14,2)  NOT NULL DEFAULT 0,
  currency          VARCHAR(3)     NOT NULL DEFAULT 'IDR',
  note              TEXT,
  updated_by        UUID           REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, social_account_id)
);

ALTER TABLE public.discover_rate_cards
  DROP CONSTRAINT IF EXISTS chk_discover_rate_nonneg;
ALTER TABLE public.discover_rate_cards
  ADD CONSTRAINT chk_discover_rate_nonneg CHECK (base_rate >= 0);

-- ── orders ──────────────────────────────────────────────────────────────────
-- A quotation that may later become a paid order. Money is stored as NUMERIC,
-- never float: 8% fee and 11% tax compounded over float subtotals drift, and a
-- quotation that disagrees with itself by a rupiah is a quotation nobody trusts.
--
-- Totals are persisted rather than recomputed on read. A quotation is a
-- statement made at a point in time — if someone edits a rate card next week,
-- last week's quote must still say what it said.
CREATE TABLE IF NOT EXISTS public.discover_orders (
  id                   BIGSERIAL     PRIMARY KEY,
  organization_id      UUID          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by_user_id   UUID          REFERENCES public.users(id) ON DELETE SET NULL,
  name                 TEXT          NOT NULL,
  status               VARCHAR(20)   NOT NULL DEFAULT 'draft',
  currency             VARCHAR(3)    NOT NULL DEFAULT 'IDR',
  subtotal             NUMERIC(14,2) NOT NULL DEFAULT 0,
  fee_pct              NUMERIC(5,2)  NOT NULL DEFAULT 0,
  fee_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_pct              NUMERIC(5,2)  NOT NULL DEFAULT 0,
  tax_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  promo_code           TEXT,
  total                NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes                TEXT,
  -- Payment is optional: an order can live its whole life as a quotation.
  payment_provider     VARCHAR(20),
  payment_ref          TEXT,
  payment_redirect_url TEXT,
  paid_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE public.discover_orders
  DROP CONSTRAINT IF EXISTS chk_discover_order_status;
ALTER TABLE public.discover_orders
  ADD CONSTRAINT chk_discover_order_status
  CHECK (status IN ('draft', 'pending_payment', 'paid', 'cancelled', 'expired', 'failed'));

CREATE INDEX IF NOT EXISTS idx_discover_orders_org_created
  ON public.discover_orders (organization_id, created_at DESC);

-- The payment webhook arrives with only the provider's reference, so it has to
-- be able to find the order by that alone.
CREATE UNIQUE INDEX IF NOT EXISTS uq_discover_orders_payment_ref
  ON public.discover_orders (payment_ref) WHERE payment_ref IS NOT NULL;

-- ── order items ─────────────────────────────────────────────────────────────
-- Line items snapshot the account handle, deliverable label and unit price at
-- the moment the quotation was issued. Without the snapshot, renaming an
-- account or editing a rate card would silently rewrite historical quotes and
-- the stored total would stop matching the sum of its own lines.
CREATE TABLE IF NOT EXISTS public.discover_order_items (
  id                 BIGSERIAL     PRIMARY KEY,
  order_id           BIGINT        NOT NULL REFERENCES public.discover_orders(id) ON DELETE CASCADE,
  social_account_id  UUID          NOT NULL,
  relation           VARCHAR(12)   NOT NULL,
  account_username   TEXT          NOT NULL,
  platform           VARCHAR(20)   NOT NULL,
  deliverable_id     VARCHAR(30)   NOT NULL,
  deliverable_label  TEXT          NOT NULL,
  qty                INTEGER       NOT NULL,
  unit_price         NUMERIC(14,2) NOT NULL,
  line_total         NUMERIC(14,2) NOT NULL
);

ALTER TABLE public.discover_order_items
  DROP CONSTRAINT IF EXISTS chk_discover_order_item_qty;
ALTER TABLE public.discover_order_items
  ADD CONSTRAINT chk_discover_order_item_qty CHECK (qty > 0);

ALTER TABLE public.discover_order_items
  DROP CONSTRAINT IF EXISTS chk_discover_order_item_relation;
ALTER TABLE public.discover_order_items
  ADD CONSTRAINT chk_discover_order_item_relation
  CHECK (relation IN ('owned', 'competitor'));

CREATE INDEX IF NOT EXISTS idx_discover_order_items_order
  ON public.discover_order_items (order_id);

-- Down Migration
-- DROP TABLE IF EXISTS public.discover_order_items;
-- DROP TABLE IF EXISTS public.discover_orders;
-- DROP TABLE IF EXISTS public.discover_rate_cards;
