/**
 * The Discover module's destination registry — ten entries, one route.
 *
 * The shape follows the source platform's own navigation (`src/js/core/layout.js`
 * in the KOL Intelligence build). There, Discover is a group holding one
 * collapsible branch — `KOL Intelligence`, whose six children are `NAVK`:
 *
 *     KOL · Compare · Reports · Negotiation · Ordering · Settings
 *
 * — with `Campaigns`, `Discovery Content`, `Audience Insights` and `AI Assistant`
 * sitting beside that branch as siblings rather than inside it. `DISCOVER_TABS`
 * reproduces exactly that: six entries in the `kol` group in the source's order,
 * then four in the `discover` group.
 *
 * This array is the single source for all of it. `@/lib/organizations/nav` builds
 * Discover's sidebar children from it — that is what navigates between them, the
 * same shape as Dashboard — and `DiscoverWorkspace` reads it for headings,
 * breadcrumbs and sub-strips. Adding an entry here adds it to the sidebar.
 *
 * Two levels of depth remain, but neither is navigation you have to plan for:
 *
 *   * a **sub-strip** inside a tab, for the ones that hold more than one screen.
 *     `Ordering` carries the source's `[ Rate Cards | Cart | Orders ]` segmented
 *     control, and `Reports` and `Settings` each cover a Discover-side and a
 *     Workspace-side page — the source splits those same two across its module
 *     nav and its app nav. `Directory` carries the widest one: four creator
 *     screens, because autometric has four creator sources where the source
 *     platform has one;
 *   * **drill-down**, for the seven per-creator analysis views under `Directory`.
 *     They only exist once a creator is selected, so they appear as a sub-strip
 *     only then — a static list would be seven dead entries on first visit. The
 *     source does the same thing with `V.detail`, which is reached by opening a
 *     card and is likewise absent from its nav.
 *
 * Four creator screens, one entry. The source's `KOL` opens straight onto its
 * creator list (`V.list` in `pages/directory.js`) because its `KOLS` array is
 * eight hardcoded objects and there is only one list to open. autometric has
 * four real surfaces that cannot be merged — the commercial platform's ~7.7k
 * creators in `public.kol_directory`, the creators this org added itself, the
 * accounts it tracks in the warehouse, and the recommendations derived from the
 * first. Only the tracked accounts have post-level history, which is why the
 * analysis views hang off them.
 *
 * So this entry lands on the commercial directory, exactly as the source's does,
 * and the other three sit in a sub-strip above it. There was a version where a
 * dashboard stood in front of all four instead; it answered "what do we already
 * have?" before anyone had asked, and put a page between the sidebar entry and
 * the list that entry is named after.
 *
 * The URL is `?tab=<tab>&view=<view>`. Two params rather than one flat value:
 * `view` ids are namespaced by their tab, so `content` can mean Discovery
 * Content as a tab and Content Analytics as a view under Directory without the
 * two colliding. `resolveTabParams` is the only thing that reads them, and
 * `ALIASES` keeps every link saved from the old shape working.
 */

export interface DiscoverView {
  id: string
  label: string
  icon: string
  /** Copy for the shell's header when this view is active. */
  subtitle?: string
  /**
   * Resolvable by URL but not drawn in the sub-strip. The ordering flow is the
   * one of these: the source shows its three checkout steps *inside* the Cart
   * segment rather than as a fourth segment, so the flow keeps its own `view`
   * id — links into it still work, and it is still a distinct screen — while the
   * strip above it goes on showing three segments with `Cart` selected.
   */
  hidden?: boolean
}

export interface DiscoverTab {
  id: string
  label: string
  icon: string
  subtitle?: string
  /**
   * Which half of the module this belongs to. The sidebar prints these as
   * small-caps separators, matching the source's `KOL Intelligence` branch and
   * the entries sitting beside it. Entries sharing a group must be adjacent in
   * this array; the sidebar starts a new label wherever the value changes.
   */
  group: DiscoverGroup
  /**
   * The component renders its own `DiscoverHeader`, complete with the actions
   * belonging to that page (exports, refresh, filters). The shell renders no
   * header of its own for these, rather than stacking a second title above one
   * that already carries controls.
   */
  ownsHeader?: boolean
  /** Sub-strip, always visible. */
  views?: DiscoverView[]
  /**
   * Sub-strip shown only once a creator is active. Selecting a creator from the
   * list is what puts you into one of these.
   */
  creatorViews?: DiscoverView[]
}

/**
 * The two halves, as the source's sidebar draws them: the KOL Intelligence
 * branch, then the entries that sit beside it under the same Discover heading.
 */
export type DiscoverGroup = 'kol' | 'discover'

export const GROUP_LABEL: Record<DiscoverGroup, string> = {
  kol: 'KOL Intelligence',
  discover: 'Discover',
}

/* ── the ten destinations ─────────────────────────────────────────────────── */

export const DISCOVER_TABS: DiscoverTab[] = [
  {
    // `NAVK[0]` — the source's `KOL`, its creator list, and the only place its
    // per-creator drill-down is entered from.
    id: 'directory',
    // The sidebar's word for this tab, and the only place it shows: every screen
    // under it is titled by its own view. It matches the hub's heading so the
    // entry you pressed and the page you land on say the same thing.
    label: 'Discover Creators',
    icon: 'travel_explore',
    group: 'kol',
    subtitle: 'Explore and manage creators available in your workspace and database.',
    views: [
      {
        // The commercial platform's ~7.7k creators: the big searchable list.
        id: 'database',
        label: 'Creator Database',
        icon: 'search',
        subtitle: 'Browse and filter creators from the complete creator database — by keyword, platform, category, tier, followers, engagement rate and rate card.',
      },
      /**
       * The creators this org added by hand — the working list, and the one the
       * product calls the roster KOL. Its id stays `mine` rather than `roster`
       * because "roster" is also the word the commercial directory carries in
       * this product, and the two must not be one id.
       */
      {
        id: 'mine',
        label: 'My Creators',
        icon: 'folder_shared',
        subtitle: 'View and manage the creators your organization has added — your own creator roster. Add an account, check its profiling status, then narrow the list with filters.',
      },
      {
        // The warehouse side. It is the roster with post-level history, so the
        // seven analysis views below are reached from here and not from the
        // commercial roster, whose creators have no collected posts.
        id: 'tracked',
        label: 'Tracked Accounts',
        icon: 'monitor_heart',
        subtitle: 'Monitor the social media accounts this organization tracks — its own and its competitors — and their recent activity. A tracked account is not the same as a creator in your own database, and tracking one is not ordering from them.',
      },
      /**
       * Last in the strip, because it is the only segment that is not a list.
       * The three before it answer "show me the creators in X"; this one takes
       * one of those creators and goes looking for more like them, which is a
       * thing you do *after* you have found somebody worth copying.
       */
      {
        id: 'smart',
        label: 'Smart Discovery',
        icon: 'auto_awesome',
        subtitle: 'Tell us what you need and find creators that match. Start from a creator who already works for you, say what should be different — a lower budget, another city — and see the alternatives with the reasons they were picked.',
      },
      // Two screens you are sent to, not screens you switch to: one run's
      // progress, and one creator's full profile. Both need `&creator=`, so a
      // card with no id would be a dead link — the same reason the per-creator
      // analysis views below are hidden until a creator is active.
      { id: 'profiling', label: 'Profiling', icon: 'timeline', hidden: true, subtitle: 'Tujuh langkah profiling satu creator, seperti yang dicatat server.' },
      { id: 'creator', label: 'Creator Profile', icon: 'person', hidden: true, subtitle: 'Profil lengkap creator yang ditambahkan organisasi ini, beserta riwayat monitoring-nya.' },
    ],
    creatorViews: [
      { id: 'profile', label: 'Profile', icon: 'person', subtitle: 'Identitas dan KPI utama KOL aktif.' },
      { id: 'content', label: 'Content Analytics', icon: 'dynamic_feed', subtitle: '10 post terakhir: reach, engagement, sentimen, topik, hashtag dan waktu posting.' },
      { id: 'analytics', label: 'Analytics', icon: 'insights', subtitle: 'Tren performa, format dan engagement rate KOL aktif.' },
      { id: 'audience', label: 'Audience Insights', icon: 'group', subtitle: 'Komposisi dan respons audiens KOL aktif.' },
      // The source's `brand` entry, which renders Brand Fit and Campaign History
      // one after the other under two section headings (`brandSection`). They
      // were two separate views here; one screen answers the question they were
      // both asked for — is this creator right for us, and what have they run?
      { id: 'brandcamp', label: 'Brand & Campaign History', icon: 'handshake', subtitle: 'Kecocokan KOL aktif dengan brand kamu, beserta konten campaign dan boosted yang pernah dijalankan.' },
      { id: 'ai', label: 'AI Insights', icon: 'auto_awesome', subtitle: 'Insight otomatis dari metrik KOL aktif.' },
      // The source's seventh slot is `Insights`, a derived summary of the six
      // above. autometric's AI Insights already renders that summary, so the
      // slot carries the exportable per-creator report instead — the artifact
      // the source files under its Workspace Reports.
      { id: 'kolreport', label: 'Individual Report', icon: 'lab_profile', subtitle: 'Laporan satu KOL yang bisa diekspor untuk kebutuhan internal atau klien.' },
      // Not in the strip: rate cards are a segment of Ordering now, the way the
      // source keeps them. This is the single-creator screen behind the identity
      // strip's `Add to Campaign`, and behind every `?view=ratecard` link saved
      // while it was the ninth tab.
      { id: 'ratecard', label: 'Rate Card', icon: 'payments', hidden: true, subtitle: 'Harga, paket konten, estimasi reach dan syarat pemesanan KOL aktif.' },
    ],
  },
  // `NAVK[1]`
  {
    id: 'compare',
    label: 'Compare',
    icon: 'compare',
    group: 'kol',
    subtitle: 'Bandingkan minimal dua KOL: followers, ER, audience quality, authenticity, reach dan brand fit.',
  },
  // `NAVK[2]` — the module's own Reports. The source has a second, app-level
  // Reports page as well; both are here, as the two halves of this tab.
  {
    id: 'reports',
    label: 'Reports',
    icon: 'summarize',
    group: 'kol',
    ownsHeader: true,
    views: [
      { id: 'discover', label: 'Campaign Reports', icon: 'travel_explore' },
      { id: 'workspace', label: 'Workspace', icon: 'workspaces' },
    ],
  },
  // `NAVK[3]` — offers, chat and agreement terms. It sits before Ordering
  // because that is where it sits in the real job: you shortlist, you agree a
  // price and terms, then you buy.
  {
    id: 'negotiation',
    label: 'Negotiation',
    icon: 'handshake',
    group: 'kol',
    subtitle: 'Tawar-menawar per KOL: offer berversi, chat, agreement terms, guaranteed + performance fee, dan termin pembayaran.',
  },
  // `NAVK[4]` — the source's `Ordering`, whose segmented control is
  // `[ Rate Cards | Cart | Orders ]` and whose three checkout steps render
  // inside the Cart segment.
  {
    id: 'order',
    label: 'Ordering',
    icon: 'shopping_cart',
    group: 'kol',
    views: [
      { id: 'ratecards', label: 'Rate Cards', icon: 'request_quote', subtitle: 'Tarif dasar tiap akun — angka yang jadi dasar harga semua deliverable, dan titik awal negosiasi.' },
      { id: 'cart', label: 'Cart', icon: 'shopping_cart', subtitle: 'Kandidat campaign beserta rate card, deliverables dan subtotalnya.' },
      { id: 'orders', label: 'Orders', icon: 'receipt_long', subtitle: 'Riwayat pembelian: order berjalan dan order yang sudah ditutup.' },
      { id: 'ordering', label: 'Ordering Flow', icon: 'list_alt_check', hidden: true, subtitle: 'Tiga langkah: Creator Selection & Rate Card → Campaign Information & Brief → Order Summary & Payment.' },
    ],
  },
  // `NAVK[5]`
  {
    id: 'settings',
    label: 'Settings',
    icon: 'tune',
    group: 'kol',
    ownsHeader: true,
    views: [
      { id: 'discover', label: 'Discover', icon: 'travel_explore' },
      { id: 'workspace', label: 'Workspace', icon: 'workspaces' },
    ],
  },

  /* ── beside the branch, in the source's `APPNAV` order ─────────────────── */

  { id: 'campaign', label: 'Campaign', icon: 'campaign', group: 'discover', ownsHeader: true },
  { id: 'discovery', label: 'Content', icon: 'dynamic_feed', group: 'discover', ownsHeader: true },
  { id: 'audience', label: 'Audience', icon: 'group', group: 'discover', ownsHeader: true },
  { id: 'assistant', label: 'AI Assistant', icon: 'auto_awesome', group: 'discover', ownsHeader: true },
]

export const DEFAULT_TAB = 'directory'

const BY_ID = new Map(DISCOVER_TABS.map(t => [t.id, t]))

export function findTab(id: string): DiscoverTab | undefined {
  return BY_ID.get(id)
}

/** The entries a sub-strip actually draws, in order. */
export function shown(views: DiscoverView[] | undefined): DiscoverView[] {
  return (views ?? []).filter(v => !v.hidden)
}

/** The always-visible sub-strip for a tab, hidden entries removed. */
export function visibleViews(tab: DiscoverTab | undefined): DiscoverView[] {
  return shown(tab?.views)
}

/** Every `view` id a tab answers to — strip, drill-down and hidden alike. */
function viewsOf(tab: DiscoverTab | undefined): DiscoverView[] {
  return [...(tab?.views ?? []), ...(tab?.creatorViews ?? [])]
}

/* ── resolving the URL ────────────────────────────────────────────────────── */

export interface TabParams {
  tab: string
  /** Null when the tab has no sub-views, or when its list view is showing. */
  view: string | null
}

/**
 * Every `?tab=` value the module has ever answered to, mapped onto the pair it
 * means now. The old workspace kept one flat param, so `cart` and `profile` were
 * siblings of `directory`; both now live a level down. `accounts` was the second
 * roster's own tab before the two rosters became one entry, and `ratecard` was a
 * per-creator view before rate cards moved into Ordering, where the source keeps
 * them. `checkout` and `planning` are two earlier names for the ordering flow.
 */
const ALIASES: Record<string, TabParams> = {
  // the second roster, once a tab of its own
  accounts: { tab: 'directory', view: 'tracked' },
  // per-creator views, once siblings of Directory and then views under the
  // second roster while it had a tab of its own
  profile: { tab: 'directory', view: 'profile' },
  analytics: { tab: 'directory', view: 'analytics' },
  // Brand Fit and Campaign History were two views; they are one screen now.
  campaignHistory: { tab: 'directory', view: 'brandcamp' },
  brandfit: { tab: 'directory', view: 'brandcamp' },
  ai: { tab: 'directory', view: 'ai' },
  kolreport: { tab: 'directory', view: 'kolreport' },
  // Rate cards. The flat `ratecard` value always meant one creator's card, so it
  // still resolves there; the Ordering segment listing every account is `rates`.
  ratecard: { tab: 'directory', view: 'ratecard' },
  rates: { tab: 'order', view: 'ratecards' },
  // the ordering flow
  cart: { tab: 'order', view: 'cart' },
  ordering: { tab: 'order', view: 'ordering' },
  checkout: { tab: 'order', view: 'ordering' },
  planning: { tab: 'order', view: 'ordering' },
  orders: { tab: 'order', view: 'orders' },
  // Campaign Management, which spent a while as its own route
  campaigns: { tab: 'campaign', view: null },
  'campaign-management': { tab: 'campaign', view: null },
  // Discovery Content. `content` alone is ambiguous — it was also the
  // per-creator Content Analytics view — so it is resolved by `resolveTabParams`
  // against the `view` param rather than listed here.
  discoveryContent: { tab: 'discovery', view: null },
  kol: { tab: 'directory', view: 'database' },
  // The org's own creators spent a version as a tab of their own. Their views
  // are Directory's now, and `resolveTabParams` maps them by name below.
  creators: { tab: 'directory', view: 'mine' },
}

/**
 * Turn raw search params into the tab and view to render.
 *
 * Unknown values fall back rather than 404: a tab strip is not a resource, and a
 * stale link is better served by the module's front page than by an error.
 */
export function resolveTabParams(
  rawTab: string | null | undefined,
  rawView: string | null | undefined,
): TabParams {
  // The module's front page is Directory's first segment, which is the same
  // "first visible view" rule every other tab gets — not a second thing to keep
  // in step with the registry.
  const home = (): TabParams => ({
    tab: DEFAULT_TAB,
    view: visibleViews(BY_ID.get(DEFAULT_TAB))[0]?.id ?? null,
  })

  if (!rawTab) {
    /**
     * `/discover?view=mine` — a view with no tab beside it.
     *
     * That is not a malformed link, it is the *canonical* one: `tabHref` leaves
     * `?tab=` out for the default tab, so every URL this module writes for one
     * of Directory's own screens arrives here carrying only a view. Falling
     * through to `home()` sent all of them to the landing instead — My
     * Creators, Tracked Accounts, Smart Discovery, the profiling screen and the
     * seven per-creator analysis views, none of which could be reached by URL
     * or survive a reload.
     */
    if (rawView) return resolveTabParams(DEFAULT_TAB, rawView)
    return home()
  }

  // `content` means Content Analytics when it arrives as an old flat tab value,
  // and Discovery Content when it is the current tab id. The presence of a
  // `view` param is what separates a current link from a legacy one: legacy
  // links never carried one.
  if (rawTab === 'content' && !rawView) return { tab: 'directory', view: 'content' }

  /**
   * Two `view` ids changed meaning when Discovery was renamed around what a
   * first-time reader calls these screens, and both need mapping by hand
   * because the generic alias below would carry the id across unchanged.
   *
   *   * `?tab=creators&view=roster|database` was the org's own creator list,
   *     which is `mine` now.
   *   * `?tab=directory&view=roster` was the commercial directory, which is
   *     `database` now — the id `database` briefly meant the org's own list, so
   *     a link carrying it under `directory` is read the way it was written.
   */
  if (rawTab === 'creators' && (rawView === 'roster' || rawView === 'database')) {
    return { tab: 'directory', view: 'mine' }
  }
  if (rawTab === 'directory' && rawView === 'roster') return { tab: 'directory', view: 'database' }

  const alias = ALIASES[rawTab]
  if (alias) {
    // `?tab=accounts&view=analytics` is a real saved link: the second roster was
    // a tab with the analysis views under it. The alias names the tab; a `view`
    // that still exists there outranks the alias's own default.
    if (rawView && viewsOf(BY_ID.get(alias.tab)).some(v => v.id === rawView)) {
      return { tab: alias.tab, view: rawView }
    }
    return alias
  }

  const tab = BY_ID.get(rawTab)
  if (!tab) return home()

  const views = viewsOf(tab)
  if (!rawView) {
    // A tab whose sub-strip is always visible needs one of them selected;
    // creator views do not, because the list itself is the landing view.
    return { tab: tab.id, view: visibleViews(tab)[0]?.id ?? null }
  }
  const view = views.find(v => v.id === rawView)
  return { tab: tab.id, view: view ? view.id : (visibleViews(tab)[0]?.id ?? null) }
}

/**
 * The canonical URL for a tab/view pair, relative to the org.
 *
 * `extra` carries the one thing a view can need beyond the pair: which creator
 * it is about. The profiling screen and a creator's profile are both `creators`
 * views that mean nothing without an id, and holding that id in component state
 * instead would lose it on reload and make the screen unshareable.
 */
export function tabHref(
  orgSlug: string,
  tab: string,
  view?: string | null,
  extra?: Record<string, string | null | undefined>,
): string {
  const base = `/organizations/${orgSlug}/discover`
  const qs = new URLSearchParams()
  if (tab !== DEFAULT_TAB) qs.set('tab', tab)
  /**
   * A tab's first visible segment is what its bare URL already means, so naming
   * it in the query would only make `/discover` and `/discover?view=database`
   * two spellings of one page — and the sidebar link the longer of the two.
   * `resolveTabParams` resolves the bare form back to this same segment, so the
   * short URL and the long one land on the same screen.
   */
  const landing = visibleViews(BY_ID.get(tab))[0]?.id
  if (view && view !== landing) qs.set('view', view)
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) qs.set(key, value)
  }
  const s = qs.toString()
  return s ? `${base}?${s}` : base
}

/** Title and subtitle for the shell's header, given the resolved pair. */
export function tabHeading(tab: string, view: string | null): { title: string; subtitle?: string } {
  const t = BY_ID.get(tab)
  if (!t) return { title: 'Discover' }
  const v = view
    ? [...(t.views ?? []), ...(t.creatorViews ?? [])].find(x => x.id === view)
    : undefined
  if (!v) return { title: t.label, subtitle: t.subtitle }
  return {
    // Ordering's segments are their own destinations, so the segment names the
    // page. The per-creator views do the same, with the creator in the crumb.
    title: v.label,
    subtitle: v.subtitle ?? t.subtitle,
  }
}
