import kolDb, { kolDbWrite } from '@/lib/kolDb'
import transporter from '@/lib/email/client'
import { otpEmailTemplate } from '@/lib/email/templates/otp'
import { generateOtp, hashOtp } from '@/lib/otp'

export async function forgotPassword(email: string): Promise<{ success: boolean; error?: string }> {
  const result = await kolDb().query(
    'SELECT id, name FROM public.user WHERE email = $1',
    [email]
  )

  // Always return success to avoid revealing whether email exists
  if (!result.rowCount || result.rowCount === 0) {
    return { success: true }
  }

  const user = result.rows[0]

  await kolDbWrite().query(
    "DELETE FROM public.otp_verifications WHERE email = $1 AND purpose = 'reset_password'",
    [email]
  )

  const otp = generateOtp()
  const otpHash = await hashOtp(otp)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

  await kolDbWrite().query(
    `INSERT INTO public.otp_verifications (email, otp_hash, name, password_hash, purpose, expires_at, created_at)
     VALUES ($1, $2, $3, '', 'reset_password', $4, NOW())`,
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
