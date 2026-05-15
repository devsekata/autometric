'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import UserMenu from './UserMenu'

const navItems = [
  { href: '/organizations', label: 'Organizations', icon: 'corporate_fare' },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="fixed inset-y-0 left-0 w-[280px] flex flex-col bg-white border-r border-[#e5e7eb] z-10">
      <div className="h-16 flex items-center px-4 border-b border-[#e5e7eb] flex-shrink-0">
        <img src="/auometric-logo-long.png" alt="Autometric" className="w-full max-w-[168px] h-auto" />
      </div>

      <nav className="flex-1 py-2 px-2 flex flex-col gap-0.5 overflow-y-auto">
        {navItems.map(item => {
          const active = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 h-9 px-3 rounded-md text-[13.5px] font-medium transition-colors ${
                active
                  ? 'bg-[#edf5f8] text-[#1e6278]'
                  : 'text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827]'
              }`}
            >
              <span className={`material-symbols-outlined text-[18px] flex-shrink-0 ${active ? 'text-[#3d7e96]' : ''}`}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      <UserMenu />
    </aside>
  )
}
