require('dotenv').config({ path: '.env.local' })
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function seed() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Seed user
    const { rows: [user] } = await client.query(`
      INSERT INTO users (email, name, email_verified, password_hash)
      VALUES ('admin@autometric.com', 'Admin User', true, 'placeholder_hash')
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `)
    console.log('User seeded:', user.id)

    // Seed workspace
    const { rows: [workspace] } = await client.query(`
      INSERT INTO workspaces (name, created_by)
      VALUES ('Autometric HQ', $1)
      RETURNING id
    `, [user.id])
    console.log('Workspace seeded:', workspace.id)

    // Seed workspace owner member
    await client.query(`
      INSERT INTO workspace_members (workspace_id, user_id, email, role, status, joined_at)
      VALUES ($1, $2, 'admin@autometric.com', 'OWNER', 'ACTIVE', NOW())
      ON CONFLICT (workspace_id, email) DO NOTHING
    `, [workspace.id, user.id])
    console.log('Workspace member seeded')

    // Get platform IDs
    const { rows: platforms } = await client.query(`SELECT id, key FROM platforms`)
    const platformMap = Object.fromEntries(platforms.map(p => [p.key, p.id]))

    // Seed brand
    const { rows: [brand] } = await client.query(`
      INSERT INTO brands (workspace_id, name)
      VALUES ($1, 'Nike')
      RETURNING id
    `, [workspace.id])
    console.log('Brand seeded:', brand.id)

    // Seed social account for brand (Instagram, connected)
    const { rows: [socialNikeIG] } = await client.query(`
      INSERT INTO social_accounts (platform_id, username, connected, connected_at)
      VALUES ($1, '@nike', true, NOW())
      ON CONFLICT (platform_id, username) DO UPDATE SET connected = EXCLUDED.connected
      RETURNING id
    `, [platformMap['instagram']])
    console.log('Social account seeded:', socialNikeIG.id)

    // Link brand to social account
    await client.query(`
      INSERT INTO brand_social_accounts (brand_id, social_account_id)
      VALUES ($1, $2)
      ON CONFLICT (brand_id, social_account_id) DO NOTHING
    `, [brand.id, socialNikeIG.id])
    console.log('Brand social account linked')

    // Seed competitor
    const { rows: [competitor] } = await client.query(`
      INSERT INTO competitors (brand_id, name)
      VALUES ($1, 'Adidas')
      RETURNING id
    `, [brand.id])
    console.log('Competitor seeded:', competitor.id)

    // Seed social account for competitor (Instagram, not connected — scraped)
    const { rows: [socialAdidasIG] } = await client.query(`
      INSERT INTO social_accounts (platform_id, username, connected)
      VALUES ($1, '@adidas', false)
      ON CONFLICT (platform_id, username) DO UPDATE SET connected = EXCLUDED.connected
      RETURNING id
    `, [platformMap['instagram']])
    console.log('Competitor social account seeded:', socialAdidasIG.id)

    // Link competitor to social account
    await client.query(`
      INSERT INTO competitor_social_accounts (competitor_id, social_account_id, enabled)
      VALUES ($1, $2, true)
      ON CONFLICT (competitor_id, social_account_id) DO NOTHING
    `, [competitor.id, socialAdidasIG.id])
    console.log('Competitor social account linked')

    await client.query('COMMIT')
    console.log('\nSeed completed successfully.')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Seed failed:', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

seed()
