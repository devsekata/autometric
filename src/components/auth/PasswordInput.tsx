'use client'

import { useState } from 'react'

interface Props {
  id: string
  name: string
  label: string
  placeholder?: string
  extra?: React.ReactNode
  value?: string
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  hasError?: boolean
  errorMessage?: string
}

export default function PasswordInput({ id, name, label, placeholder, extra, value, onChange, hasError, errorMessage }: Props) {
  const [show, setShow] = useState(false)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label
          className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider"
          htmlFor={id}
        >
          {label}
        </label>
        {extra}
      </div>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={show ? 'text' : 'password'}
          placeholder={placeholder ?? '••••••••'}
          value={value}
          onChange={onChange}
          className={`w-full h-11 pl-4 pr-11 bg-surface-container-lowest border rounded-xl font-body-md text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 transition-all ${
            hasError
              ? 'border-error focus:border-error focus:ring-error/20'
              : 'border-outline-variant focus:border-primary-container focus:ring-primary-container/20'
          }`}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow(v => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <span className="material-symbols-outlined text-[20px]">
            {show ? 'visibility_off' : 'visibility'}
          </span>
        </button>
      </div>
      {hasError && errorMessage && (
        <p className="text-[12px] text-error flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">error</span>
          {errorMessage}
        </p>
      )}
    </div>
  )
}
