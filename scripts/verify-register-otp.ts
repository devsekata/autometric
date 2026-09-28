/**
 * Register → OTP → verify → user creation, against the real KOL database with
 * the SMTP transport STUBBED. This proves the code path; it does not prove that
 * Gmail accepts the credentials or that an email arrives.
 *
 *   npm run verify:register-otp                  stubbed flow only
 *   npm run verify:register-otp -- --smtp        + real SMTP login (no email sent)
 *   npm run verify:register-otp -- --http=URL    + real /api/auth/register call
 *                                                  (expects the SMTP-failure path;
 *                                                  sends a real email if SMTP works)
 *
 * WRITES to public.otp_verifications and public.user for throwaway addresses
 * under @example.invalid, and deletes them again in `finally`.
 */
import bcrypt from 'bcryptjs'
import transporter from '@/lib/email/client'
import kolDb, { kolDbWrite } from '@/lib/kolDb'
import { registerUser } from '@/lib/auth/register'
import { verifyEmailOtp } from '@/lib/auth/verifyOtp'
import { validateCredentials } from '@/lib/auth/validateCredentials'
import { OTP_EMAIL_FAILED_MESSAGE } from '@/lib/email/sendOtpEmail'

const args = process.argv.slice(2)
const httpBase = args.find(a => a.startsWith('--http='))?.slice(7)
const tag = `otp-e2e-${Date.now()}`
const addr = (n: string) => `${tag}-${n}@example.invalid`
const PASSWORD = 'correct-horse-battery'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

// ── SMTP stub ────────────────────────────────────────────────────────────────
type Mode = 'deliver' | 'fail'
let mode: Mode = 'deliver'
const outbox: { to: string; otp: string }[] = []
const realSendMail = transporter.sendMail.bind(transporter)
;(transporter as unknown as { sendMail: unknown }).sendMail = async (opts: { to: string; html: string }) => {
  if (mode === 'fail') {
    throw Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted. BadCredentials'), {
      code: 'EAUTH', responseCode: 535, command: 'AUTH PLAIN',
    })
  }
  const otp = /\b(\d{6})\b/.exec(opts.html)?.[1] ?? ''
  outbox.push({ to: opts.to, otp })
  return { messageId: 'stub' }
}
const lastOtp = (to: string) => [...outbox].reverse().find(m => m.to === to)?.otp ?? ''

const otpRows = async (email: string) =>
  (await kolDb().query(
    `SELECT id, otp_hash, expires_at FROM public.otp_verifications WHERE lower(email) = lower($1) AND purpose = 'register'`,
    [email],
  )).rows
const userRows = async (email: string) =>
  (await kolDb().query('SELECT id, email_verified, password_hash FROM public.user WHERE lower(email) = lower($1)', [email])).rows

async function main() {
  // Silence the expected SMTP-failure log line, but keep a copy to inspect.
  const logged: string[] = []
  const realError = console.error
  console.error = (...a: unknown[]) => { logged.push(JSON.stringify(a)) }

  // 1. SMTP failure leaves no OTP and returns a safe message
  const e1 = addr('fail')
  mode = 'fail'
  const r1 = await registerUser({ name: 'E2E', email: e1, password: PASSWORD })
  check('SMTP failure → success=false, status 503', !r1.success && r1.status === 503, `status=${r1.status}`)
  check('SMTP failure → user-facing message only', r1.error === OTP_EMAIL_FAILED_MESSAGE)
  check('SMTP failure → message has no SMTP detail', !/535|EAUTH|BadCredentials|smtp|gmail/i.test(r1.error ?? ''))
  check('SMTP failure → no OTP row stored', (await otpRows(e1)).length === 0)
  check('SMTP failure → no user created', (await userRows(e1)).length === 0)
  const log = logged.join('\n')
  check('SMTP failure → server log has code, not secret', log.includes('EAUTH') && !(process.env.SMTP_PASS && log.includes(process.env.SMTP_PASS.replace(/\s+/g, ''))))
  console.error = realError

  // 2. Happy path
  mode = 'deliver'
  const e2 = addr('ok')
  check('before register → email not in public.user', (await userRows(e2)).length === 0)
  const r2 = await registerUser({ name: 'E2E', email: e2, password: PASSWORD })
  const otpA = lastOtp(e2)
  check('register → success', r2.success, JSON.stringify(r2))
  check('register → OTP emailed (stub captured 6 digits)', /^\d{6}$/.test(otpA))
  let rows = await otpRows(e2)
  check('register → exactly one OTP row', rows.length === 1)
  check('register → OTP stored hashed, not plain', rows[0]?.otp_hash !== otpA && rows[0]?.otp_hash?.startsWith('$2'))
  check('register → user NOT created yet', (await userRows(e2)).length === 0)

  // 3. Resend replaces the previous code
  await registerUser({ name: 'E2E', email: e2, password: PASSWORD })
  const otpB = lastOtp(e2)
  rows = await otpRows(e2)
  check('resend → still exactly one OTP row', rows.length === 1)
  const oldCode = otpA === otpB ? null : await verifyEmailOtp({ email: e2, otp: otpA })
  check('resend → previous code rejected', oldCode === null || (!oldCode.success && /Invalid OTP/.test(oldCode.error ?? '')))

  // 4. Invalid code rejected, code stays usable
  const wrong = otpB === '000000' ? '111111' : '000000'
  const r4 = await verifyEmailOtp({ email: e2, otp: wrong })
  check('invalid OTP → rejected', !r4.success && /Invalid OTP/.test(r4.error ?? ''))
  check('invalid OTP → no user, OTP kept', (await userRows(e2)).length === 0 && (await otpRows(e2)).length === 1)

  // 5. Correct code creates the user and consumes the OTP
  const r5 = await verifyEmailOtp({ email: e2, otp: otpB })
  check('valid OTP → success', r5.success, JSON.stringify(r5))
  const u = await userRows(e2)
  check('valid OTP → exactly one user, email_verified', u.length === 1 && u[0].email_verified === true)
  check('valid OTP → password stored as bcrypt hash', !!u[0]?.password_hash && await bcrypt.compare(PASSWORD, u[0].password_hash))
  check('valid OTP → OTP row consumed', (await otpRows(e2)).length === 0)

  // 6. Reuse
  const r6 = await verifyEmailOtp({ email: e2, otp: otpB })
  check('reused OTP → rejected', !r6.success && /not found/i.test(r6.error ?? ''))
  check('reused OTP → still one user', (await userRows(e2)).length === 1)

  // 7. Login with the new account (the credentials provider's authorize())
  const login = await validateCredentials(e2, PASSWORD)
  check('login → valid password accepted', login?.email === e2)
  check('login → wrong password rejected', (await validateCredentials(e2, 'wrong-password')) === null)

  // 8. Duplicate registration (case-insensitive)
  const r8 = await registerUser({ name: 'E2E', email: e2.toUpperCase(), password: PASSWORD })
  check('register existing email (other case) → 409', !r8.success && r8.status === 409)

  // 9. Expired
  const e9 = addr('expired')
  await registerUser({ name: 'E2E', email: e9, password: PASSWORD })
  await kolDbWrite().query(
    `UPDATE public.otp_verifications SET expires_at = NOW() - interval '1 minute' WHERE lower(email) = lower($1)`, [e9])
  const r9 = await verifyEmailOtp({ email: e9, otp: lastOtp(e9) })
  check('expired OTP → rejected', !r9.success && /expired/i.test(r9.error ?? ''))
  check('expired OTP → row removed, no user', (await otpRows(e9)).length === 0 && (await userRows(e9)).length === 0)

  // 10. Concurrent double-submit of the same valid code
  const e10 = addr('race')
  await registerUser({ name: 'E2E', email: e10, password: PASSWORD })
  const code10 = lastOtp(e10)
  const both = await Promise.all([
    verifyEmailOtp({ email: e10, otp: code10 }),
    verifyEmailOtp({ email: e10, otp: code10 }),
  ])
  check('concurrent verify → exactly one success', both.filter(r => r.success).length === 1, JSON.stringify(both))
  check('concurrent verify → exactly one user', (await userRows(e10)).length === 1)

  // 11. Real SMTP login (optional)
  if (args.includes('--smtp')) {
    ;(transporter as unknown as { sendMail: unknown }).sendMail = realSendMail
    const ok = await transporter.verify().then(() => true).catch((e: { code?: string; responseCode?: number }) => {
      console.log(`      real SMTP: ${e.code} ${e.responseCode ?? ''}`)
      return false
    })
    check('REAL Gmail SMTP authentication', ok)
  }

  // 12. HTTP route against a running server, real SMTP (optional)
  if (httpBase) {
    const e12 = addr('http')
    const res = await fetch(`${httpBase}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'E2E', email: e12, password: PASSWORD, confirmPassword: PASSWORD }),
    })
    const body = await res.json().catch(() => ({}))
    console.log(`      HTTP ${res.status} ${JSON.stringify(body)}`)
    const rows12 = await otpRows(e12)
    if (res.status === 503) {
      check('HTTP SMTP failure → 503 with safe message', body.error === OTP_EMAIL_FAILED_MESSAGE)
      check('HTTP SMTP failure → no OTP row', rows12.length === 0)
    } else {
      check('HTTP register → 200 and one OTP row', res.status === 200 && rows12.length === 1)
    }
    check('HTTP response body carries no OTP', !/\b\d{6}\b/.test(JSON.stringify(body)))
  }
}

async function cleanup() {
  const like = `${tag}-%@example.invalid`
  const o = await kolDbWrite().query('DELETE FROM public.otp_verifications WHERE email LIKE $1', [like])
  const u = await kolDbWrite().query('DELETE FROM public.user WHERE email LIKE $1', [like])
  console.log(`cleanup: removed ${o.rowCount} OTP row(s), ${u.rowCount} test user(s) for ${tag}`)
}

main()
  .catch(err => { failures++; console.log('FAIL  unexpected error:', err) })
  .finally(async () => {
    await cleanup().catch(err => console.log('cleanup FAILED:', err))
    await kolDb().end(); await kolDbWrite().end()
    console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
    process.exit(failures ? 1 : 0)
  })
