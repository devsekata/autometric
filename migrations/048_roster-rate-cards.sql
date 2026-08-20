-- Rate cards for creators from the commercial KOL roster.
--
-- Until now only accounts the org tracks in the warehouse could be priced, so
-- the Directory tab — which browses `public.kol_directory` in the KOL platform's
-- own database — had an "Add to Cart" button that could never produce a priced
-- line. `buildQuotation` rejects anything it cannot price, correctly, so the
-- button toggled a local icon and led nowhere.
--
-- A roster creator has no price anywhere: that database carries followers,
-- engagement rate and categories, but no rate. Somebody has to state one, and
-- the org that wants to buy is the only party in a position to. So this is the
-- same shape as `discover_rate_cards` — one base rate per creator, multiplied by
-- the deliverable's factor — kept in its own table rather than mixed into that
-- one, because the two id spaces come from different databases and a single
-- column holding both would be a column nobody could join on with confidence.
--
-- `roster_kol_id` is UUID because `kol_directory.id` is, but it carries no
-- foreign key: that row lives on another server. A creator who leaves the roster
-- leaves a rate card behind pointing at nothing, which is the correct outcome —
-- an order placed last quarter must keep the price it was placed at.

CREATE TABLE IF NOT EXISTS public.discover_roster_rate_cards (
  organization_id UUID           NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  roster_kol_id   UUID           NOT NULL,
  base_rate       NUMERIC(14,2)  NOT NULL DEFAULT 0,
  currency        VARCHAR(3)     NOT NULL DEFAULT 'IDR',
  note            TEXT,
  updated_by      UUID           REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, roster_kol_id)
);

ALTER TABLE public.discover_roster_rate_cards
  DROP CONSTRAINT IF EXISTS chk_discover_roster_rate_nonneg;
ALTER TABLE public.discover_roster_rate_cards
  ADD CONSTRAINT chk_discover_roster_rate_nonneg CHECK (base_rate >= 0);

-- Order lines record which roster a line came from, so 'roster' joins the two
-- warehouse relations. Order items are a historical record and are never
-- rewritten, so widening the check only affects lines written from here on.
ALTER TABLE public.discover_order_items
  DROP CONSTRAINT IF EXISTS chk_discover_order_item_relation;
ALTER TABLE public.discover_order_items
  ADD CONSTRAINT chk_discover_order_item_relation
  CHECK (relation IN ('owned', 'competitor', 'roster'));

-- Down Migration
-- ALTER TABLE public.discover_order_items
--   DROP CONSTRAINT IF EXISTS chk_discover_order_item_relation;
-- ALTER TABLE public.discover_order_items
--   ADD CONSTRAINT chk_discover_order_item_relation
--   CHECK (relation IN ('owned', 'competitor'));
-- DROP TABLE IF EXISTS public.discover_roster_rate_cards;
