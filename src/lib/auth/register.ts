import bcrypt from 'bcryptjs'
import kolDb, { kolDbWrite } from '@/lib/kolDb'
import { sendOtpEmail, OTP_EMAIL_FAILED_MESSAGE } from '@/lib/email/sendOtpEmail'
import { generateOtp, hashOtp } from '@/lib/otp'

interface RegisterInput {
  name: string
  email: string
  password: string
}

interface RegisterResult {
  success: boolean
  error?: string
  /** HTTP status the route should answer with when success is false. */
  status?: number
}

export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const { name, password } = input
  const email = input.email.trim()

  // Check if email already registered. Case-insensitive: public.user has no
  // unique index on email, so this check is the only thing stopping a second
  // account for the same mailbox.
  const existing = await kolDb().query(
    'SELECT id FROM public.user WHERE lower(email) = lower($1)',
    [email]
  )
  if (existing.rowCount && existing.rowCount > 0) {
    return { success: false, error: 'Email already registered.', status: 409 }
  }

  const otp = generateOtp()
  const otpHash = await hashOtp(otp)
  const passwordHash = await bcrypt.hash(password, 12)

  // Send first, store second: a code is only saved once it has been delivered,
  // so an SMTP failure leaves nothing in otp_verifications. Any earlier code
  // that did reach the user stays valid until it is replaced below.
  const sent = await sendOtpEmail(email, name, otp, 'register')
  if (!sent) {
    return { success: false, error: OTP_EMAIL_FAILED_MESSAGE, status: 503 }
  }

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  // Replace any previous code for this email in one transaction, serialised per
  // email, so exactly one register OTP is active at a time.
  const client = await kolDbWrite().connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('otp:register:' || lower($1)))", [email])
    await client.query(
      "DELETE FROM public.otp_verifications WHERE lower(email) = lower($1) AND purpose = 'register'",
      [email]
    )
    await client.query(
      `INSERT INTO public.otp_verifications (email, otp_hash, name, password_hash, purpose, expires_at, created_at)
       VALUES ($1, $2, $3, $4, 'register', $5, NOW())`,
      [email, otpHash, name, passwordHash, expiresAt]
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
