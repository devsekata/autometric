-- Up Migration: replace run_hours (INTEGER[]) with schedule_times (JSONB) to support hour+minute
ALTER TABLE public.scheduler_config
  ADD COLUMN schedule_times JSONB NOT NULL DEFAULT '[{"hour":2,"minute":0}]';

-- Migrate existing run_hours → schedule_times (minute defaults to 0)
UPDATE public.scheduler_config
SET schedule_times = (
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('hour', h, 'minute', 0) ORDER BY h),
    '[{"hour":2,"minute":0}]'::jsonb
  )
  FROM unnest(run_hours) AS h
);

ALTER TABLE public.scheduler_config DROP COLUMN run_hours;

-- Down Migration
-- ALTER TABLE public.scheduler_config ADD COLUMN run_hours INTEGER[] NOT NULL DEFAULT '{2}';
-- UPDATE public.scheduler_config SET run_hours = ARRAY(SELECT (t->>'hour')::int FROM jsonb_array_elements(schedule_times) AS t);
-- ALTER TABLE public.scheduler_config DROP COLUMN schedule_times;
