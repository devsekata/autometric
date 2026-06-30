-- Up Migration
CREATE TABLE IF NOT EXISTS public.scheduler_config (
  id         UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  run_hours  INTEGER[] NOT NULL DEFAULT '{2}',
  is_active  BOOLEAN   NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default config (02:00 WIB) if not yet exists
INSERT INTO public.scheduler_config (run_hours, is_active)
SELECT ARRAY[2], true
WHERE NOT EXISTS (SELECT 1 FROM public.scheduler_config);

-- Down Migration
-- DROP TABLE public.scheduler_config;
