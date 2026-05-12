import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { verifyOtp } from '@/lib/otp'

interface ResetResult {
  success: boolean
  error?: string
}

export async function verifyResetOtp(email: string, otp: string): Promise<ResetResult> {
  const result = await pool.query(
    `SELECT id, otp_hash, expires_at FROM otp_verifications
     WHERE email = $1 AND purpose = 'reset_password'
     ORDER BY created_at DESC LIMIT 1`,
    [email]
  )

  if (!result.rowCount || result.rowCount === 0) {
    return { success: false, error: 'OTP not found. Please request a new one.' }
  }

  const record = result.rows[0]

  if (new Date() > new Date(record.expires_at)) {
    await pool.query('DELETE FROM otp_verifications WHERE id = $1', [record.id])
    return { success: false, error: 'OTP has expired. Please request a new one.' }
  }

  const isValid = await verifyOtp(otp, record.otp_hash)
  if (!isValid) {
    return { success: false, error: 'Invalid OTP. Please try again.' }
  }

  return { success: true }
}

export async function resetPassword(
  email: string,
  otp: string,
  newPassword: string
): Promise<ResetResult> {
  const verify = await verifyResetOtp(email, otp)
  if (!verify.success) return verify

  const passwordHash = await bcrypt.hash(newPassword, 12)

  await pool.query(
    'UPDATE users SET password_hash = $1 WHERE email = $2',
    [passwordHash, email]
  )

  await pool.query(
    "DELETE FROM otp_verifications WHERE email = $1 AND purpose = 'reset_password'",
    [email]
  )

  return { success: true }
}
