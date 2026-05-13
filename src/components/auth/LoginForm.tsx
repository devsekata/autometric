'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import GoogleButton from './GoogleButton'
import PasswordInput from './PasswordInput'

interface Props {
  onSwitch: () => void
  onForgotPassword: () => void
}

export default function LoginForm({ onSwitch, onForgotPassword }: Props) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [hasError, setHasError] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setHasError(false)
    setLoading(true)

    try {
      const result = await signIn('credentials', { email, password, redirect: false })

      if (result?.error) {
        setError('Invalid email or password.')
        setHasError(true)
        return
      }

      router.replace('/dashboard')
    } catch {
      setError('Something went wrong. Please try again.')
      setHasError(true)
    } finally {
      setLoading(false)
    }
  }

  function clearError() {
    setError('')
    setHasError(false)
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
        <h2 className="font-h2 text-h2 text-on-surface mb-1">Sign in</h2>
        <p className="font-body-md text-body-md text-on-surface-variant">Welcome back — enter your details below.</p>
      </div>

      <GoogleButton label="Continue with Google" />

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-outline-variant" />
        <span className="text-[12px] font-body-md text-on-surface-variant">or with email</span>
        <div className="flex-1 h-px bg-outline-variant" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => { setEmail(e.target.value); clearError() }}
            required
            className={`w-full h-11 px-4 bg-surface-container-lowest border rounded-xl font-body-md text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 transition-all ${
              hasError
                ? 'border-error focus:border-error focus:ring-error/20'
                : 'border-outline-variant focus:border-primary-container focus:ring-primary-container/20'
            }`}
          />
        </div>

        <PasswordInput
          id="login-password"
          name="password"
          label="Password"
          placeholder="Enter your password"
          value={password}
          onChange={e => { setPassword(e.target.value); clearError() }}
          hasError={hasError}
          extra={
            <button
              type="button"
              onClick={onForgotPassword}
              className="font-body-md text-body-md text-primary-container hover:text-primary transition-colors"
            >
              Forgot password?
            </button>
          }
        />

        {error && (
          <p className="text-[13px] text-error flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">error</span>
            {error}
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
              Signing in...
            </>
          ) : (
            <>
              Sign in
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </>
          )}
        </button>
      </form>

      <p className="text-center font-body-md text-body-md text-on-surface-variant">
        No account?{' '}
        <button onClick={onSwitch} className="font-semibold text-primary-container hover:text-primary transition-colors">
          Create one free
        </button>
      </p>
    </div>
  )
}
