import pool from '@/lib/db'
import transporter from '@/lib/email/client'
import { otpEmailTemplate } from '@/lib/email/templates/otp'
import { generateOtp, hashOtp } from '@/lib/otp'

export async function forgotPassword(email: string): Promise<{ success: boolean; error?: string }> {
  const result = await pool.query(
    'SELECT id, name FROM users WHERE email = $1',
    [email]
  )

  // Always return success to avoid revealing whether email exists
  if (!result.rowCount || result.rowCount === 0) {
    return { success: true }
  }

  const user = result.rows[0]

  await pool.query(
    "DELETE FROM otp_verifications WHERE email = $1 AND purpose = 'reset_password'",
    [email]
  )

  const otp = generateOtp()
  const otpHash = await hashOtp(otp)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

  await pool.query(
    `INSERT INTO otp_verifications (email, otp_hash, name, password_hash, purpose, expires_at)
     VALUES ($1, $2, $3, '', 'reset_password', $4)`,
    [email, otpHash, user.name, expiresAt]
  )

  const { subject, html } = otpEmailTemplate(user.name, otp, 'reset')

  await transporter.sendMail({
    from: `"Autometric" <${process.env.SMTP_USER}>`,
    to: email,
    subject,
    html,
  })

  return { success: true }
}
