'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

const NAV_ITEMS = [
  { href: '/admin',           label: 'Monitoring', icon: 'monitor_heart' },
  { href: '/admin/scheduler', label: 'Scheduler',  icon: 'schedule'      },
] as const

export default function AdminNav() {
  const pathname = usePathname()

  return (
    <aside style={{ width: 210, flexShrink: 0, background: '#fff', borderRight: '1px solid #e2e8f0', padding: '16px 12px' }}>
      <p className="text-[10.5px] font-bold text-[#94a3b8] uppercase tracking-wider px-3 mb-2" style={PJB}>
        Admin
      </p>
      <nav className="space-y-0.5">
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              style={PJB}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-colors ${
                active
                  ? 'bg-[#f1f5f9] text-[#0f172a]'
                  : 'text-[#64748b] hover:bg-[#f8fafc] hover:text-[#334155]'
              }`}
            >
              <span className={`material-symbols-outlined text-[18px] ${active ? 'text-[#3d7e96]' : 'text-[#94a3b8]'}`}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
