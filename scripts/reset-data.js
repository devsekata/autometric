const { Client } = require('pg')
require('dotenv').config({ path: '.env.local' })

const client = new Client({ connectionString: process.env.DATABASE_URL })

async function resetData() {
  await client.connect()

  // Truncate all tables except users and platforms (reference data)
  await client.query(`
    TRUNCATE
      l0_raw.ig_profile_snapshots,
      l0_raw.ig_media_snapshots,
      l0_raw.ig_comments,
      l0_raw.ig_tagged_posts,
      l0_raw.ig_stories,
      l0_raw.tt_profile_snapshots,
      l0_raw.tt_video_snapshots,
      l0_raw.fb_profile_snapshots,
      l0_raw.fb_post_snapshots,
      l0_raw.fb_comments,
      public.brand_social_accounts,
      public.social_accounts,
      public.brands,
      public.organization_members,
      public.organizations,
      public.otp_verifications
    CASCADE;
  `)

  // scheduler_logs / initial_scrape_logs: truncate only if table exists
  // (migration may not have run yet)
  await client.query(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'scheduler_logs'
      ) THEN
        TRUNCATE public.scheduler_logs CASCADE;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'initial_scrape_logs'
      ) THEN
        TRUNCATE public.initial_scrape_logs CASCADE;
      END IF;
    END $$;
  `)

  console.log('Reset complete. Users and platforms preserved.')
  await client.end()
}

resetData().catch(e => { console.error(e); process.exit(1) })
