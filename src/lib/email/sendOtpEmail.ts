import transporter from '@/lib/email/client'
import { otpEmailTemplate } from '@/lib/email/templates/otp'

/** Shown to the user when the OTP email could not be sent. No SMTP detail. */
export const OTP_EMAIL_FAILED_MESSAGE =
  "We couldn't send the verification email. Please try again in a few minutes."

/**
 * Send an OTP email. Resolves to false instead of throwing when SMTP fails, so
 * callers can decide what to persist based on whether the code was delivered.
 *
 * The failure is logged with the SMTP error code and server reply only — never
 * the OTP, the credentials, or the recipient.
 */
export async function sendOtpEmail(
  to: string,
  name: string,
  otp: string,
  variant: 'register' | 'reset',
): Promise<boolean> {
  const { subject, html } = otpEmailTemplate(name, otp, variant)
  try {
    await transporter.sendMail({
      from: `"Autometric" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    })
    return true
  } catch (err) {
    const e = err as { code?: string; responseCode?: number; command?: string; message?: string }
    console.error(`[email] ${variant} OTP send failed:`, {
      code: e.code,
      responseCode: e.responseCode,
      command: e.command,
      message: e.message,
    })
    return false
  }
}
