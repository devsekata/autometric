import bcrypt from 'bcryptjs'
import pool from '@/lib/db'

type ValidateResult = {
  id:    string
  email: string
  name:  string
  role:  'ADMIN' | 'USER'
} | null

export async function validateCredentials(
  email: string,
  password: string
): Promise<ValidateResult> {
  const result = await pool.query(
    'SELECT id, email, name, role, password_hash FROM users WHERE email = $1',
    [email]
  )

  if (!result.rowCount || result.rowCount === 0) return null

  const user = result.rows[0]
  if (!user.password_hash) return null

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) return null

  return { id: user.id, email: user.email, name: user.name, role: user.role }
}
