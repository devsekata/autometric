'use client'

import { useState } from 'react'
import OtpForm from './OtpForm'
import PasswordInput from './PasswordInput'

interface Props {
  onBack: () => void
}

type Step = 'email' | 'otp' | 'reset' | 'done'

interface ResetErrors {
  password?: string
  confirmPassword?: string
}

export default function ForgotPasswordForm({ onBack }: Props) {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [emailError, setEmailError] = useState('')
  const [resetErrors, setResetErrors] = useState<ResetErrors>({})
  const [apiError, setApiError] = useState('')
  const [loading, setLoading] = useState(false)

  async function sendOtp() {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to send OTP.')
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setEmailError('')

    if (!email.trim()) {
      setEmailError('Email is required.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError('Enter a valid email address.')
      return
    }

    setLoading(true)
    try {
      await sendOtp()
      setStep('otp')
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  async function handleResetSubmit(e: React.FormEvent) {
    e.preventDefault()
    setApiError('')

    const errs: ResetErrors = {}
    if (!newPassword) {
      errs.password = 'Password is required.'
    } else if (newPassword.length < 8) {
      errs.password = 'Password must be at least 8 characters.'
    }
    if (!confirmPassword) {
      errs.confirmPassword = 'Please confirm your password.'
    } else if (newPassword !== confirmPassword) {
      errs.confirmPassword = 'Passwords do not match.'
    }

    if (Object.keys(errs).length > 0) {
      setResetErrors(errs)
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, newPassword, confirmPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Something went wrong.')
      setStep('done')
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  // Step: OTP
  if (step === 'otp') {
    return (
      <OtpForm
        email={email}
        onBack={() => setStep('email')}
        onResend={sendOtp}
        onSubmit={async (enteredOtp) => {
          const res = await fetch('/api/auth/verify-reset-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp: enteredOtp }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Verification failed.')
          setOtp(enteredOtp)
          setStep('reset')
        }}
      />
    )
  }

  // Step: Reset password
  if (step === 'reset') {
    return (
      <div className="w-full max-w-[380px] flex flex-col gap-6">

        <div className="flex lg:hidden items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-lg bg-primary-container flex items-center justify-center">
            <span className="material-symbols-outlined fill text-on-primary" style={{ fontSize: 16 }}>insert_chart</span>
          </div>
          <span className="font-h3 text-h3 text-on-surface tracking-tight">Autometric</span>
        </div>

        <div>
          <h2 className="font-h2 text-h2 text-on-surface mb-1">Set new password</h2>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Choose a strong password for your account.
          </p>
        </div>

        <form onSubmit={handleResetSubmit} className="flex flex-col gap-4">
          <PasswordInput
            id="new-password"
            name="newPassword"
            label="New Password"
            placeholder="At least 8 characters"
            value={newPassword}
            onChange={e => { setNewPassword(e.target.value); setResetErrors(p => ({ ...p, password: undefined })) }}
            hasError={!!resetErrors.password}
            errorMessage={resetErrors.password}
          />
          <PasswordInput
            id="confirm-password"
            name="confirmPassword"
            label="Confirm Password"
            placeholder="Re-enter your password"
            value={confirmPassword}
            onChange={e => { setConfirmPassword(e.target.value); setResetErrors(p => ({ ...p, confirmPassword: undefined })) }}
            hasError={!!resetErrors.confirmPassword}
            errorMessage={resetErrors.confirmPassword}
          />

          {apiError && (
            <p className="text-[13px] text-error flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">error</span>
              {apiError}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 mt-1 bg-primary-container hover:bg-primary text-on-primary font-body-md text-body-md font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                Saving...
              </>
            ) : (
              <>
                Reset password
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </>
            )}
          </button>
        </form>
      </div>
    )
  }

  // Step: Done
  if (step === 'done') {
    return (
      <div className="w-full max-w-[380px] flex flex-col gap-6 items-center text-center">

        <div className="flex lg:hidden items-center gap-2 mb-2 self-start">
          <div className="w-7 h-7 rounded-lg bg-primary-container flex items-center justify-center">
            <span className="material-symbols-outlined fill text-on-primary" style={{ fontSize: 16 }}>insert_chart</span>
          </div>
          <span className="font-h3 text-h3 text-on-surface tracking-tight">Autometric</span>
        </div>

        <div className="w-16 h-16 rounded-2xl bg-primary-container/20 flex items-center justify-center">
          <span className="material-symbols-outlined text-primary-container" style={{ fontSize: 32 }}>check_circle</span>
        </div>

        <div>
          <h2 className="font-h2 text-h2 text-on-surface mb-1">Password reset!</h2>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Your password has been updated. You can now sign in with your new password.
          </p>
        </div>

        <button
          onClick={onBack}
          className="w-full h-11 bg-primary-container hover:bg-primary text-on-primary font-body-md text-body-md font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
        >
          Back to sign in
          <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
        </button>
      </div>
    )
  }

  // Step: Email
  return (
    <div className="w-full max-w-[380px] flex flex-col gap-6">

      <div className="flex lg:hidden items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg bg-primary-container flex items-center justify-center">
          <span className="material-symbols-outlined fill text-on-primary" style={{ fontSize: 16 }}>insert_chart</span>
        </div>
        <span className="font-h3 text-h3 text-on-surface tracking-tight">Autometric</span>
      </div>

      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-on-surface-variant hover:text-on-surface transition-colors w-fit"
      >
        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
        <span className="font-body-md text-body-md">Back to sign in</span>
      </button>

      <div>
        <h2 className="font-h2 text-h2 text-on-surface mb-1">Forgot password?</h2>
        <p className="font-body-md text-body-md text-on-surface-variant">
          Enter your email and we&apos;ll send a verification code to reset your password.
        </p>
      </div>

      <form onSubmit={handleEmailSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider" htmlFor="forgot-email">
            Email
          </label>
          <input
            id="forgot-email"
            name="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => { setEmail(e.target.value); setEmailError('') }}
            className={`w-full h-11 px-4 bg-surface-container-lowest border rounded-xl font-body-md text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 transition-all ${
              emailError
                ? 'border-error focus:border-error focus:ring-error/20'
                : 'border-outline-variant focus:border-primary-container focus:ring-primary-container/20'
            }`}
          />
          {emailError && (
            <p className="text-[12px] text-error flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">error</span>
              {emailError}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 mt-1 bg-primary-container hover:bg-primary text-on-primary font-body-md text-body-md font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
              Sending code...
            </>
          ) : (
            <>
              Send verification code
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </>
          )}
        </button>
      </form>
    </div>
  )
}
