const { Client } = require('pg')

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'autometric',
  user: 'postgres',
  password: 'postgres',
})

async function reset() {
  await client.connect()

  await client.query(`
    DROP TABLE IF EXISTS
      competitor_social_accounts,
      competitors,
      brand_social_accounts,
      social_accounts,
      brands,
      organization_members,
      platforms,
      otp_verifications,
      organizations,
      users
    CASCADE;

    DROP TYPE IF EXISTS member_role CASCADE;
    DROP TYPE IF EXISTS member_status CASCADE;

    TRUNCATE pgmigrations;
  `)

  console.log('DB reset complete.')
  await client.end()
}

reset().catch(e => { console.error(e); process.exit(1) })
