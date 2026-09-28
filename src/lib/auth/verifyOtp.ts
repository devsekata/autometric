import { kolDbWrite } from '@/lib/kolDb'
import { verifyOtp } from '@/lib/otp'

interface VerifyOtpInput {
  email: string
  otp: string
}

interface VerifyOtpResult {
  success: boolean
  error?: string
}

/**
 * Check a register OTP and create the account.
 *
 * Runs as one transaction holding the same per-email lock `registerUser` takes,
 * so two concurrent submissions of the same code cannot both create a user:
 * the second waits, then finds the code already consumed. The code is deleted
 * in the same commit that inserts the user, which is what makes it single-use.
 */
export async function verifyEmailOtp(input: VerifyOtpInput): Promise<VerifyOtpResult> {
  const email = input.email.trim()
  const { otp } = input

  const client = await kolDbWrite().connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('otp:register:' || lower($1)))", [email])

    const result = await client.query(
      `SELECT id, email, otp_hash, name, password_hash, expires_at
       FROM public.otp_verifications
       WHERE lower(email) = lower($1) AND purpose = 'register'
       ORDER BY created_at DESC
       LIMIT 1`,
      [email]
    )

    if (!result.rowCount || result.rowCount === 0) {
      await client.query('ROLLBACK')
      return { success: false, error: 'OTP not found. Please register again.' }
    }

    const record = result.rows[0]

    if (new Date() > new Date(record.expires_at)) {
      await client.query('DELETE FROM public.otp_verifications WHERE id = $1', [record.id])
      await client.query('COMMIT')
      return { success: false, error: 'OTP has expired. Please register again.' }
    }

    const isValid = await verifyOtp(otp, record.otp_hash)
    if (!isValid) {
      await client.query('ROLLBACK')
      return { success: false, error: 'Invalid OTP. Please try again.' }
    }

    // The email may have been claimed since the code was sent (e.g. a Google
    // sign-in). public.user has no unique index on email to catch that.
    const existing = await client.query(
      'SELECT id FROM public.user WHERE lower(email) = lower($1)',
      [email]
    )
    if (existing.rowCount && existing.rowCount > 0) {
      await client.query(
        "DELETE FROM public.otp_verifications WHERE lower(email) = lower($1) AND purpose = 'register'",
        [email]
      )
      await client.query('COMMIT')
      return { success: false, error: 'Email already registered. Please sign in.' }
    }

    // Create the user
    await client.query(
      `INSERT INTO public.user (email, name, password_hash, email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, true, NOW(), NOW())`,
      [record.email, record.name, record.password_hash]
    )

    // Remove used OTP
    await client.query(
      "DELETE FROM public.otp_verifications WHERE lower(email) = lower($1) AND purpose = 'register'",
      [email]
    )

    await client.query('COMMIT')
    return { success: true }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
