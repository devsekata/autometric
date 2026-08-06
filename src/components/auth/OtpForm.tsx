'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  email: string
  onBack: () => void
  onResend: () => Promise<void>
  onSubmit: (otp: string) => Promise<void>
}

const OTP_LENGTH = 6
const RESEND_COOLDOWN = 60

export default function OtpForm({ email, onBack, onResend, onSubmit }: Props) {
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN)
  const [resending, setResending] = useState(false)
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    inputs.current[0]?.focus()
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  function handleChange(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[index] = digit
    setDigits(next)
    setError('')
    if (digit && index < OTP_LENGTH - 1) {
      inputs.current[index + 1]?.focus()
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus()
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH)
    const next = Array(OTP_LENGTH).fill('')
    pasted.split('').forEach((char, i) => { next[i] = char })
    setDigits(next)
    inputs.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus()
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault()
    const otp = digits.join('')
    if (otp.length < OTP_LENGTH) {
      setError('Please enter the complete 6-digit code.')
      return
    }

    setLoading(true)
    setError('')

    try {
      await onSubmit(otp)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.')
      setDigits(Array(OTP_LENGTH).fill(''))
      inputs.current[0]?.focus()
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    setResending(true)
    setError('')
    try {
      await onResend()
      setCooldown(RESEND_COOLDOWN)
      setDigits(Array(OTP_LENGTH).fill(''))
      inputs.current[0]?.focus()
    } catch {
      setError('Failed to resend OTP. Please try again.')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="w-full max-w-[380px] flex flex-col gap-6">

      {/* Mobile logo */}
      <div className="flex lg:hidden items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg bg-primary-container flex items-center justify-center">
          <span className="material-symbols-outlined fill text-on-primary" style={{ fontSize: 16 }}>insert_chart</span>
        </div>
        <span className="font-h3 text-h3 text-on-surface tracking-tight">Autometric</span>
      </div>

      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-on-surface-variant hover:text-on-surface transition-colors w-fit"
      >
        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
        <span className="font-body-md text-body-md">Back</span>
      </button>

      <div>
        <h2 className="font-h2 text-h2 text-on-surface mb-1">Check your email</h2>
        <p className="font-body-md text-body-md text-on-surface-variant">
          We sent a 6-digit code to{' '}
          <span className="font-semibold text-on-surface">{email}</span>
        </p>
      </div>

      <form onSubmit={handleFormSubmit} className="flex flex-col gap-6">
        <div className="flex gap-2 justify-between" onPaste={handlePaste}>
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={el => { inputs.current[i] = el }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              className={`w-12 h-14 text-center text-[22px] font-bold rounded-xl border bg-surface-container-lowest text-on-surface focus:outline-none focus:ring-2 transition-all ${
                error
                  ? 'border-error focus:border-error focus:ring-error/20'
                  : 'border-outline-variant focus:border-primary-container focus:ring-primary-container/20'
              }`}
            />
          ))}
        </div>

        {error && (
          <p className="text-[13px] text-error flex items-center gap-1.5 -mt-2">
            <span className="material-symbols-outlined text-[16px]">error</span>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 bg-primary-container hover:bg-primary text-on-primary font-body-md text-body-md font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
              Verifying...
            </>
          ) : (
            <>
              Verify code
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </>
          )}
        </button>
      </form>

      <p className="text-center font-body-md text-body-md text-on-surface-variant">
        Didn&apos;t receive the code?{' '}
        {cooldown > 0 ? (
          <span className="text-outline">Resend in {cooldown}s</span>
        ) : (
          <button
            onClick={handleResend}
            disabled={resending}
            className="font-semibold text-primary-container hover:text-primary transition-colors disabled:opacity-60"
          >
            {resending ? 'Sending...' : 'Resend code'}
          </button>
        )}
      </p>
    </div>
  )
}
