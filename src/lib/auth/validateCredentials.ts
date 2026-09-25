import bcrypt from 'bcryptjs'
import kolDb from '@/lib/kolDb'

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
  // Identity for the KOL product lives on the KOL server (DEC-11).
  const result = await kolDb().query(
    'SELECT id, email, name, role, password_hash FROM public.user WHERE email = $1',
    [email]
  )

  if (!result.rowCount || result.rowCount === 0) return null

  const user = result.rows[0]
  if (!user.password_hash) return null

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) return null

  return { id: user.id, email: user.email, name: user.name, role: user.role }
}
