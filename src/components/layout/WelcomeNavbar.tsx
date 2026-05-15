'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { logout } from '@/lib/auth/actions'

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

export default function WelcomeNavbar() {
  const { data: session } = useSession()
  const name     = session?.user?.name  || 'User'
  const email    = session?.user?.email || ''
  const initials = getInitials(name)

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onMouse(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouse)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouse)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <header className="h-20 flex-shrink-0 flex items-center px-10 bg-white border-b border-[#e5e7eb]">

      {/* Logo */}
      <img
        src="/auometric-logo-long.png"
        alt="Autometric"
        className="h-16 w-auto object-contain"
      />

      <div className="flex-1" />

      {/* User dropdown trigger */}
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2.5 h-9 px-3 rounded-lg hover:bg-[#f9fafb] border border-transparent hover:border-[#e5e7eb] transition-all"
        >
          <div className="w-8 h-8 rounded-full bg-[#3d7e96] flex items-center justify-center flex-shrink-0">
            <span className="text-[12px] font-bold text-white leading-none">{initials}</span>
          </div>
          <span className="text-[13.5px] font-semibold text-[#111827]">{name}</span>
          <span className={`material-symbols-outlined text-[16px] text-[#9ca3af] transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>
            keyboard_arrow_down
          </span>
        </button>

        {/* Dropdown */}
        {open && (
          <div className="absolute top-full right-0 mt-1.5 w-[230px] bg-white rounded-xl border border-[#e5e7eb] shadow-xl shadow-black/8 z-20 overflow-hidden">

            {/* User info — non-clickable header */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[#f3f4f6]">
              <div className="w-9 h-9 rounded-full bg-[#3d7e96] flex items-center justify-center flex-shrink-0">
                <span className="text-[13px] font-bold text-white leading-none">{initials}</span>
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[#111827] truncate leading-tight">{name}</p>
                <p className="text-[11px] text-[#9ca3af] truncate leading-tight mt-0.5">{email}</p>
              </div>
            </div>

            {/* Menu items */}
            <div className="py-1">
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-medium text-[#374151] hover:bg-[#f9fafb] transition-colors"
              >
                <span className="material-symbols-outlined text-[17px] text-[#9ca3af]">settings</span>
                Settings
              </Link>
            </div>

            <div className="border-t border-[#f3f4f6] py-1">
              <form action={logout}>
                <button
                  type="submit"
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-medium text-[#ef4444] hover:bg-[#fef2f2] transition-colors"
                >
                  <span className="material-symbols-outlined text-[17px]">logout</span>
                  Sign out
                </button>
              </form>
            </div>

          </div>
        )}
      </div>
    </header>
  )
}
