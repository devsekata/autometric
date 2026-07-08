'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DashBrand, DashPlatform } from '@/components/dashboard/data'
import { CoverColors } from '@/lib/reports/cover/colors'
import { COVER_TEMPLATES, getTemplate } from '@/lib/reports/cover/templates'
import { ReportRecord, relativeDate } from '@/lib/reports/data/history'
import type { ReportTemplateRecord } from '@/lib/reports/data/slideModel'
import ReportBuilder from './builder/ReportBuilder'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

// Default palette used for the cover-style gallery previews.
const GALLERY_COLORS: CoverColors = { primary: '#1e4f49', secondary: '#3d7e96', accent: '#e0a458' }

const DAY = 86_400_000

/**
 * Reports landing page: stats, template quick-starts, and a grid of previously
 * exported reports. "Create report" (or any template card) launches the builder.
 */
export default function ReportsView({
  orgName, orgId, brands, history, templates,
}: {
  orgName: string
  orgId: string
  brands: DashBrand[]
  history: ReportRecord[]
  templates: ReportTemplateRecord[]
}) {
  const router = useRouter()
  const [view, setView] = useState<'index' | 'builder'>('index')
  const [launchTemplate, setLaunchTemplate] = useState<string | undefined>(undefined)

  function openBuilder(templateId?: string) {
    setLaunchTemplate(templateId)
    setView('builder')
  }

  if (view === 'builder') {
    return (
      <ReportBuilder
        orgName={orgName}
        orgId={orgId}
        brands={brands}
        templates={templates}
        initialTemplateId={launchTemplate}
        onExit={() => { setView('index'); router.refresh() }}
      />
    )
  }

  return (
    <ReportsIndex
      orgName={orgName} orgId={orgId} brands={brands} history={history}
      onCreate={openBuilder}
    />
  )
}

/* ── Index ──────────────────────────────────────────────────────────────── */

function ReportsIndex({
  orgName, orgId, brands, history, onCreate,
}: {
  orgName: string
  orgId: string
  brands: DashBrand[]
  history: ReportRecord[]
  onCreate: (templateId?: string) => void
}) {
  const [search, setSearch] = useState('')
  const [brandFilter, setBrandFilter] = useState('all')

  const total = history.length
  const thisMonth = useMemo(
    () => history.filter(r => Date.now() - r.exportedAt < 30 * DAY).length,
    [history],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return history.filter(r => {
      const brand = brands.find(b => b.id === r.brandId)
      const matchesBrand = brandFilter === 'all' || r.brandId === brandFilter
      const matchesSearch =
        !q ||
        r.name.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        (brand?.name.toLowerCase().includes(q) ?? false)
      return matchesBrand && matchesSearch
    })
  }, [search, brandFilter, history])

  return (
    <div className="flex flex-col min-h-full bg-white">

      {/* ════ Header ════ */}
      <div className="px-10 pt-7 pb-5 border-b-2 border-[#e2e8f0] flex items-end justify-between gap-6">
        <div>
          <p className="text-[12.5px] text-[#94a3b8] mb-1.5 tracking-wide" style={PJ}>Generate &amp; export reports</p>
          <h1 style={PJ} className="text-[36px] font-bold text-[#0f172a] tracking-[-0.04em] leading-none">
            Reports
          </h1>
          <p className="text-[13.5px] text-[#94a3b8] mt-2" style={PJ}>
            <span className="font-bold text-[#334155]">{total}</span> report{total !== 1 ? 's' : ''} exported · {orgName}
          </p>
        </div>
        <button
          onClick={() => onCreate(undefined)}
          style={PJ}
          className="flex items-center gap-2 h-11 px-5 bg-[#1e4f49] hover:bg-[#163a35] text-white text-[13.5px] font-bold rounded-xl transition-colors shadow-[0_2px_10px_rgba(30,79,73,0.30)] flex-shrink-0"
        >
          <span className="material-symbols-outlined text-[19px]">add</span>
          Create report
        </button>
      </div>

      {/* ════ Stats ════ */}
      <div className="px-10 pt-6 grid grid-cols-3 gap-4">
        <Stat icon="description" label="Total reports" value={String(total)} tint="#1e4f49" />
        <Stat icon="calendar_month" label="Exported this month" value={String(thisMonth)} tint="#3d7e96" />
        <Stat icon="palette" label="Cover templates" value={String(COVER_TEMPLATES.length)} tint="#e0a458" />
      </div>

      {/* ════ Body — two columns ════ */}
      <div className="flex flex-1">
        <div className="flex-1 min-w-0 px-10 pt-8 pb-10 space-y-9">

          {/* Template quick-start strip — tinted panel, compact tiles (distinct from history) */}
          <section className="rounded-2xl border border-[#e3ece9] bg-gradient-to-br from-[#f2f8f5] to-[#eef4f7] px-6 py-5">
            <div className="flex items-center gap-2.5 mb-4">
              <span className="w-9 h-9 rounded-xl bg-[#1e4f49] text-white flex items-center justify-center flex-shrink-0">
                <span className="material-symbols-outlined text-[19px]">auto_awesome</span>
              </span>
              <div>
                <h2 style={PJ} className="text-[15px] font-bold text-[#0f172a] tracking-[-0.01em]">Start from a cover style</h2>
                <p className="text-[12px] text-[#73858c] mt-0.5">Pick a cover style to jump into the builder — you can change it later</p>
              </div>
            </div>
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
              {COVER_TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => onCreate(t.id)}
                  title={t.description}
                  className="group text-left"
                >
                  <div
                    className="aspect-video rounded-lg overflow-hidden ring-1 ring-[#dde6e2] group-hover:ring-2 group-hover:ring-[#1e4f49] group-hover:shadow-[0_4px_14px_rgba(30,79,73,0.18)] transition-all"
                    style={{
                      backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(t.background(GALLERY_COLORS, 'light'))}")`,
                      backgroundSize: 'cover',
                    }}
                  />
                  <p style={PJ} className="text-[11.5px] font-semibold text-[#5b6b73] group-hover:text-[#1e4f49] mt-1.5 px-0.5 transition-colors">
                    {t.name}
                  </p>
                </button>
              ))}
            </div>
          </section>

          {/* History */}
          <section>
            <div className="flex items-center justify-between gap-4">
              <SectionHead title="Recent exports" hint={`${filtered.length} of ${total} reports`} />
              <div className="flex items-center gap-2.5 flex-shrink-0">
                <select
                  value={brandFilter}
                  onChange={e => setBrandFilter(e.target.value)}
                  style={PJ}
                  className="h-9 text-[12.5px] font-semibold text-[#334155] bg-white border border-[#e2e8f0] rounded-lg px-3 cursor-pointer hover:border-[#cbd5e1] outline-none"
                >
                  <option value="all">All brands</option>
                  {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <div className="relative flex items-center">
                  <span className="material-symbols-outlined text-[15px] text-[#94a3b8] absolute left-3 pointer-events-none">search</span>
                  <input
                    type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search reports"
                    style={PJ}
                    className="h-9 pl-8 pr-3 w-48 text-[13px] text-[#334155] placeholder:text-[#94a3b8] bg-white border border-[#e2e8f0] rounded-lg outline-none focus:border-[#3d7e96] focus:ring-2 focus:ring-[#3d7e96]/10 transition-all"
                  />
                </div>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="py-16 text-center border-2 border-dashed border-[#e2e8f0] rounded-2xl mt-4">
                <span className="material-symbols-outlined text-[44px] text-[#e2e8f0] mb-2 block">folder_off</span>
                <p style={PJ} className="text-[14px] font-semibold text-[#334155]">No reports found</p>
                <p className="text-[13px] text-[#94a3b8] mt-1">Try a different brand or search term.</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4 mt-4">
                {filtered.map(r => <ReportCard key={r.id} record={r} orgId={orgId} brands={brands} />)}
              </div>
            )}
          </section>
        </div>

        {/* ════ Right info column ════ */}
        <div className="w-[280px] flex-shrink-0 px-7 pt-8 pb-10 border-l border-[#eef2f6]">
            <h2 style={PJ} className="text-[16px] font-bold text-[#0f172a] mb-3">About reports</h2>
            <p className="text-[13px] text-[#64748b] leading-[1.65] mb-6">
              Build polished, on-brand PowerPoint reports from your social analytics in minutes. Pick a cover, drop in your
              logo, and export an editable <span className="font-semibold text-[#334155]">.pptx</span> for{' '}
              <span className="font-semibold text-[#334155]">{orgName}</span>.
            </p>

            <div className="flex flex-col gap-5">
              <InfoRow title="Branded covers"
                body="Six cover templates that tint automatically from your uploaded logo's colors." />
              <InfoRow title="Fully editable"
                body="Titles and text export as native PowerPoint elements, so they stay editable after download." />
              <InfoRow title="Fast exports"
                body="No server round-trips — covers render and export right in your browser." />
            </div>

            <div className="mt-7 pt-6 border-t border-[#e2e8f0] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] text-[#94a3b8]">Last export</span>
                <span style={PJ} className="text-[13px] font-semibold text-[#334155]">
                  {total ? relativeDate(history[0].exportedAt) : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] text-[#94a3b8]">Format</span>
                <span style={PJ} className="text-[13px] font-semibold text-[#334155]">PPTX</span>
              </div>
            </div>
          </div>
      </div>
    </div>
  )
}

/* ── sub-components ─────────────────────────────────────────────────────── */

function Stat({ icon, label, value, tint }: { icon: string; label: string; value: string; tint: string }) {
  return (
    <div className="flex items-center gap-3.5 bg-white border border-[#e5e7eb] rounded-2xl px-4 py-3.5 shadow-sm">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: `${tint}14`, color: tint }}>
        <span className="material-symbols-outlined text-[20px]">{icon}</span>
      </div>
      <div className="min-w-0">
        <div style={PJ} className="text-[22px] font-bold text-[#0f172a] leading-none tracking-[-0.02em]">{value}</div>
        <div className="text-[12px] text-[#94a3b8] mt-1 truncate">{label}</div>
      </div>
    </div>
  )
}

function SectionHead({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 style={PJ} className="text-[16px] font-bold text-[#0f172a] tracking-[-0.01em]">{title}</h2>
      <p className="text-[12.5px] text-[#94a3b8] mt-0.5">{hint}</p>
    </div>
  )
}

function InfoRow({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-l-2 border-[#dbe6e2] pl-3">
      <p style={PJ} className="text-[13px] font-semibold text-[#0f172a] mb-0.5">{title}</p>
      <p className="text-[12.5px] text-[#64748b] leading-[1.6]">{body}</p>
    </div>
  )
}

// Neutral placeholder for history rows whose brand is no longer in the org
// (e.g. legacy exports made with dummy brand ids before real-data wiring).
const FALLBACK_BRAND: DashBrand = {
  id: '', name: 'Brand', handle: '', initials: '—', color: '#94a3b8', followers: 0,
  platforms: [] as DashPlatform[],
}

function ReportCard({ record, orgId, brands }: { record: ReportRecord; orgId: string; brands: DashBrand[] }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const brand = brands.find(b => b.id === record.brandId) ?? brands[0] ?? FALLBACK_BRAND
  const template = getTemplate(record.templateId)
  const bgImage = record.coverImageUrl
    ? `url("${record.coverImageUrl}")`
    : `url("data:image/svg+xml;utf8,${encodeURIComponent(template.background(record.colors, record.mode))}")`
  const downloadUrl = `/api/organizations/${encodeURIComponent(orgId)}/reports/exports/${record.id}/download`

  async function handleDelete() {
    if (!confirm(`Delete "${record.title}"? This removes the saved file too.`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/organizations/${encodeURIComponent(orgId)}/reports/exports/${record.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`Delete failed (${res.status})`)
      router.refresh()
    } catch (e) {
      console.error(e)
      alert('Could not delete this report.')
      setDeleting(false)
    }
  }

  return (
    <div className="group rounded-2xl overflow-hidden border border-[#e5e7eb] bg-white hover:shadow-[0_6px_22px_rgba(15,23,42,0.10)] hover:border-[#d8dde3] transition-all">
      <a
        href={downloadUrl}
        className="block aspect-video relative"
        style={{
          backgroundImage: bgImage,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <span className="flex items-center gap-1.5 bg-white/95 text-[#1e4f49] text-[12px] font-bold px-3.5 py-2 rounded-lg shadow-sm" style={PJ}>
            <span className="material-symbols-outlined text-[16px]">download</span>
            Download
          </span>
        </div>
        <span className="absolute top-2.5 right-2.5 text-[10px] font-bold uppercase tracking-wide bg-white/90 text-[#64748b] px-2 py-0.5 rounded-md" style={PJ}>
          {template.name}
        </span>
        <button
          onClick={e => { e.preventDefault(); handleDelete() }}
          disabled={deleting}
          title="Delete report"
          className="absolute top-2.5 left-2.5 w-7 h-7 flex items-center justify-center rounded-md bg-white/90 text-[#94a3b8] hover:text-[#dc2626] hover:bg-white opacity-0 group-hover:opacity-100 transition disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">{deleting ? 'hourglass_empty' : 'delete'}</span>
        </button>
      </a>
      <div className="px-4 py-3.5">
        <p style={PJ} className="text-[13.5px] font-bold text-[#0f172a] leading-snug line-clamp-1">{record.name}</p>
        <p className="text-[11.5px] text-[#94a3b8] leading-snug line-clamp-1 mt-0.5">{record.title}</p>
        <div className="flex items-center gap-2 mt-2">
          <span className="w-5 h-5 rounded-md flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
            style={{ background: brand.color, ...PJ }}>
            {brand.initials}
          </span>
          <span className="text-[12px] text-[#64748b] truncate">{brand.name}</span>
          <span className="text-[#d1d5db]">·</span>
          <span className="text-[12px] text-[#94a3b8] flex-shrink-0">{record.month.slice(0, 3)} {record.year}</span>
        </div>
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#f1f3f5]">
          <span className="text-[11.5px] text-[#94a3b8]">{relativeDate(record.exportedAt)}</span>
          <span className="text-[11.5px] text-[#cbd5e1] font-medium">{(record.sizeKb / 1024).toFixed(1)} MB</span>
        </div>
      </div>
    </div>
  )
}
