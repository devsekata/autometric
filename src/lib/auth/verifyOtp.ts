import pool from '@/lib/db'
import { verifyOtp } from '@/lib/otp'

interface VerifyOtpInput {
  email: string
  otp: string
}

interface VerifyOtpResult {
  success: boolean
  error?: string
}

export async function verifyEmailOtp(input: VerifyOtpInput): Promise<VerifyOtpResult> {
  const { email, otp } = input

  const result = await pool.query(
    `SELECT id, otp_hash, name, password_hash, expires_at
     FROM otp_verifications
     WHERE email = $1 AND purpose = 'register'
     ORDER BY created_at DESC
     LIMIT 1`,
    [email]
  )

  if (!result.rowCount || result.rowCount === 0) {
    return { success: false, error: 'OTP not found. Please register again.' }
  }

  const record = result.rows[0]

  if (new Date() > new Date(record.expires_at)) {
    await pool.query('DELETE FROM otp_verifications WHERE id = $1', [record.id])
    return { success: false, error: 'OTP has expired. Please register again.' }
  }

  const isValid = await verifyOtp(otp, record.otp_hash)
  if (!isValid) {
    return { success: false, error: 'Invalid OTP. Please try again.' }
  }

  // Create the user
  await pool.query(
    `INSERT INTO users (email, name, password_hash, email_verified)
     VALUES ($1, $2, $3, true)`,
    [email, record.name, record.password_hash]
  )

  // Remove used OTP
  await pool.query('DELETE FROM otp_verifications WHERE id = $1', [record.id])

  return { success: true }
}
