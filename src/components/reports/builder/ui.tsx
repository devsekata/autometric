'use client'

export const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

export function Panel({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-[#e5e7eb] shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-[#f0f1f2] flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-[#6b7280]">{icon}</span>
        <h3 style={PJ} className="text-[12.5px] font-bold text-[#374151]">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={PJ} className="block text-[11px] font-bold uppercase tracking-wide text-[#9ca3af] mb-1.5">
      {children}
    </label>
  )
}

export function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5 [&:not(:first-child)]:mt-3">
      <Label>{label}</Label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={PJ}
        className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2.5 text-[13px] text-[#111827] bg-white focus:border-[#3d7e96] focus:outline-none"
      />
    </div>
  )
}
