'use client'

import { useState } from 'react'
import LeftPanel from './LeftPanel'
import LoginForm from './LoginForm'
import RegisterForm from './RegisterForm'
import ForgotPasswordForm from './ForgotPasswordForm'
import GoogleOneTap from './GoogleOneTap'

export type Mode = 'login' | 'register' | 'forgot-password'

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login')

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#f0f1f8' }}>
      <GoogleOneTap />

      <LeftPanel mode={mode} />

      {/* Right Panel — Sliding Forms */}
      <div
        className="w-full lg:w-1/2 h-full overflow-hidden relative"
        style={{
          background: '#ffffff',
          boxShadow: 'inset 6px 0 32px rgba(0,0,0,0.06)',
        }}
      >
        <div
          className="flex h-full"
          style={{
            width: '200%',
            transform: mode === 'register' ? 'translateX(-50%)' : 'translateX(0)',
            transition: 'transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          {/* Left slot — Login or Forgot Password */}
          <div className="w-1/2 h-full overflow-y-auto flex items-center justify-center p-8">
            {mode === 'forgot-password' ? (
              <ForgotPasswordForm onBack={() => setMode('login')} />
            ) : (
              <LoginForm
                onSwitch={() => setMode('register')}
                onForgotPassword={() => setMode('forgot-password')}
              />
            )}
          </div>

          {/* Right slot — Register */}
          <div className="w-1/2 h-full overflow-y-auto flex items-center justify-center p-8">
            <RegisterForm onSwitch={() => setMode('login')} />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
