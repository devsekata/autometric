'use client'

import { signOut } from 'next-auth/react'

export default function DashboardPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f0f1f8' }}>

      {/* Navbar */}
      <header className="h-16 bg-white border-b border-outline-variant flex items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary-container flex items-center justify-center">
            <span className="material-symbols-outlined fill text-on-primary" style={{ fontSize: 16 }}>insert_chart</span>
          </div>
          <span className="font-h3 text-h3 text-on-surface tracking-tight">Autometric</span>
        </div>

        <button
          onClick={() => signOut({ redirectTo: '/login' })}
          className="flex items-center gap-2 h-9 px-4 rounded-xl border border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-outline font-body-md text-body-md transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">logout</span>
          Logout
        </button>
      </header>

      {/* Body */}
      <main className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary-container/20 flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-primary-container" style={{ fontSize: 32 }}>insert_chart</span>
          </div>
          <h1 className="font-h2 text-h2 text-on-surface mb-2">Dashboard</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">Coming soon.</p>
        </div>
      </main>

    </div>
  )
}
