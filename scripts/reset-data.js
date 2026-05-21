const { Client } = require('pg')
require('dotenv').config({ path: '.env.local' })

const client = new Client({ connectionString: process.env.DATABASE_URL })

async function resetData() {
  await client.connect()

  await client.query(`
    TRUNCATE
      l0_raw.ig_media_snapshots,
      l0_raw.ig_profile_snapshots,
      public.brand_social_accounts,
      public.social_accounts,
      public.brands
    CASCADE;
  `)

  console.log('Data reset complete. Users and organizations preserved.')
  await client.end()
}

resetData().catch(e => { console.error(e); process.exit(1) })
