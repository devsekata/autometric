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
 *   ├─ Discovery        lands on the commercial directory, as the source's `KOL`
 *   │    │                does; the other three creator sources are its strip.
 *   │    │                `&add=1` opens intake as a dialog over any of them
 *   │    ├─ database      the commercial roster, searchable — the landing
 *   │    ├─ mine          creators this org added
 *   │    ├─ tracked       accounts this org monitors, and the seven per-creator
 *   │    │                analysis views reached from them
 *   │    └─ smart         reference-based recommendations
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
import DiscoverHub from './DiscoverHub'
import CreatorRoster from './CreatorRoster'
import CreatorProfilingScreen from './CreatorProfilingScreen'
import AddCreatorModal from './AddCreatorModal'
import CreatorDetail from './CreatorDetail'
import SmartDiscovery from './SmartDiscovery'
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
 *
 * Discovery's two drill-downs used to need an entry here as well. They no longer
 * do: that tab is a hub and draws no strip, so what says where you are inside it
 * is the breadcrumb.
 */
const STRIP_ANCHOR: Record<string, string> = {
  ordering: 'cart',
}

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
   * Which creator the `creators` tab's two drill-down views are about, from
   * `?creator=`. Null everywhere else. In the URL rather than in state so the
   * profiling screen survives a reload and can be handed to someone else — a run
   * takes minutes, and "send me the link" is the normal thing to do with it.
   */
  creatorId: string | null
  /**
   * `?refsrc=` — which list `creatorId` is in when Smart Discovery is the view.
   *
   * `Find Similar` is offered on Creator Database rows as well as on the org's
   * own creators, and the two ids are resolved by different queries. Absent
   * means the org's own roster, which is what the link meant before Creator
   * Database rows could be a reference.
   */
  referenceSource: 'creator' | 'roster' | null
  /**
   * `?add=1` — open the Add KOL dialog over whichever Discovery screen is
   * showing. A URL flag rather than component state because "Add Another
   * Creator" arrives here as a navigation from the profiling screen, and state
   * does not survive one.
   */
  openAddCreator: boolean
  /**
   * `?q=` — what the hub's search box was submitted with, applied to the Creator
   * Database as its opening query. In the URL for the same reason `?add=1` is:
   * the hub reaches that screen by navigating, so anything held in state here
   * would be gone by the time the screen mounts.
   */
  searchQuery: string | null
  /**
   * `?url=` — a profile link carried into the Add KOL dialog so it opens on
   * that link with its platform already picked. Whether it is a usable profile
   * link is the dialog's judgement, not this component's: it is the screen with
   * somewhere to say so.
   */
  addInput: string | null
  /**
   * Read on the server for the Workspace half of Settings — members, tracked
   * platforms, whether payment and AI keys are configured. Null on every other
   * tab: the page only pays for it when that tab is the one being asked for.
   */
  workspaceSettings: WorkspaceSettingsData | null
}

export default function DiscoverWorkspace({
  orgId, orgSlug, tab, view, creatorId, referenceSource, openAddCreator, searchQuery, addInput,
  workspaceSettings,
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

  const go = useCallback((
    nextTab: string,
    nextView?: string | null,
    extra?: Record<string, string | null | undefined>,
  ) => {
    router.push(tabHref(orgSlug, nextTab, nextView, extra), { scroll: false })
  }, [router, orgSlug])

  /**
   * The creator-database screens. They are views of Directory, so they navigate
   * like every other segment of it and carry the id they are about.
   */
  const goCreator = useCallback((nextView: string, id?: string | null) => {
    go('directory', nextView, { creator: id })
  }, [go])

  /**
   * `Find Similar`, from either list.
   *
   * The id alone is ambiguous — Smart Discovery resolves an org creator and a
   * Creator Database row with different queries — so the source rides along in
   * the URL. Omitted for the org's own creators, which is the default and what
   * every link saved before this existed meant.
   */
  const goFindSimilar = useCallback((id: string, source: 'creator' | 'roster') => {
    go('directory', 'smart', { creator: id, refsrc: source === 'roster' ? 'roster' : null })
  }, [go])

  /**
   * Which of Directory's creator-side screens is showing, if any: the org's own
   * roster, the recommendations, and the two per-creator drill-downs.
   *
   * These are Directory views, so this only fires for `directory` — and the two
   * drill-downs need an id, so a link to one without `?creator=` (a bookmark
   * saved before the creator was deleted, say) resolves to the roster rather
   * than to a screen with nothing to render.
   */
  const CREATOR_VIEWS = ['mine', 'smart', 'profiling', 'creator']
  const creatorScreen = tab !== 'directory' ? null
    // A bare `?tab=directory` is the hub, which is none of these.
    : !view ? null
    : !CREATOR_VIEWS.includes(view) ? null
    : (view === 'profiling' || view === 'creator') && !creatorId ? 'mine'
    : view

  /**
   * `Add KOL`, from wherever it was pressed: raise the dialog over the screen
   * you are on rather than navigating off it. The flag rides the current view,
   * so closing puts it back exactly as it was.
   */
  const goAddKol = useCallback(
    () => go('directory', view ?? 'database', { add: '1' }),
    [go, view],
  )

  /**
   * Re-run profiling on a creator that already exists, then follow the run.
   *
   * The intake modal offers this when the handle you typed is already in the
   * database: the creator is not new, but the data may be stale. The roster has
   * its own copy of this because it also has a list to reload afterwards; here
   * there is nothing to reload, because following the run is a navigation.
   */
  const refreshExisting = useCallback(async (creatorId: string) => {
    try {
      await fetch(`/api/organizations/${orgId}/discover/creators/${creatorId}/refresh`, { method: 'POST' })
    } catch (err) {
      // The progress screen is where a failed run is reported, and it is where
      // this is going either way — so a failed kick-off needs no second notice.
      console.error('[discover] refresh could not be started:', err)
    }
    goCreator('profiling', creatorId)
  }, [orgId, goCreator])

  const kolName = activeKol.ready ? activeKol.kol?.username : undefined
  const creatorSection = tab === 'directory' && view ? PER_KOL_SECTIONS[view] : undefined
  /** A per-creator view with nothing selected is the list, not an empty shell. */
  const inCreator = !!creatorSection && !!activeKol.kol

  /**
   * Where the Add KOL dialog may open: the four creator screens — everywhere
   * "we should add this person" is a thought you can have. Not on a single
   * creator's screens, where the subject is that one creator, and not on
   * another tab, where `?add=1` would be a flag about a module you are not in.
   */
  const addHere = tab === 'directory'
    && (!view || ['database', 'mine', 'tracked', 'smart'].includes(view))

  /**
   * Where the shell draws the button itself: everywhere the dialog may open,
   * minus the two screens that carry their own. The Creator Database has the
   * source platform's `Add KOL` in its page head and My Creators has one beside
   * its filters; a second in the header above either would be two buttons for
   * one action.
   */
  const showAddKol = addHere && !!view && view !== 'database' && view !== 'mine'

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
    type Crumb = { label: string; href?: () => void; icon?: string }
    const out: Crumb[] = [{ label: 'Discover' }]
    if (!def) return out

    const all = [...(def.views ?? []), ...(def.creatorViews ?? [])]
    const labelOf = (id: string) => all.find(v => v.id === id)?.label ?? id
    const active = all.find(v => v.id === view)

    const landing = visibleViews(def)[0]?.id
    out.push({
      label: def.label,
      // Back out to the list this view hangs off — for a tab with a strip, that
      // is its first segment.
      href: view && view !== landing ? () => go(def.id, landing) : undefined,
    })

    /**
     * Name the list a drill-down was opened from before naming the drill-down
     * itself: the analysis views hang off the tracked accounts, and profiling
     * and a creator's profile hang off the org's own roster. Neither is in the
     * sub-strip while it is showing — the strip has been replaced by that
     * creator's own sections — so without this crumb there is no way back to
     * the list except the browser's own.
     */
    if (inCreator) {
      out.push({ label: labelOf('tracked'), href: () => go(def.id, 'tracked') })
      if (kolName) out.push({ label: kolName })
    } else if (creatorScreen === 'profiling' || creatorScreen === 'creator') {
      out.push({ label: labelOf('mine'), href: () => go(def.id, 'mine') })
    }

    // Not on the landing: `Discover / Discover Creators / Creator Database`
    // spends its last two crumbs saying the same thing, and the sub-strip below
    // already shows which segment is selected.
    if (active && def.views?.length && view !== landing) out.push({ label: active.label })
    return out
  }, [def, view, inCreator, creatorScreen, kolName, go])

  return (
    <div className="p-5 max-w-[1500px] mx-auto">
      {/* Breadcrumb. On most tabs the sidebar does the navigating and this only
          states where you are; inside a hub tab it is also the way out, since
          the sidebar holds the tab and not the screens under it. */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 flex-wrap mb-1">
        {crumbs.map((c, i) => (
          <span key={`${c.label}-${i}`} className="inline-flex items-center gap-1">
            {i > 0 && <span className="material-symbols-outlined text-[13px] text-[#d1d5db]">chevron_right</span>}
            {c.href ? (
              <button type="button" onClick={c.href} style={PJ}
                className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af] hover:text-[#285D6E] hover:underline">
                {c.icon && <span className="material-symbols-outlined text-[13px]">{c.icon}</span>}
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
          actions={
            <>
              {/* The module's primary action, on every screen it makes sense
                  on. It raises the dialog over the current page rather than
                  navigating first, so adding a creator does not cost you the
                  list you were reading. */}
              {showAddKol && (
                <button type="button" style={PJ}
                  onClick={goAddKol}
                  className="inline-flex items-center gap-1.5 rounded-lg text-[12px] font-bold px-4 h-9 border bg-[#327488] border-[#327488] text-white hover:bg-[#285D6E] cursor-pointer">
                  <span className="material-symbols-outlined text-[16px]">person_add</span>
                  Add KOL
                </button>
              )}
              <CartBar orgId={orgId} tab={tab} view={view} go={go} />
            </>
          }
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
        {/* The landing, and the source platform's `V.list`: the commercial
            directory, searchable. A bare `?tab=directory` resolves here, so it
            renders when `view` has not been named yet too. */}
        {/* The landing. A bare `?tab=directory` is where Discovery opens, and it
            opens on the shelves — who is new, who moved, who is big, who
            resembles your own creators — with the searchable database directly
            below. Pressing `Creator Database` in the strip asks for the
            database on its own, and drops the shelves. */}
        {tab === 'directory' && !creatorSection && !view && (
          <DiscoverHub
            orgId={orgId}
            onOpenCreator={id => goCreator('creator', id)}
            onOpenRosterCreator={id =>
              router.push(`/organizations/${orgSlug}/discover/kol-directory/${id}`)}
            onFindSimilar={(id, source) => goFindSimilar(id, source)}
            onGoToSmart={() => go('directory', 'smart')}
          />
        )}

        {tab === 'directory' && !creatorSection && (!view || view === 'database') && (
          <KolDirectoryPage
            orgId={orgId}
            orgSlug={orgSlug}
            initialQuery={searchQuery ?? ''}
            embedded
            // The source platform's `Add KOL` button, which until now only
            // flashed a toast. Same destination as every other one: intake.
            onAddCreator={goAddKol}
            onFindSimilar={id => goFindSimilar(id, 'roster')}
          />
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

        {/* My Creators — the org's own roster and the intake flow — plus Smart
            Discovery beside it. The two drill-downs read `?creator=`; without
            one there is nothing to show, so they fall back to the roster rather
            than to an empty shell. */}
        {creatorScreen === 'mine' && (
          <CreatorRoster
            orgId={orgId}
            embedded
            onAddCreator={goAddKol}
            onOpenCreator={id => goCreator('creator', id)}
            onOpenProfiling={id => goCreator('profiling', id)}
            onFindSimilar={id => goFindSimilar(id, 'creator')}
          />
        )}

        {creatorScreen === 'profiling' && creatorId && (
          <CreatorProfilingScreen
            orgId={orgId}
            creatorId={creatorId}
            onViewProfile={id => goCreator('creator', id)}
            onAddAnother={() => go('directory', 'database', { add: '1' })}
            onGoToDiscovery={() => go('directory', 'database')}
            onFindSimilar={id => goFindSimilar(id, 'creator')}
            onBackToRoster={() => goCreator('mine')}
          />
        )}

        {creatorScreen === 'creator' && creatorId && (
          <CreatorDetail
            orgId={orgId}
            creatorId={creatorId}
            onBack={() => goCreator('mine')}
            onFollowRun={id => goCreator('profiling', id)}
            onFindSimilar={id => goFindSimilar(id, 'creator')}
            onDeleted={() => goCreator('mine')}
          />
        )}

        {creatorScreen === 'smart' && (
          <SmartDiscovery
            orgId={orgId}
            embedded
            referenceId={creatorId}
            referenceSource={referenceSource}
            onOpenCreator={id => goCreator('creator', id)}
            onOpenRosterCreator={id =>
              router.push(`/organizations/${orgSlug}/discover/kol-directory/${id}`)}
            onGoToRoster={() => goCreator('mine')}
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
            onGoToDirectory={() => go('directory', 'database')}
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

      {/* Add KOL — platform, handle, the five checks, then one of six outcomes.
          One dialog for the whole module rather than one per screen: every
          outcome ends in a navigation, so there is never a list left behind
          that needs reloading in place. */}
      {addHere && openAddCreator && (
        <AddCreatorModal
          orgId={orgId}
          initialInput={addInput}
          // Closing drops `?add=1` and `?url=` and leaves you exactly where you
          // were, rather than on a URL that reopens the dialog on reload.
          onClose={() => go('directory', view ?? 'database')}
          onProfilingStarted={creator => goCreator('profiling', creator.id)}
          onViewExisting={id => goCreator('creator', id)}
          onRefreshExisting={refreshExisting}
        />
      )}
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
