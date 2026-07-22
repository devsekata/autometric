import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import transporter from '@/lib/email/client'
import { otpEmailTemplate } from '@/lib/email/templates/otp'
import { generateOtp, hashOtp } from '@/lib/otp'

interface RegisterInput {
  name: string
  email: string
  password: string
}

interface RegisterResult {
  success: boolean
  error?: string
}

export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const { name, email, password } = input

  // Check if email already registered
  const existing = await pool.query(
    'SELECT id FROM users WHERE email = $1',
    [email]
  )
  if (existing.rowCount && existing.rowCount > 0) {
    return { success: false, error: 'Email already registered.' }
  }

  // Delete any previous OTP for this email
  await pool.query(
    "DELETE FROM otp_verifications WHERE email = $1 AND purpose = 'register'",
    [email]
  )

  const otp = generateOtp()
  const otpHash = await hashOtp(otp)
  const passwordHash = await bcrypt.hash(password, 12)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  await pool.query(
    `INSERT INTO otp_verifications (email, otp_hash, name, password_hash, purpose, expires_at)
     VALUES ($1, $2, $3, $4, 'register', $5)`,
    [email, otpHash, name, passwordHash, expiresAt]
  )

  const { subject, html } = otpEmailTemplate(name, otp)

  await transporter.sendMail({
    from: `"Kepiai" <${process.env.SMTP_USER}>`,
    to: email,
    subject,
    html,
  })

  return { success: true }
}
