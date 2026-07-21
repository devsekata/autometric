-- Up Migration
-- Audit trail for the FIRST scrape when a brand or competitor account is connected.
-- One row per initial scrape of an account (aggregate across categories): status is
-- 'success' when every category synced, else 'failed'; records_synced is the total
-- records pulled. Matches the table already present in the shared DB, so this is
-- idempotent (IF NOT EXISTS) — it only creates the table/index on a fresh database.
CREATE TABLE IF NOT EXISTS public.initial_scrape_logs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID        NOT NULL,
  platform          TEXT        NOT NULL,
  brand_id          UUID,
  org_id            UUID,
  status            TEXT        NOT NULL,
  records_synced    INT,
  error_message     TEXT,
  started_at        TIMESTAMPTZ NOT NULL,
  finished_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_isl_account_status ON public.initial_scrape_logs (social_account_id, status);

-- Down Migration
-- DROP TABLE public.initial_scrape_logs;
