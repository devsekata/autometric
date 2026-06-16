const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

export default function ComingSoon({ title, icon, desc }: { title: string; icon: string; desc: string }) {
  return (
    <div className="min-h-screen bg-[#f7f8f9]">
      <header className="bg-white border-b border-[#e5e7eb] px-7 py-3.5">
        <h1 style={PJ} className="text-[18px] font-bold text-[#111827] tracking-[-0.02em]">{title}</h1>
      </header>
      <div className="flex flex-col items-center justify-center text-center gap-3 py-32 px-6">
        <div className="w-14 h-14 rounded-2xl bg-white border border-[#e5e7eb] flex items-center justify-center">
          <span className="material-symbols-outlined text-[28px] text-[#3d7e96]">{icon}</span>
        </div>
        <h2 style={PJ} className="text-[16px] font-bold text-[#111827] mt-1">{title}</h2>
        <p className="text-[13px] text-[#6b7280] max-w-sm leading-relaxed">{desc}</p>
        <span className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af] mt-2">Next up · after Overview is locked</span>
      </div>
    </div>
  )
}
