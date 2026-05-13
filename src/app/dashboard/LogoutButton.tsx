'use client'

import { logout } from './actions'

export default function LogoutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        className="flex items-center gap-2 h-9 px-4 rounded-xl border border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-outline font-body-md text-body-md transition-colors"
      >
        <span className="material-symbols-outlined text-[18px]">logout</span>
        Logout
      </button>
    </form>
  )
}
