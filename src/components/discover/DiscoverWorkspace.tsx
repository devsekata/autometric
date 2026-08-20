'use client'

/**
 * Discover — the whole module on one route, driven by the sidebar.
 *
 * This replaces `DiscoverKolWorkspace` and the eight standalone Discover routes
 * that sat beside it. The old shape nested the module's own submenu three levels
 * deep and split the rest across separate pages; reaching Settings from a creator's
 * Rate Card meant collapsing one branch and expanding another. Everything is now a
 * sibling: eleven entries, one click apart, one URL shape.
 *
 * The sidebar navigates between them — Discover is a branch of eleven, the same
 * shape as Dashboard (see `@/lib/organizations/nav`, which derives those entries
 * from the tab registry). This component draws no strip of its own for them: two
 * rows of the same eleven destinations, one in the sidebar and one across the top,
 * competed for the same job and the horizontal one scrolled sideways on a laptop.
 *
 *   Discover  ?tab=…                       ← sidebar branch
 *   ├─ Directory        &view=roster | tracked — the commercial roster and the
 *   │    └─ &view=…       accounts this org tracks; then the seven per-creator
 *   │                     views, once a tracked account is opened
 *   ├─ Compare
 *   ├─ Reports          &view=discover | workspace
 *   ├─ Negotiation      offers, chat, agreement terms
 *   ├─ Ordering         &view=ratecards | cart | orders
 *   │    └─ ordering      the three checkout steps, inside the Cart segment
 *   ├─ Settings         &view=discover | workspace
 *   └─ Campaign · Content · Audience · AI Assistant
 *
 * That is the source platform's own order — `NAVK` in its `core/layout.js`, then
 * the entries its sidebar hangs beside that branch.
 *
 * The registry in `@/lib/discover/tabs` owns the list, the labels, the URL
 * aliases and the header copy. This component owns only the rendering: which
 * strip is showing, what the breadcrumb says, and which subtree is mounted.
 *
 * Detail pages stay separate routes and are not tabs — a creator from the
 * commercial roster (`discover/kol-directory/[kolId]`), an order
 * (`discover/kol/orders/[orderId]`) and a campaign dashboard
 * (`discover/kol/campaigns/[orderId]`). Those are things you open, not places
 * you switch to, and each carries its own way back.
 */

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { findTab, shown, tabHeading, tabHref, visibleViews } from '@/lib/discover/tabs'
import { Btn, DiscoverHeader, PJ, Spinner, TabStrip } from './ui'
import { useDiscoverSelection } from './useDiscoverSelection'
import { useDiscoverCart } from './useDiscoverCart'
import { useActiveKol } from './useActiveKol'
import DiscoverDirectoryView from './DiscoverDirectoryView'
import KolDirectoryPage from './KolDirectoryPage'
import DiscoverCart from './DiscoverCart'
import DiscoverRates from './DiscoverRates'
import CampaignBuilder from './CampaignBuilder'
import DiscoverCompare from './DiscoverCompare'
import OrdersWorkspace from './OrdersWorkspace'
import KolSectionView, { type KolSection } from './KolSectionView'
import DiscoverContent from './DiscoverContent'
import CampaignsWorkspace from './CampaignsWorkspace'
import DiscoverAssistant from './DiscoverAssistant'
import { DiscoverAudience, DiscoverReports } from './DiscoverAnalytics'
import DiscoverSettings from './DiscoverSettings'
import WorkspaceReports from './WorkspaceReports'
import WorkspaceSettings, { type WorkspaceSettingsData } from './WorkspaceSettings'
import NegotiationWorkspace from './NegotiationWorkspace'

/**
 * Per-creator `view` ids under Directory, mapped onto `KolSectionView`'s
 * sections. A `view` that is not in here is a roster, not a creator — which is
 * how `creatorSection` below tells the two apart.
 */
const PER_KOL_SECTIONS: Record<string, KolSection> = {
  profile: 'profile', content: 'content', analytics: 'analytics', audience: 'audience',
  brandcamp: 'brandcamp', ai: 'ai', kolreport: 'kolreport', ratecard: 'ratecard',
}

/**
 * Which segment stays lit while a hidden view is showing. The ordering flow is
 * the source's three checkout steps, which it draws inside the Cart segment
 * rather than beside it, so Cart stays selected for the whole flow.
 */
const STRIP_ANCHOR: Record<string, string> = { ordering: 'cart' }

export interface DiscoverWorkspaceProps {
  orgId: string
  orgSlug: string
  /**
   * The resolved pair, from the server. Not read from `useSearchParams` here on
   * purpose: the page already resolves it (it has to, to decide whether to fetch
   * the settings payload), and taking it as a prop means the heading, breadcrumb
   * and sub-strip render on the server instead of after hydration. A tab change is
   * a navigation, so Next re-renders the page and these arrive updated.
   */
  tab: string
  view: string | null
  /**
   * Read on the server for the Workspace half of Settings — members, tracked
   * platforms, whether payment and AI keys are configured. Null on every other
   * tab: the page only pays for it when that tab is the one being asked for.
   */
  workspaceSettings: WorkspaceSettingsData | null
}

export default function DiscoverWorkspace({
  orgId, orgSlug, tab, view, workspaceSettings,
}: DiscoverWorkspaceProps) {
  const router = useRouter()
  const shortlist = useDiscoverSelection(orgId, 'compare')
  const activeKol = useActiveKol(orgSlug)

  const def = findTab(tab)

  /**
   * Campaign context handed over by the Cart when it enters the ordering flow.
   * Held in state rather than in the URL because the workspace stays mounted
   * across a tab change, and because once the flow writes it into the persisted
   * draft the URL copy would only go stale.
   */
  const [checkoutSeed, setCheckoutSeed] =
    useState<{ objective?: string; name?: string; promoCode?: string } | undefined>(undefined)

  const go = useCallback((nextTab: string, nextView?: string | null) => {
    router.push(tabHref(orgSlug, nextTab, nextView), { scroll: false })
  }, [router, orgSlug])

  const kolName = activeKol.ready ? activeKol.kol?.username : undefined
  const creatorSection = tab === 'directory' && view ? PER_KOL_SECTIONS[view] : undefined
  /** A per-creator view with nothing selected is the list, not an empty shell. */
  const inCreator = !!creatorSection && !!activeKol.kol

  /* ── the sub-strip, for tabs that hold more than one screen ───────────── */

  /**
   * `__list` is the roster itself, sitting first among the creator's sections.
   *
   * Without it the strip has no entry for where you actually are while browsing
   * the list, so it would highlight Profile over a screen showing every account —
   * and there would be no way back to the list from inside a creator except the
   * breadcrumb.
   */
  const LIST_VIEW = { id: '__list', label: 'Daftar akun', icon: 'list' }

  const subTabs = useMemo(() => {
    if (!def) return null
    // Inside a creator, the creator's own sections replace the roster strip —
    // the same swap the source makes when a card opens `V.detail`.
    if (creatorSection && activeKol.kol) return [LIST_VIEW, ...shown(def.creatorViews)]
    if (def.views?.length) return visibleViews(def)
    return null
  }, [def, creatorSection, activeKol.kol])

  const heading = tabHeading(tab, inCreator || def?.views?.length ? view : null)

  const crumbs = useMemo(() => {
    const out: { label: string; href?: () => void }[] = [{ label: 'Discover' }]
    if (!def) return out
    out.push({
      label: def.label,
      // Back out to the list this view hangs off: the tracked roster when we are
      // inside a creator, otherwise the tab's first segment.
      href: view
        ? () => go(def.id, inCreator ? 'tracked' : visibleViews(def)[0]?.id)
        : undefined,
    })
    if (inCreator && kolName) out.push({ label: kolName })
    const active = [...(def.views ?? []), ...(def.creatorViews ?? [])].find(v => v.id === view)
    if (active && (inCreator || def.views?.length)) out.push({ label: active.label })
    return out
  }, [def, view, inCreator, kolName, go])

  return (
    <div className="p-5 max-w-[1500px] mx-auto">
      {/* Breadcrumb, not navigation — the sidebar does the navigating. It exists
          so the panel still states where you are, and so the way back out of a
          creator is a click and not the browser button. */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 flex-wrap mb-1">
        {crumbs.map((c, i) => (
          <span key={`${c.label}-${i}`} className="inline-flex items-center gap-1">
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

      {/* Tabs whose component brings its own header keep it — those headers
          carry the page's own actions, and a second title above them would be
          two headings for one screen. */}
      {!def?.ownsHeader && (
        <DiscoverHeader
          title={heading.title}
          subtitle={heading.subtitle ?? ''}
          actions={<CartBar orgId={orgId} tab={tab} view={view} go={go} />}
        />
      )}

      {subTabs && (
        <div className="mb-4">
          {/* Name the creator whose sections these are, so nine analysis views
              in a row are not ambiguous about whose numbers they show. */}
          {inCreator && kolName && (
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4E96AC] flex-shrink-0" />
              <span style={PJ} className="text-[10px] font-bold uppercase tracking-wider text-[#9ca3af] truncate">
                {kolName}
              </span>
            </div>
          )}
          <TabStrip
            tabs={subTabs}
            // An always-visible strip has one of its own selected; the creator
            // strip falls back to the roster, which is `__list` and sits first.
            value={
              // A hidden view keeps its segment lit rather than clearing the
              // strip; anything else selects itself, and a tab landing on its
              // roster falls back to the first segment.
              (view && STRIP_ANCHOR[view])
              ?? (view && (def?.views?.length || inCreator) ? view : subTabs[0].id)
            }
            onChange={next => go(tab, next === LIST_VIEW.id ? 'tracked' : next)}
          />
        </div>
      )}

      <div>
        {/* Roster is the landing segment, so it also answers a bare `?tab=` with
            no `view` — a link that predates the two rosters becoming one tab. */}
        {tab === 'directory' && !creatorSection && view !== 'tracked' && (
          <KolDirectoryPage orgId={orgId} orgSlug={orgSlug} embedded />
        )}

        {tab === 'directory' && !creatorSection && view === 'tracked' && (
          <DiscoverDirectoryView
            orgId={orgId}
            orgSlug={orgSlug}
            onSelectKol={(id, relation, username) => {
              activeKol.select({ id, relation, username })
              go('directory', 'profile')
            }}
            onOrderKol={(id, relation, username) => {
              // Straight from the card into that creator's Rate Card, which is
              // where packages are priced and added to the cart.
              activeKol.select({ id, relation, username })
              go('directory', 'ratecard')
            }}
            onAddToCampaign={ids => {
              ids.forEach(id => { if (!shortlist.ids.has(id)) shortlist.toggle(id) })
              go('order', 'ordering')
            }}
          />
        )}

        {tab === 'directory' && creatorSection && (
          <KolSectionView
            orgId={orgId}
            orgSlug={orgSlug}
            kol={activeKol.ready ? activeKol.kol : null}
            section={creatorSection}
            onGoToDirectory={() => go('directory', 'tracked')}
            onGoToCart={() => go('order', 'cart')}
            onGoToRateCard={() => go('directory', 'ratecard')}
            onGoToCompare={() => go('compare')}
          />
        )}

        {tab === 'compare' && (
          <DiscoverCompare orgId={orgId} orgSlug={orgSlug} embedded
            onGoToPlanning={() => go('order', 'ordering')} />
        )}

        {tab === 'negotiation' && (
          <NegotiationWorkspace
            orgId={orgId}
            onGoToCart={() => go('order', 'cart')}
            onGoToDirectory={() => go('directory', 'roster')}
          />
        )}

        {tab === 'order' && view === 'ratecards' && (
          <DiscoverRates
            orgId={orgId}
            onNegotiate={() => go('negotiation')}
            onOpenCreator={a => {
              activeKol.select({ id: a.id, relation: a.relation, username: a.username })
              go('directory', 'ratecard')
            }}
          />
        )}

        {tab === 'order' && view === 'cart' && (
          <DiscoverCart
            orgId={orgId}
            onGoToRates={() => go('order', 'ratecards')}
            onCheckout={ctx => {
              // Carry what the cart just asked for into the flow, instead of
              // asking for it again on the next screen — or losing it.
              setCheckoutSeed(ctx)
              go('order', 'ordering')
            }}
          />
        )}

        {tab === 'order' && view === 'ordering' && (
          <CampaignBuilder
            orgId={orgId}
            orgSlug={orgSlug}
            seed={checkoutSeed}
            onGoToRates={() => go('order', 'ratecards')}
            onGoToCart={() => go('order', 'cart')}
            onGoToDirectory={() => go('directory', 'tracked')}
          />
        )}

        {tab === 'order' && view === 'orders' && (
          <OrdersWorkspace orgId={orgId} orgSlug={orgSlug} onGoToCart={() => go('order', 'cart')} />
        )}

        {tab === 'discovery' && <DiscoverContent orgId={orgId} orgSlug={orgSlug} embedded />}
        {tab === 'campaign' && <CampaignsWorkspace orgId={orgId} orgSlug={orgSlug} embedded />}
        {tab === 'audience' && <DiscoverAudience orgId={orgId} embedded />}
        {tab === 'assistant' && <DiscoverAssistant orgId={orgId} embedded />}

        {tab === 'reports' && view === 'discover' && <DiscoverReports orgId={orgId} embedded />}
        {tab === 'reports' && view === 'workspace' && (
          <WorkspaceReports orgId={orgId} orgSlug={orgSlug} embedded />
        )}

        {tab === 'settings' && view === 'discover' && (
          <DiscoverSettings orgId={orgId} orgSlug={orgSlug} embedded />
        )}
        {tab === 'settings' && view === 'workspace' && (
          workspaceSettings
            ? <WorkspaceSettings data={workspaceSettings} orgSlug={orgSlug} embedded />
            // The payload comes with the page, so this only shows if the server
            // resolved a different tab than the one being rendered.
            : <Spinner />
        )}
      </div>
    </div>
  )
}

/**
 * The cart flow, as an affordance rather than a tab.
 *
 * Cart & Order is a tab now, but its count is what makes it worth pressing, and
 * a tab strip has nowhere to put a count. So the header keeps the badge and the
 * shortcut into the flow: Cart and Ordering Flow appear once there is something
 * in the cart, Purchase History is always there because looking up a past order
 * does not depend on having a live one.
 */
function CartBar({
  orgId, tab, view, go,
}: { orgId: string; tab: string; view: string | null; go: (t: string, v?: string | null) => void }) {
  const cart = useDiscoverCart(orgId)
  if (!cart.ready) return null

  const at = (v: string) => tab === 'order' && view === v
  const has = cart.totalUnits > 0
  return (
    <>
      {has && !at('cart') && (
        <Btn size="sm" variant="secondary" onClick={() => go('order', 'cart')}>
          <span className="material-symbols-outlined text-[15px]">shopping_cart</span>
          Cart
          <span style={PJ}
            className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[#285D6E] text-white text-[9px] font-extrabold tabular-nums">
            {cart.totalUnits}
          </span>
        </Btn>
      )}
      {has && !at('ordering') && (
        <Btn size="sm" variant="primary" onClick={() => go('order', 'ordering')}>
          <span className="material-symbols-outlined text-[15px]">list_alt_check</span>
          Ordering Flow
        </Btn>
      )}
      {!at('orders') && (
        <Btn size="sm" variant="ghost" onClick={() => go('order', 'orders')}>
          <span className="material-symbols-outlined text-[15px]">receipt_long</span>
          Purchase History
        </Btn>
      )}
    </>
  )
}
