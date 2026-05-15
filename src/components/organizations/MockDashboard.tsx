const BAR_HEIGHTS = [32, 48, 40, 58, 44, 66, 54, 72, 60, 86, 70, 82]

const TOP_BRANDS = [
  { name: 'Autometric HQ', score: 92, color: '#3d7e96', pct: 92 },
  { name: 'Brand Studio',  score: 87, color: '#7c5cbf', pct: 87 },
  { name: 'Research Team', score: 79, color: '#059669', pct: 79 },
]

export default function MockDashboard() {
  return (
    <div className="flex flex-col gap-3 w-full max-w-[320px]">

      {/* Brand Score + bar chart */}
      <div className="bg-white rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-widest text-[#9ca3af] mb-1.5">
              Brand Score
            </p>
            <p className="text-[32px] font-bold text-[#0f172a] leading-none">92.4</p>
          </div>
          <div className="flex items-center gap-1 bg-[#dcfce7] px-2.5 py-1 rounded-lg">
            <span className="material-symbols-outlined text-[11px] text-[#16a34a]">trending_up</span>
            <span className="text-[11px] font-bold text-[#16a34a]">+12%</span>
          </div>
        </div>
        <div className="flex items-end gap-[3px] h-[52px]">
          {BAR_HEIGHTS.map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-sm"
              style={{ height: `${h}%`, background: i >= 9 ? '#3d7e96' : '#e5e7eb' }}
            />
          ))}
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10.5px] text-[#9ca3af]">Jan</span>
          <span className="text-[10.5px] text-[#9ca3af]">Dec</span>
        </div>
      </div>

      {/* Stat cards */}
      <div className="flex gap-3">
        <div className="flex-1 bg-white rounded-xl p-4 shadow-sm">
          <p className="text-[10.5px] text-[#9ca3af] mb-2">Brands</p>
          <p className="text-[26px] font-bold text-[#0f172a] leading-none">12</p>
        </div>
        <div className="flex-1 bg-white rounded-xl p-4 shadow-sm">
          <p className="text-[10.5px] text-[#9ca3af] mb-2">Members</p>
          <p className="text-[26px] font-bold text-[#0f172a] leading-none">8</p>
        </div>
      </div>

      {/* Top brands list */}
      <div className="bg-white rounded-xl px-4 pt-4 pb-3 shadow-sm">
        <p className="text-[10.5px] font-semibold uppercase tracking-widest text-[#9ca3af] mb-3">
          Top Brands
        </p>
        {TOP_BRANDS.map(b => (
          <div key={b.name} className="py-1.5">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: b.color }} />
                <span className="text-[12px] text-[#374151]">{b.name}</span>
              </div>
              <span className="text-[12px] font-semibold text-[#0f172a]">{b.score}</span>
            </div>
            <div className="h-[3px] bg-[#f3f4f6] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${b.pct}%`, background: b.color, opacity: 0.5 }}
              />
            </div>
          </div>
        ))}
      </div>

    </div>
  )
}
