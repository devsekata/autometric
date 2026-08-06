'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'

import GoogleButton from './GoogleButton'
import OtpForm from './OtpForm'
import PasswordInput from './PasswordInput'

interface Props {
  onSwitch: () => void
}

interface FormState {
  name: string
  email: string
  password: string
  confirmPassword: string
}

interface FormErrors {
  name?: string
  email?: string
  password?: string
  confirmPassword?: string
}

type Step = 'form' | 'otp'

function validate(form: FormState): FormErrors {
  const errs: FormErrors = {}
  if (!form.name.trim()) {
    errs.name = 'Full name is required.'
  }
  if (!form.email.trim()) {
    errs.email = 'Email is required.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errs.email = 'Enter a valid email address.'
  }
  if (!form.password) {
    errs.password = 'Password is required.'
  } else if (form.password.length < 8) {
    errs.password = 'Password must be at least 8 characters.'
  }
  if (!form.confirmPassword) {
    errs.confirmPassword = 'Please confirm your password.'
  } else if (form.password !== form.confirmPassword) {
    errs.confirmPassword = 'Passwords do not match.'
  }
  return errs
}

export default function RegisterForm({ onSwitch }: Props) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('form')
  const [form, setForm] = useState<FormState>({ name: '', email: '', password: '', confirmPassword: '' })
  const [errors, setErrors] = useState<FormErrors>({})
  const [apiError, setApiError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    setErrors(prev => ({ ...prev, [name]: undefined }))
    setApiError('')
  }

  async function sendOtp() {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to send OTP.')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setApiError('')

    const errs = validate(form)
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    setLoading(true)
    try {
      await sendOtp()
      setStep('otp')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.'
      if (message.toLowerCase().includes('email')) {
        setErrors(prev => ({ ...prev, email: message }))
      } else {
        setApiError(message)
      }
    } finally {
      setLoading(false)
    }
  }

  if (step === 'otp') {
    return (
      <OtpForm
        email={form.email}
        onBack={() => setStep('form')}
        onResend={sendOtp}
        onSubmit={async (otp) => {
          const res = await fetch('/api/auth/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: form.email, otp }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Verification failed.')

          const result = await signIn('credentials', {
            email: form.email,
            password: form.password,
            redirect: false,
          })
          if (!result?.error) router.push('/')
        }}
      />
    )
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

      <div>
        <h2 className="font-h2 text-h2 text-on-surface mb-1">Create account</h2>
        <p className="font-body-md text-body-md text-on-surface-variant">Start tracking your brand performance today.</p>
      </div>

      <GoogleButton label="Sign up with Google" />

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-outline-variant" />
        <span className="text-[12px] font-body-md text-on-surface-variant">or with email</span>
        <div className="flex-1 h-px bg-outline-variant" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">

        {/* Full Name */}
        <div className="flex flex-col gap-1.5">
          <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider" htmlFor="reg-name">
            Full Name
          </label>
          <input
            id="reg-name"
            name="name"
            type="text"
            placeholder="Enter your full name"
            value={form.name}
            onChange={handleChange}
            className={`w-full h-11 px-4 bg-surface-container-lowest border rounded-xl font-body-md text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 transition-all ${
              errors.name
                ? 'border-error focus:border-error focus:ring-error/20'
                : 'border-outline-variant focus:border-primary-container focus:ring-primary-container/20'
            }`}
          />
          {errors.name && (
            <p className="text-[12px] text-error flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">error</span>
              {errors.name}
            </p>
          )}
        </div>

        {/* Email */}
        <div className="flex flex-col gap-1.5">
          <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider" htmlFor="reg-email">
            Email
          </label>
          <input
            id="reg-email"
            name="email"
            type="email"
            placeholder="you@example.com"
            value={form.email}
            onChange={handleChange}
            className={`w-full h-11 px-4 bg-surface-container-lowest border rounded-xl font-body-md text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 transition-all ${
              errors.email
                ? 'border-error focus:border-error focus:ring-error/20'
                : 'border-outline-variant focus:border-primary-container focus:ring-primary-container/20'
            }`}
          />
          {errors.email && (
            <p className="text-[12px] text-error flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">error</span>
              {errors.email}
            </p>
          )}
        </div>

        <PasswordInput
          id="reg-password"
          name="password"
          label="Password"
          placeholder="At least 8 characters"
          value={form.password}
          onChange={handleChange}
          hasError={!!errors.password}
          errorMessage={errors.password}
        />

        <PasswordInput
          id="reg-confirm"
          name="confirmPassword"
          label="Confirm Password"
          placeholder="Re-enter your password"
          value={form.confirmPassword}
          onChange={handleChange}
          hasError={!!errors.confirmPassword}
          errorMessage={errors.confirmPassword}
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
              Sending code...
            </>
          ) : (
            <>
              Create account
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </>
          )}
        </button>
      </form>

      <p className="text-center font-body-md text-body-md text-on-surface-variant">
        Already have an account?{' '}
        <button onClick={onSwitch} className="font-semibold text-primary-container hover:text-primary transition-colors">
          Sign in
        </button>
      </p>
    </div>
  )
}
