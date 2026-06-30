-- Up Migration
-- Separate scheduler config for competitor sync (Hiker/Apify scrapes), independent
-- from the owned-account scheduler (public.scheduler_config).
--   - schedule_times: WIB times the daily PROFILE snapshot runs for all competitors
--   - posts_day_of_month: calendar date (1-28) on which POSTS are also synced for all
--     competitors. Capped at 28 so it never skips a month (Feb).
CREATE TABLE IF NOT EXISTS public.competitor_scheduler_config (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_times     JSONB       NOT NULL DEFAULT '[{"hour":3,"minute":0}]',
  posts_day_of_month INTEGER     NOT NULL DEFAULT 1 CHECK (posts_day_of_month BETWEEN 1 AND 28),
  is_active          BOOLEAN     NOT NULL DEFAULT true,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default config (03:00 WIB daily profile, posts on the 1st) if not yet exists
INSERT INTO public.competitor_scheduler_config (schedule_times, posts_day_of_month, is_active)
SELECT '[{"hour":3,"minute":0}]'::jsonb, 1, true
WHERE NOT EXISTS (SELECT 1 FROM public.competitor_scheduler_config);

-- Down Migration
-- DROP TABLE public.competitor_scheduler_config;
