'use client'

/**
 * Creator Intelligence Workspace — what a creator card in the KOL Directory
 * opens into.
 *
 * The shell: a back link, the identity header, the KPI strip, the tab row, and
 * a sticky action bar. Overview lives in `KolCreatorOverview`; the other six
 * tabs in `KolCreatorSections`.
 *
 * The page keeps one rhythm throughout — data at 65% on the left, its reading at
 * 35% on the right (see `Split` in `kolViz`) — so cards are never a uniform grid
 * of equal boxes. Card size is the hierarchy: KPI tiles small, charts and tables
 * large, scores and interpretations narrow beside them.
 *
 * ── What is real and what is not ─────────────────────────────────────────────
 * The commercial roster (`public.kol_directory`) stores identity only. Real
 * here: username, platform, profile URL, avatar, bio, followers, engagement
 * rate, category, tier, verified, last refresh — plus what the API computes from
 * the roster: rank by followers, rank inside the creator's category, rank by
 * engagement rate among measured rows, the sibling account on the other
 * platform, and the Similar Creators row.
 *
 * Everything else the brief asks for — reach, views, EMV, growth, audience
 * demographics, content, campaigns, brand fit, AI insights — has no source at
 * all, so it comes from `@/lib/discover/kolSample` and is marked at every figure.
 * The banner states it once; `<SampleTag />` repeats it beside each number so a
 * screenshot of any single card still carries the caveat.
 */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PJ, TOKENS as T, PLATFORM_ICON, Spinner, fmtNum } from './ui'
import { SampleBanner, SampleTag, StatTile, VIZ } from './kolViz'
import OverviewSection from './KolCreatorOverview'
import {
  AiSection, AudienceSection, BrandFitSection, CampaignSection, PerformanceSection,
  ReportSection, platformLabel, type SectionProps,
} from './KolCreatorSections'
import { sampleIntel } from '@/lib/discover/kolSample'
import type { KolCreatorPayload } from '@/lib/discover/kolDirectory'

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'dashboard' },
  { id: 'performance', label: 'Performance', icon: 'insights' },
  { id: 'audience', label: 'Audience Insights', icon: 'group' },
  { id: 'campaigns', label: 'Campaign History', icon: 'campaign' },
  { id: 'brandfit', label: 'Brand Fit', icon: 'handshake' },
  { id: 'ai', label: 'AI Insights', icon: 'auto_awesome' },
  { id: 'report', label: 'Report', icon: 'lab_profile' },
] as const

type TabId = (typeof TABS)[number]['id']

const initialsOf = (u: string) => (u.replace(/[^a-z0-9]/gi, '').slice(0, 2) || '?').toUpperCase()

export default function KolCreatorWorkspace({
  orgId, orgSlug, kolId,
}: { orgId: string; orgSlug: string; kolId: string }) {
  const router = useRouter()
  const [data, setData] = useState<KolCreatorPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('overview')
  const [fav, setFav] = useState(false)
  const [inCampaign, setInCampaign] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setData(null)
    // Landing on a creator from Similar Creators should start at the top of
    // their page, not wherever the previous creator was being read.
    setTab('overview')
    fetch(`/api/organizations/${orgId}/discover/kol-directory/${kolId}`)
      .then(async r => {
        if (r.ok) return r.json()
        const body = await r.json().catch(() => null)
        throw new Error(body?.detail || body?.error || `HTTP ${r.status}`)
      })
      .then((d: KolCreatorPayload) => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(String(e?.message ?? e)) })
    return () => { cancelled = true }
  }, [orgId, kolId])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(t)
  }, [toast])

  /**
   * Seeded from the creator id, so the sampled figures are identical on every
   * render and every reload — placeholder numbers that reshuffle themselves make
   * the screen obviously fake and the screenshots irreproducible.
   */
  const intel = useMemo(() => (data ? sampleIntel(data.creator) : null), [data])

  const backToDirectory = () => router.push(`/organizations/${orgSlug}/discover/kol`)

  if (error) {
    return (
      <div className="p-5 max-w-[1360px] mx-auto">
        <div className="rounded-[16px] border p-8 text-center" style={{ borderColor: T.outline }}>
          <span className="material-symbols-outlined text-[34px]" style={{ color: '#e6b8b8' }}>error</span>
          <p style={{ ...PJ, color: T.t1 }} className="text-[13px] font-extrabold mt-2">Creator gagal dimuat</p>
          <p className="text-[11.5px] mt-1" style={{ color: T.t3 }}>{error}</p>
          <button type="button" onClick={backToDirectory} style={{ ...PJ, color: T.primary }}
            className="text-[11.5px] font-bold mt-3 hover:underline">
            Kembali ke Directory
          </button>
        </div>
      </div>
    )
  }

  if (!data || !intel) return <div className="p-5"><Spinner label="Memuat creator…" /></div>

  const { creator, rank, platforms, similar } = data
  const sectionProps: SectionProps = { creator, rank, platforms, similar, intel }
  const estReach = creator.followers !== null && creator.erPct !== null
    ? Math.round((creator.followers * creator.erPct) / 100)
    : null

  const addToCampaign = () => {
    setInCampaign(true)
    setToast(`@${creator.username} ditambahkan ke campaign`)
  }

  return (
    <div className="p-5 pb-24 max-w-[1360px] mx-auto">
      {/* Back first, breadcrumb second: leaving is the more common intent. */}
      <button type="button" onClick={backToDirectory} style={{ ...PJ, color: T.primary }}
        className="inline-flex items-center gap-1 text-[11.5px] font-bold hover:underline mb-2">
        <span className="material-symbols-outlined text-[16px]">arrow_back</span>
        Back to Directory
      </button>

      <nav aria-label="Breadcrumb" className="flex items-center gap-1 flex-wrap mb-3">
        {['KOL Intelligence', 'Directory', `@${creator.username}`].map((label, i) => (
          <span key={label} className="inline-flex items-center gap-1">
            {i > 0 && <span className="material-symbols-outlined text-[13px]" style={{ color: T.outline }}>chevron_right</span>}
            <span style={{ ...PJ, color: T.t4 }} className="text-[10.5px] font-bold uppercase tracking-widest">
              {label}
            </span>
          </span>
        ))}
      </nav>

      <SampleBanner>
        Database KOL hanya menyimpan identitas roster. <b>Followers, engagement rate,
        est. reach, peringkat, perbandingan platform dan Similar Creators di halaman
        ini adalah data asli.</b> Angka lain yang bertanda <SampleTag compact /> adalah
        contoh untuk memperlihatkan bentuk halamannya, bukan hasil pengukuran.
      </SampleBanner>

      {/* ── header ── */}
      <div className="rounded-[18px] border overflow-hidden mb-4"
        style={{ borderColor: T.outline, background: VIZ.surface }}>
        <div className="h-[76px]" style={{ background: T.gradient }} />
        <div className="px-4 pb-4 -mt-9">
          <div className="flex items-end gap-3.5 flex-wrap">
            <div className="w-20 h-20 rounded-[20px] border-[3px] flex-shrink-0 overflow-hidden flex items-center justify-center"
              style={{ borderColor: VIZ.surface, background: T.gradient }}>
              {creator.avatarUrl
                // eslint-disable-next-line @next/next/no-img-element -- roster avatars come from CDNs not in next.config
                ? <img src={creator.avatarUrl} alt="" className="w-full h-full object-cover" />
                : <span style={PJ} className="text-white text-[24px] font-extrabold">
                    {initialsOf(creator.username)}
                  </span>}
            </div>

            <div className="flex-1 min-w-[240px] pb-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                {/* The roster has no display-name column — the handle is the name. */}
                <h1 style={{ ...PJ, color: T.t1 }} className="text-[20px] font-extrabold tracking-[-0.02em]">
                  @{creator.username}
                </h1>
                {creator.verified && (
                  <span style={{ ...PJ, background: '#eaf5ef', color: '#3d8a5f' }}
                    className="inline-flex items-center gap-1 text-[9.5px] font-extrabold px-2 py-0.5 rounded-full">
                    <span className="material-symbols-outlined text-[12px]">verified</span>Verified
                  </span>
                )}
                {creator.tier && (
                  <span style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}
                    className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full">
                    {creator.tier}
                  </span>
                )}
                <span style={{ ...PJ, background: '#fdf3e7', color: '#b5761f' }}
                  className="inline-flex items-center gap-1 text-[9.5px] font-extrabold px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#b5761f' }} />
                  Available
                  <SampleTag compact />
                </span>
              </div>

              <div className="text-[11.5px] mt-1" style={{ color: T.t3 }}>
                {creator.categories.length ? creator.categories.join(' · ') : 'Kategori belum diisi di roster'}
              </div>
              <div className="text-[11.5px]" style={{ color: T.t4 }}>
                {creator.city || 'Lokasi belum diisi di roster'}
              </div>

              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {platforms.map(p => (
                  <a key={p.id} href={p.profileUrl ?? undefined} target="_blank" rel="noopener noreferrer"
                    style={{ ...PJ, borderColor: T.outline, color: T.t2 }}
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-[11px] font-bold hover:bg-[#f9fafb]">
                    <span className="material-symbols-outlined text-[14px]" style={{ color: T.primary }}>
                      {PLATFORM_ICON[p.platform ?? ''] ?? 'public'}
                    </span>
                    {platformLabel(p.platform)}
                    <span style={{ color: T.t4 }} className="tabular-nums">
                      {p.followers === null ? '—' : fmtNum(p.followers)}
                    </span>
                  </a>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap pb-0.5">
              <ActionBtn icon={fav ? 'favorite' : 'favorite_border'} label="Favorite"
                on={fav}
                onClick={() => { setFav(f => !f); setToast(fav ? 'Dihapus dari favorit' : 'Ditambahkan ke favorit') }} />
              <ActionBtn icon="compare" label="Compare" onClick={() => setToast('Ditambahkan ke compare')} />
              {/* Primary: choosing a creator for a campaign is what Directory is for. */}
              <ActionBtn icon="add" label="Add to Campaign" primary onClick={addToCampaign} />
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div className="grid gap-2.5 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
        <StatTile label="Followers"
          value={creator.followers === null ? '—' : fmtNum(creator.followers)}
          hint={`#${rank.followersRank.toLocaleString('id-ID')} dari ${rank.rosterTotal.toLocaleString('id-ID')}`} />
        <StatTile label="Engagement Rate"
          value={creator.erPct === null ? 'belum diukur' : `${creator.erPct.toFixed(2)}%`}
          hint={rank.erRank === null
            ? 'tidak masuk peringkat'
            : `#${rank.erRank.toLocaleString('id-ID')} dari ${rank.erMeasuredTotal.toLocaleString('id-ID')} terukur`} />
        <StatTile label="Est. Reach"
          value={estReach === null ? '—' : fmtNum(estReach)} hint="followers × ER" />
        <StatTile label="Views" value={fmtNum(intel.kpi.avgViews)} delta={intel.kpi.delta.views} sample />
        <StatTile label="EMV" value={`$${fmtNum(intel.kpi.emvUsd)}`} delta={intel.kpi.delta.emv} sample />
      </div>

      {/* ── tabs ── */}
      <div className="flex gap-1 flex-wrap mb-4" style={{ borderBottom: `1px solid ${T.outline}` }}>
        {TABS.map(t => {
          const on = tab === t.id
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              style={{
                ...PJ,
                color: on ? T.primaryDeep : T.t3,
                // The active tab is marked by a rule under it, not a filled pill:
                // the row reads as one strip that way, and the rule points at the
                // content it belongs to.
                borderBottom: `2px solid ${on ? T.primary : 'transparent'}`,
                marginBottom: -1,
              }}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-[11.5px] font-bold">
              <span className="material-symbols-outlined text-[15px]">{t.icon}</span>
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'overview' && <OverviewSection {...sectionProps} onGoTo={setTab} orgSlug={orgSlug} />}
      {tab === 'performance' && <PerformanceSection {...sectionProps} />}
      {tab === 'audience' && <AudienceSection {...sectionProps} />}
      {tab === 'campaigns' && <CampaignSection {...sectionProps} />}
      {tab === 'brandfit' && <BrandFitSection {...sectionProps} />}
      {tab === 'ai' && <AiSection {...sectionProps} />}
      {tab === 'report' && <ReportSection {...sectionProps} />}

      {/**
        * Sticky actions. The page is seven rows long, and the decision it exists
        * to support — take this creator — is usually made somewhere in the
        * middle. Scrolling back to the header to act on it is the friction this
        * removes.
        */}
      <div className="fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-2xl border px-2 py-2"
        style={{ background: VIZ.surface, borderColor: T.outline, boxShadow: T.shadowMd }}>
        <span className="hidden sm:flex flex-col pl-1.5 pr-1">
          <span style={{ ...PJ, color: T.t1 }} className="text-[11px] font-extrabold leading-tight">
            @{creator.username}
          </span>
          <span className="text-[9.5px]" style={{ color: inCampaign ? '#3d8a5f' : T.t4 }}>
            {inCampaign ? '✓ Ditambahkan' : creator.tier ?? 'creator'}
          </span>
        </span>
        <ActionBtn icon={fav ? 'favorite' : 'favorite_border'} on={fav}
          onClick={() => { setFav(f => !f); setToast(fav ? 'Dihapus dari favorit' : 'Ditambahkan ke favorit') }} />
        <ActionBtn icon="compare" label="Compare" onClick={() => setToast('Ditambahkan ke compare')} />
        <ActionBtn icon="add" label="Add to Campaign" primary onClick={addToCampaign} />
      </div>

      {toast && (
        <div style={{ ...PJ, background: T.primaryDeep }}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 text-white text-[11.5px] font-bold px-3.5 py-2 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  )
}

function ActionBtn({
  icon, label, onClick, primary, on,
}: { icon: string; label?: string; onClick: () => void; primary?: boolean; on?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={label ?? icon}
      style={{
        ...PJ,
        background: primary ? T.primary : on ? T.surfaceVariant : VIZ.surface,
        borderColor: primary ? T.primary : on ? T.primary : T.outline,
        color: primary ? '#fff' : on ? T.primaryDeep : T.t2,
      }}
      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[11.5px] font-bold hover:brightness-[.98]">
      <span className="material-symbols-outlined text-[15px]">{icon}</span>
      {label && <span className={label === 'Favorite' ? 'hidden md:inline' : ''}>{label}</span>}
    </button>
  )
}
