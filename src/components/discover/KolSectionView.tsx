'use client'

/**
 * Renders one per-KOL section for the active creator, inside the workspace.
 *
 * Profile / Content Analytics / Analytics / Audience / Campaign History /
 * Brand Fit / AI Insights / Rate Card are children of the selected-creator node,
 * so each resolves "which creator?" from the active-KOL context rather than from
 * a route param. This component owns that fetch once, so the eight sections do
 * not each re-implement loading, error and empty-selection states.
 *
 * It also carries the flow forward: the action bar offers Compare, Add to
 * Campaign (which routes to the creator's Rate Card) and a shortcut into the
 * Cart, so the chain continues from whichever analysis view the user is on.
 *
 * With no creator selected it does not render an error — it explains what to do
 * and links back to Directory, because arriving here with nothing selected is a
 * normal first-visit state, not a fault.
 */

import { useEffect, useState } from 'react'
import { Btn, EmptyState, ErrorState, PJ, PLATFORM_ICON, RelationTag, Spinner, gradientFor } from './ui'
import { DataSourceStrip } from './credibility'
import {
  AudienceSection, CampaignSection, PerformanceSection, ProfileSection,
} from './DiscoverKolDetail'
import ContentAnalytics from './ContentAnalytics'
import { AiInsightsSection, BrandFitSection, KolReportSection } from './KolInsightSections'
import KolRateCard from './KolRateCard'
import { useDiscoverCart } from './useDiscoverCart'
import { useDiscoverSelection } from './useDiscoverSelection'
import type { ActiveKol } from './useActiveKol'
import type { AccountDetailPayload } from '@/lib/discover/account'
import type { KolProfile } from '@/lib/discover/profile'

export type KolSection =
  | 'profile' | 'content' | 'analytics' | 'audience'
  | 'campaignHistory' | 'brandfit' | 'ai' | 'kolreport' | 'ratecard'

export default function KolSectionView({
  orgId, orgSlug, kol, section, onGoToDirectory, onGoToCart, onGoToRateCard, onGoToCompare,
}: {
  orgId: string
  orgSlug: string
  kol: ActiveKol | null
  section: KolSection
  onGoToDirectory: () => void
  onGoToCart: () => void
  /** Continue the flow from any analysis view. */
  onGoToRateCard?: () => void
  onGoToCompare?: () => void
}) {
  const [data, setData] = useState<AccountDetailPayload | null>(null)
  const [profile, setProfile] = useState<KolProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cart = useDiscoverCart(orgId)
  const shortlist = useDiscoverSelection(orgId, 'compare')

  useEffect(() => {
    if (!kol) { setData(null); setProfile(null); return }
    let cancelled = false
    setData(null); setProfile(null); setError(null)

    fetch(`/api/organizations/${orgId}/discover/account/${kol.id}?relation=${kol.relation}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(
        r.status === 404 ? 'KOL ini tidak lagi terhubung ke organisasi.' : `HTTP ${r.status}`))))
      .then((d: AccountDetailPayload) => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })

    fetch(`/api/organizations/${orgId}/discover/profiles`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { profiles: KolProfile[] }) => {
        if (cancelled) return
        setProfile(d.profiles.find(p => p.account.id === kol.id && p.account.relation === kol.relation) ?? null)
      })
      .catch(() => { /* the measured sections still work without the enriched profile */ })

    return () => { cancelled = true }
  }, [orgId, kol])

  if (!kol) {
    return (
      <EmptyState
        icon="person_search"
        title="Belum ada KOL yang dipilih"
        body="Buka tab Directory dan pilih satu KOL. Pilihanmu diingat, jadi semua tab di baris ini langsung menampilkan datanya."
        action={<Btn variant="primary" onClick={onGoToDirectory}>
          <span className="material-symbols-outlined text-[15px]">badge</span>Buka Directory
        </Btn>}
      />
    )
  }

  if (error) return <ErrorState message={error} />
  if (!data) return <Spinner />

  const a = data.account
  const inShortlist = shortlist.ids.has(a.id)
  const unitsHere = cart.lines
    .filter(l => l.socialAccountId === a.id)
    .reduce((n, l) => n + l.qty, 0)
  return (
    <div>
      {/* Identity strip — which creator these numbers are about, on every tab. */}
      <div className="flex items-center gap-3 bg-white border border-[#e5e7eb] rounded-xl px-3.5 py-2.5 mb-3.5 flex-wrap">
        <div style={{ ...PJ, background: gradientFor(a.username) }}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[11px] font-extrabold">
          {a.username.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '??'}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span style={PJ} className="text-[13px] font-extrabold text-[#111827] truncate">{a.username}</span>
            <RelationTag relation={a.relation} />
          </div>
          <div className="flex items-center gap-1 text-[10.5px] text-[#9ca3af]">
            <span className="material-symbols-outlined text-[12px]">{PLATFORM_ICON[a.platform] ?? 'public'}</span>
            <span className="capitalize">{a.platform}</span>
            {a.brandName && <><span className="text-[#d1d5db]">·</span><span className="truncate">{a.brandName}</span></>}
          </div>
        </div>
        <div className="flex-1" />
        {profile && (
          <DataSourceStrip source={profile.dataSource} lastSyncAt={profile.lastSyncAt}
            confidence={profile.confidence} />
        )}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Btn size="sm" variant={inShortlist ? 'primary' : 'secondary'}
            onClick={() => { shortlist.toggle(a.id); if (!inShortlist) onGoToCompare?.() }}>
            <span className="material-symbols-outlined text-[14px]">compare</span>
            {inShortlist ? 'Di Compare' : 'Compare'}
          </Btn>
          {onGoToRateCard && section !== 'ratecard' && (
            <Btn size="sm" variant="primary" onClick={onGoToRateCard}>
              <span className="material-symbols-outlined text-[14px]">add_shopping_cart</span>
              Add to Campaign
            </Btn>
          )}
          {unitsHere > 0 && (
            <Btn size="sm" variant="secondary" onClick={onGoToCart}>
              <span className="material-symbols-outlined text-[14px]">shopping_cart</span>
              Cart ({unitsHere})
            </Btn>
          )}
          <Btn size="sm" variant="ghost" onClick={onGoToDirectory}>
            <span className="material-symbols-outlined text-[14px]">swap_horiz</span>Ganti KOL
          </Btn>
        </div>
      </div>

      {section === 'profile' && <ProfileSection data={data} />}
      {section === 'content' && <ContentAnalytics data={data} />}
      {section === 'analytics' && <PerformanceSection data={data} />}
      {section === 'audience' && <AudienceSection data={data} />}
      {section === 'campaignHistory' && <CampaignSection data={data} />}
      {section === 'brandfit' && (profile ? <BrandFitSection profile={profile} /> : <Spinner />)}
      {section === 'ai' && (profile ? <AiInsightsSection profile={profile} data={data} /> : <Spinner />)}
      {section === 'kolreport' && (profile ? <KolReportSection profile={profile} data={data} /> : <Spinner />)}
      {section === 'ratecard' && (profile
        ? <KolRateCard orgId={orgId} orgSlug={orgSlug} profile={profile} data={data} onGoToCart={onGoToCart} />
        : <Spinner />)}
    </div>
  )
}
