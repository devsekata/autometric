import bcrypt from 'bcryptjs'
import kolDb, { kolDbWrite } from '@/lib/kolDb'
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
  const existing = await kolDb().query(
    'SELECT id FROM public.user WHERE email = $1',
    [email]
  )
  if (existing.rowCount && existing.rowCount > 0) {
    return { success: false, error: 'Email already registered.' }
  }

  // Delete any previous OTP for this email
  await kolDbWrite().query(
    "DELETE FROM public.otp_verifications WHERE email = $1 AND purpose = 'register'",
    [email]
  )

  const otp = generateOtp()
  const otpHash = await hashOtp(otp)
  const passwordHash = await bcrypt.hash(password, 12)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  await kolDbWrite().query(
    `INSERT INTO public.otp_verifications (email, otp_hash, name, password_hash, purpose, expires_at, created_at)
     VALUES ($1, $2, $3, $4, 'register', $5, NOW())`,
    [email, otpHash, name, passwordHash, expiresAt]
  )

  const { subject, html } = otpEmailTemplate(name, otp)

  await transporter.sendMail({
    from: `"Autometric" <${process.env.SMTP_USER}>`,
    to: email,
    subject,
    html,
  })

  return { success: true }
}
