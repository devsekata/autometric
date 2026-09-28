import kolDb, { kolDbWrite } from '@/lib/kolDb'
import { sendOtpEmail, OTP_EMAIL_FAILED_MESSAGE } from '@/lib/email/sendOtpEmail'
import { generateOtp, hashOtp } from '@/lib/otp'

export async function forgotPassword(email: string): Promise<{ success: boolean; error?: string; status?: number }> {
  const result = await kolDb().query(
    'SELECT id, name FROM public.user WHERE email = $1',
    [email]
  )

  // Always return success to avoid revealing whether email exists
  if (!result.rowCount || result.rowCount === 0) {
    return { success: true }
  }

  const user = result.rows[0]

  const otp = generateOtp()
  const otpHash = await hashOtp(otp)

  // Send first, store second — same rule as registration: an undelivered code
  // is never saved, and the previous one is only replaced once a new one lands.
  const sent = await sendOtpEmail(email, user.name, otp, 'reset')
  if (!sent) {
    return { success: false, error: OTP_EMAIL_FAILED_MESSAGE, status: 503 }
  }

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

  const client = await kolDbWrite().connect()
  try {
    await client.query('BEGIN')
    await client.query(
      "DELETE FROM public.otp_verifications WHERE email = $1 AND purpose = 'reset_password'",
      [email]
    )
    await client.query(
      `INSERT INTO public.otp_verifications (email, otp_hash, name, password_hash, purpose, expires_at, created_at)
       VALUES ($1, $2, $3, '', 'reset_password', $4, NOW())`,
      [email, otpHash, user.name, expiresAt]
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  return { success: true }
}
