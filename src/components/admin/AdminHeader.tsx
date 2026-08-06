'use client'

import Link from 'next/link'
import { signOut } from 'next-auth/react'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

export default function AdminHeader({ userName }: { userName: string }) {
  return (
    <header className="h-14 bg-white border-b border-[#e2e8f0] flex items-center px-8">
      <Link href="/admin">
        <img src="/autometric-logo-long.png" alt="Autometric" className="h-7 w-auto" />
      </Link>

      <div className="ml-4 flex items-center gap-1.5">
        <span className="text-[#e2e8f0]">·</span>
        <span
          className="text-[11.5px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-md bg-[#fef3c7] text-[#92400e]"
          style={PJB}
        >
          Admin Panel
        </span>
      </div>

      <div className="ml-auto flex items-center gap-4">
        <span className="text-[13px] text-[#64748b]" style={PJB}>
          {userName}
        </span>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          style={PJB}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#e2e8f0] text-[12.5px] font-semibold text-[#64748b] hover:bg-[#f8fafc] hover:text-[#334155] transition-colors"
        >
          <span className="material-symbols-outlined text-[15px]">logout</span>
          Sign out
        </button>
      </div>
    </header>
  )
}
