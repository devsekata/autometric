import pool from '@/lib/db'

interface GoogleSignInParams {
  email: string
  name: string
  googleId: string
  avatarUrl: string | null
}

export async function handleGoogleSignIn({
  email,
  name,
  googleId,
  avatarUrl,
}: GoogleSignInParams): Promise<void> {
  const existing = await pool.query(
    'SELECT id, google_id FROM users WHERE email = $1',
    [email]
  )

  if (existing.rowCount && existing.rowCount > 0) {
    if (!existing.rows[0].google_id) {
      await pool.query(
        'UPDATE users SET google_id = $1, avatar_url = COALESCE(avatar_url, $2), email_verified = true WHERE email = $3',
        [googleId, avatarUrl, email]
      )
    }
  } else {
    await pool.query(
      `INSERT INTO users (email, name, google_id, avatar_url, email_verified)
       VALUES ($1, $2, $3, $4, true)`,
      [email, name, googleId, avatarUrl]
    )
  }
}

export async function getDbUserIdByEmail(email: string): Promise<string | null> {
  const result = await pool.query('SELECT id FROM users WHERE email = $1', [email])
  return result.rows[0]?.id ?? null
}

export async function getDbUserByEmail(email: string): Promise<{ id: string; name: string } | null> {
  const result = await pool.query('SELECT id, name FROM users WHERE email = $1', [email])
  return result.rows[0] ?? null
}
