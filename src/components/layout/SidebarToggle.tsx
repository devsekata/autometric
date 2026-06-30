'use client'

import { useSidebar } from './SidebarContext'

/** Collapse button that lives inside the expanded sidebar header. */
export default function SidebarToggle() {
  const { toggle } = useSidebar()
  return (
    <button
      onClick={toggle}
      title="Tutup sidebar"
      className="w-8 h-8 flex items-center justify-center rounded-lg text-[#94a3b8] hover:text-[#1e6278] hover:bg-[#f1f5f9] transition-colors flex-shrink-0"
    >
      <span className="material-symbols-outlined text-[20px]">menu_open</span>
    </button>
  )
}
