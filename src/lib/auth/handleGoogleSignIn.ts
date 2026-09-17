import kolDb, { kolDbWrite } from '@/lib/kolDb'

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
  const existing = await kolDb().query(
    'SELECT id, google_id FROM public.user WHERE email = $1',
    [email]
  )

  if (existing.rowCount && existing.rowCount > 0) {
    if (!existing.rows[0].google_id) {
      await kolDbWrite().query(
        'UPDATE public.user SET google_id = $1, avatar_url = COALESCE(avatar_url, $2), email_verified = true, updated_at = NOW() WHERE email = $3',
        [googleId, avatarUrl, email]
      )
    }
  } else {
    await kolDbWrite().query(
      `INSERT INTO public.user (email, name, google_id, avatar_url, email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, NOW(), NOW())`,
      [email, name, googleId, avatarUrl]
    )
  }
}

export async function getDbUserIdByEmail(email: string): Promise<string | null> {
  const result = await kolDb().query('SELECT id FROM public.user WHERE email = $1', [email])
  return result.rows[0]?.id ?? null
}

export async function getDbUserByEmail(email: string): Promise<{ id: string; name: string; role: 'ADMIN' | 'USER' } | null> {
  const result = await kolDb().query('SELECT id, name, role FROM public.user WHERE email = $1', [email])
  return result.rows[0] ?? null
}
