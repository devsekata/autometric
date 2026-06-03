-- Up Migration
CREATE TABLE IF NOT EXISTS public.scheduler_logs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID        NOT NULL,
  job_name          TEXT        NOT NULL,
  platform          TEXT        NOT NULL,
  category          TEXT,
  social_account_id UUID        REFERENCES public.social_accounts(id) ON DELETE SET NULL,
  brand_id          UUID        REFERENCES public.brands(id)          ON DELETE SET NULL,
  org_id            UUID        REFERENCES public.organizations(id)   ON DELETE SET NULL,
  status            TEXT        NOT NULL CHECK (status IN ('running','success','failed','skipped')),
  records_synced    INT,
  error_message     TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scheduler_logs_run_id    ON public.scheduler_logs (run_id);
CREATE INDEX IF NOT EXISTS idx_scheduler_logs_started   ON public.scheduler_logs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduler_logs_account   ON public.scheduler_logs (social_account_id, started_at DESC);

-- Down Migration
-- DROP TABLE public.scheduler_logs;
