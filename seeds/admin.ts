import 'dotenv/config'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const ADMIN_EMAIL    = 'dev.sekata@gmail.com'
const ADMIN_NAME     = 'Dev Sekata'
const ADMIN_PASSWORD = '123456789'

async function seed() {
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10)

  const { rows } = await pool.query(
    `INSERT INTO users (email, name, password_hash, email_verified, role)
     VALUES ($1, $2, $3, true, 'ADMIN')
     ON CONFLICT (email) DO UPDATE
       SET role          = 'ADMIN',
           password_hash = EXCLUDED.password_hash,
           name          = EXCLUDED.name
     RETURNING id, email, role`,
    [ADMIN_EMAIL, ADMIN_NAME, hash]
  )

  console.log('Admin seeded:', rows[0])
  await pool.end()
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
