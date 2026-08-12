'use client'

/**
 * KOL Intelligence workspace.
 *
 * The module owns the whole decision chain — Discover → Find → Analyze →
 * Compare → Select → Plan → Execute → Monitor → Measure → Report — so every one
 * of those steps has to be a place you can navigate to, not just a place the
 * previous step happens to hand you to:
 *
 *   KOL Intelligence
 *   ├─ Directory                          sidebar — this module's starting page
 *   │   └─ [selected creator]             sidebar, once one is active
 *   │       └─ Profile · Performance · Content Analytics · Audience Insights
 *   │          Campaign History · Brand Fit · AI Insights · Individual Report
 *   │          Rate Card
 *   ├─ Compare                            sidebar
 *   ├─ Cart · Ordering Flow · Purchase History
 *   │                                     NOT sidebar — the cart bar in this
 *   │                                     header, because they are steps you
 *   │                                     fall into from a creator
 *   ├─ Discover Reports                   sidebar, own route (discover/reports)
 *   └─ Settings                           sidebar, own route (discover/settings)
 *
 * Only the tabbed parts live in this component. Discover Reports and Settings
 * appear under KOL Intelligence in the sidebar but are separate routes, so they
 * are not tabs here.
 *
 * Two things sit outside the module by design. Discovery Content is a sibling of
 * KOL Intelligence, not a child: browsing what is being posted feeds a brief but
 * is not a step in the ordering flow. Campaign Management moved to its own route
 * (discover/campaign-management), also a sibling — running a campaign you
 * already bought is a different job from choosing who to buy.
 *
 * There is no campaign-level Reports tab any more. Per-campaign numbers live on
 * the Campaign Dashboard, reached from Campaign Management.
 *
 * The nine analysis views belong to *one creator*, so they are children of the
 * selected-creator node — not siblings of Directory. The extra depth is carried
 * by a breadcrumb (KOL Intelligence › Directory › @creator › Profile) rather
 * than by stacking another row of tabs.
 *
 * `?tab=` stays a single flat value (directory, profile, cart, …) and the parent
 * module is derived from it. One param keeps links short, existing deep links
 * working, and makes "which module am I in" a pure function of the URL.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Btn, DiscoverHeader, PJ } from './ui'
import { useDiscoverSelection } from './useDiscoverSelection'
import { useDiscoverCart } from './useDiscoverCart'
import { useActiveKol } from './useActiveKol'
import DiscoverDirectoryView from './DiscoverDirectoryView'
import DiscoverCart from './DiscoverCart'
import CampaignBuilder from './CampaignBuilder'
import DiscoverCompare from './DiscoverCompare'
import OrdersWorkspace from './OrdersWorkspace'
import KolSectionView, { type KolSection } from './KolSectionView'

/* ── the module's stages ─────────────────────────────────────────────────── */

const MODULES = [
  { id: 'kol', label: 'Directory', icon: 'grid_view' },
  { id: 'compare', label: 'Compare', icon: 'compare' },
  { id: 'order', label: 'Cart & Order', icon: 'shopping_cart' },
] as const

type ModuleId = (typeof MODULES)[number]['id']

/**
 * Directory is the module's starting page; the rest are KOL Detail — views of
 * the one selected creator, which is why they are a separate node in the
 * breadcrumb rather than peers of Directory.
 */
const KOL_SECTIONS = [
  { id: 'directory', label: 'Directory', icon: 'grid_view', perKol: false },
  { id: 'profile', label: 'Profile', icon: 'person', perKol: true },
  { id: 'analytics', label: 'Performance', icon: 'insights', perKol: true },
  { id: 'content', label: 'Content Analytics', icon: 'summarize', perKol: true },
  { id: 'audience', label: 'Audience Insights', icon: 'group', perKol: true },
  { id: 'campaignHistory', label: 'Campaign History', icon: 'campaign', perKol: true },
  { id: 'brandfit', label: 'Brand Fit', icon: 'handshake', perKol: true },
  { id: 'ai', label: 'AI Insights', icon: 'auto_awesome', perKol: true },
  { id: 'kolreport', label: 'Individual Report', icon: 'lab_profile', perKol: true },
  { id: 'ratecard', label: 'Rate Card', icon: 'payments', perKol: true },
] as const

/** Cart → the three-step ordering flow → what you have already bought. */
const ORDER_SECTIONS = [
  { id: 'cart', label: 'Cart', icon: 'shopping_cart' },
  { id: 'ordering', label: 'Ordering Flow', icon: 'list_alt_check' },
  { id: 'orders', label: 'Purchase History', icon: 'receipt_long' },
] as const

type Tab =
  | (typeof KOL_SECTIONS)[number]['id']
  | (typeof ORDER_SECTIONS)[number]['id']
  | 'compare'

const ALL_IDS: string[] = [
  ...KOL_SECTIONS.map(s => s.id), ...ORDER_SECTIONS.map(s => s.id), 'compare',
]

/**
 * Earlier shapes of this screen called the ordering flow `checkout` and then
 * `planning`. Both still resolve, so links saved from either era keep working.
 */
const TAB_ALIASES: Record<string, Tab> = { checkout: 'ordering', planning: 'ordering' }

/** Which stage a tab belongs to — the source of truth for the breadcrumb. */
function moduleOf(tab: Tab): ModuleId {
  if (tab === 'compare') return 'compare'
  if ((ORDER_SECTIONS as readonly { id: string }[]).some(s => s.id === tab)) return 'order'
  return 'kol'
}

const SUBTITLE: Record<string, string> = {
  directory: 'Cari KOL dengan keyword, platform, kategori, followers, ER, lokasi, tier dan audience quality.',
  profile: 'Identitas dan KPI utama KOL aktif.',
  content: '10 post terakhir: reach, engagement, sentimen, topik, hashtag dan waktu posting.',
  analytics: 'Tren performa, format dan engagement rate KOL aktif.',
  audience: 'Komposisi dan respons audiens KOL aktif.',
  campaignHistory: 'Konten campaign dan boosted yang pernah dijalankan KOL aktif.',
  brandfit: 'Seberapa cocok KOL aktif untuk brand kamu, beserta dasar perhitungannya.',
  ai: 'Insight otomatis dari metrik KOL aktif.',
  kolreport: 'Laporan satu KOL yang bisa diekspor untuk kebutuhan internal atau klien.',
  compare: 'Bandingkan minimal dua KOL: followers, ER, audience quality, authenticity, reach dan brand fit.',
  ratecard: 'Harga, paket konten, estimasi reach dan syarat pemesanan.',
  cart: 'Kandidat campaign beserta rate card, deliverables dan subtotalnya.',
  orders: 'Riwayat pembelian: order berjalan dan order yang sudah ditutup.',
  ordering: 'Tiga langkah: Creator Selection & Rate Card → Campaign Information & Brief → Order Summary & Payment.',
}

const PAGE_TITLE: Record<string, string> = {
  directory: 'Directory',
  profile: 'Profile',
  content: 'Content Analytics',
  analytics: 'Analytics',
  audience: 'Audience Insights',
  campaignHistory: 'Campaign History',
  brandfit: 'Brand Fit',
  ai: 'AI Insights',
  compare: 'Compare',
  ratecard: 'Rate Card',
  cart: 'Cart & Campaign Order',
  orders: 'Purchase History',
  ordering: 'Ordering Flow',
}

const PER_KOL_SECTIONS: Record<string, KolSection> = {
  profile: 'profile', content: 'content', analytics: 'analytics', audience: 'audience',
  campaignHistory: 'campaignHistory', brandfit: 'brandfit', ai: 'ai',
  kolreport: 'kolreport', ratecard: 'ratecard',
}

export default function DiscoverKolWorkspace({
  orgId, orgSlug,
}: { orgId: string; orgSlug: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const shortlist = useDiscoverSelection(orgId, 'compare')
  const activeKol = useActiveKol(orgSlug)

  const raw = searchParams.get('tab')
  const tab = useMemo<Tab>(() => {
    if (!raw) return 'directory'
    if (TAB_ALIASES[raw]) return TAB_ALIASES[raw]
    return ALL_IDS.includes(raw) ? (raw as Tab) : 'directory'
  }, [raw])

  // Campaign Management moved out of this workspace onto its own route. Links
  // saved while it was `?tab=campaigns` are sent there rather than silently
  // dropped onto Directory, which is what the unknown-tab fallback would do.
  useEffect(() => {
    if (raw === 'campaigns') {
      router.replace(`/organizations/${orgSlug}/discover/campaign-management`)
    }
  }, [raw, router, orgSlug])

  /**
   * Campaign context handed over by the Cart when it enters the ordering flow.
   * Held in state rather than in the URL because the workspace stays mounted
   * across a tab change, and because once the flow writes it into the persisted
   * draft the URL copy would only go stale.
   */
  const [checkoutSeed, setCheckoutSeed] =
    useState<{ objective?: string; name?: string; promoCode?: string } | undefined>(undefined)

  const activeModule = moduleOf(tab)
  /** Inside the selected-creator node rather than at the Directory level. */
  const inCreator = (KOL_SECTIONS as readonly { id: string; perKol: boolean }[])
    .some(s => s.id === tab && s.perKol)

  const go = useCallback((next: Tab) => {
    router.push(
      `/organizations/${orgSlug}/discover/kol${next === 'directory' ? '' : `?tab=${next}`}`,
      { scroll: false },
    )
  }, [router, orgSlug])

  const kolName = activeKol.ready ? activeKol.kol?.username : undefined

  const crumbs = useMemo(() => {
    const out: { label: string; href?: () => void }[] = [{ label: 'KOL Intelligence' }]
    if (activeModule === 'kol') {
      out.push({ label: 'Directory', href: tab === 'directory' ? undefined : () => go('directory') })
      // KOL Detail is a node of its own: the creator, then the section of them.
      if (inCreator && kolName) out.push({ label: kolName })
    } else if (activeModule === 'order') {
      out.push({ label: 'Cart & Order', href: tab === 'cart' ? undefined : () => go('cart') })
    } else {
      const m = MODULES.find(x => x.id === activeModule)
      if (m) out.push({ label: m.label })
    }
    if (PAGE_TITLE[tab] && out[out.length - 1].label !== PAGE_TITLE[tab]) {
      out.push({ label: PAGE_TITLE[tab] })
    }
    return out
  }, [activeModule, inCreator, tab, kolName, go])

  return (
    <div className="p-5 max-w-[1500px] mx-auto">
      {/* Breadcrumb, not navigation — the sidebar does the navigating. It exists
          so the content area still states where you are. */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 flex-wrap mb-1">
        {crumbs.map((c, i) => (
          <span key={c.label} className="inline-flex items-center gap-1">
            {i > 0 && <span className="material-symbols-outlined text-[13px] text-[#d1d5db]">chevron_right</span>}
            {c.href ? (
              <button type="button" onClick={c.href} style={PJ}
                className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af] hover:text-[#285D6E] hover:underline">
                {c.label}
              </button>
            ) : (
              <span style={PJ} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af]">
                {c.label}
              </span>
            )}
          </span>
        ))}
      </nav>

      <DiscoverHeader
        title={PAGE_TITLE[tab] ?? 'KOL Intelligence'}
        subtitle={SUBTITLE[tab] ?? ''}
        actions={<CartBar orgId={orgId} tab={tab} go={go} />}
      />

      <div>
        {tab === 'directory' && (
          <DiscoverDirectoryView
            orgId={orgId}
            orgSlug={orgSlug}
            onSelectKol={(id, relation, username) => {
              activeKol.select({ id, relation, username })
              go('profile')
            }}
            onOrderKol={(id, relation, username) => {
              // Straight from the card into that creator's Rate Card, which is
              // where packages are priced and added to the cart.
              activeKol.select({ id, relation, username })
              go('ratecard')
            }}
            onAddToCampaign={ids => {
              ids.forEach(id => { if (!shortlist.ids.has(id)) shortlist.toggle(id) })
              go('ordering')
            }}
          />
        )}

        {PER_KOL_SECTIONS[tab] && (
          <KolSectionView
            orgId={orgId}
            orgSlug={orgSlug}
            kol={activeKol.ready ? activeKol.kol : null}
            section={PER_KOL_SECTIONS[tab]}
            onGoToDirectory={() => go('directory')}
            onGoToCart={() => go('cart')}
            onGoToRateCard={() => go('ratecard')}
            onGoToCompare={() => go('compare')}
          />
        )}

        {tab === 'compare' && (
          <DiscoverCompare orgId={orgId} orgSlug={orgSlug} embedded
            onGoToPlanning={() => go('ordering')} />
        )}

        {tab === 'cart' && (
          <DiscoverCart
            orgId={orgId}
            onGoToRates={() => go('ratecard')}
            onCheckout={ctx => {
              // Carry what the cart just asked for into the flow, instead of
              // asking for it again on the next screen — or losing it.
              setCheckoutSeed(ctx)
              go('ordering')
            }}
          />
        )}

        {tab === 'orders' && (
          <OrdersWorkspace orgId={orgId} orgSlug={orgSlug} onGoToCart={() => go('cart')} />
        )}

        {tab === 'ordering' && (
          <CampaignBuilder
            orgId={orgId}
            orgSlug={orgSlug}
            seed={checkoutSeed}
            onGoToRates={() => go('ratecard')}
            onGoToCart={() => go('cart')}
            onGoToDirectory={() => go('directory')}
          />
        )}

      </div>
    </div>
  )
}

/**
 * The cart flow, as an affordance rather than a nav branch.
 *
 * Cart, Ordering Flow and Purchase History used to be sidebar entries, which
 * advertised an empty cart as somewhere to go. They are steps you fall into from
 * a creator instead — so they live here, next to the page title, present on
 * every screen of the module and carrying the count that makes them worth
 * pressing. Cart and Ordering Flow appear once there is something in the cart;
 * Purchase History is always there, because looking up a past order does not
 * depend on having a live one.
 */
function CartBar({
  orgId, tab, go,
}: { orgId: string; tab: Tab; go: (t: Tab) => void }) {
  const cart = useDiscoverCart(orgId)
  if (!cart.ready) return null

  const has = cart.totalUnits > 0
  return (
    <>
      {has && tab !== 'cart' && (
        <Btn size="sm" variant="secondary" onClick={() => go('cart')}>
          <span className="material-symbols-outlined text-[15px]">shopping_cart</span>
          Cart
          <span style={PJ}
            className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[#285D6E] text-white text-[9px] font-extrabold tabular-nums">
            {cart.totalUnits}
          </span>
        </Btn>
      )}
      {has && tab !== 'ordering' && (
        <Btn size="sm" variant="primary" onClick={() => go('ordering')}>
          <span className="material-symbols-outlined text-[15px]">list_alt_check</span>
          Ordering Flow
        </Btn>
      )}
      {tab !== 'orders' && (
        <Btn size="sm" variant="ghost" onClick={() => go('orders')}>
          <span className="material-symbols-outlined text-[15px]">receipt_long</span>
          Purchase History
        </Btn>
      )}
    </>
  )
}
