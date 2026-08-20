'use client'

/**
 * Organization sidebar navigation.
 *
 * Renders the nav tree recursively so hierarchy is expressed by nesting rather
 * than by a flat list plus a horizontal strip elsewhere on the page:
 *
 *   Dashboard            Discover
 *     ├ Overview           │  KOL INTELLIGENCE
 *     ├ Content Overview   ├ Directory · Compare · Reports
 *     └ …                  ├ Negotiation · Ordering · Settings
 *                          │  DISCOVER
 *                          └ Campaign · Content · Audience · AI Assistant
 *
 * Two behaviours make deep trees usable:
 *   * a branch containing the current page auto-expands, so a reload or a deep
 *     link never lands you inside a collapsed subtree;
 *   * manual toggles are remembered per branch for the session, so opening a
 *     sibling does not fight the user's own expansions.
 *
 * Both branches are one level deep. Discover's are grouped the way the source
 * platform groups them — the six entries of its `KOL Intelligence` branch, then
 * the entries its sidebar hangs beside that branch — as a label row above the
 * first of each, printed from `groupLabel`. The labels are not links; the depth
 * is still one.
 *
 * Discover's children differ from Dashboard's only in how they address their page:
 * they share one route and select their panel with `?tab=`, so matching the current
 * entry means reading the query as well as the path. The sections a few tabs hold —
 * Directory's two rosters, Ordering's Rate Cards / Cart / Orders segments, Reports
 * and Settings' two halves, the seven per-creator views reached by opening a
 * tracked account — stay as strips inside the page. Hanging them here is what made
 * this module three levels deep before.
 */

import { Fragment, useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useParams, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ORG_NAV_ITEMS, type OrgNavItem } from '@/lib/organizations/nav'
import { resolveTabParams, tabHref } from '@/lib/discover/tabs'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

/** Indent per level; deep enough to read, tight enough for a 280px sidebar. */
const INDENT = 12

export default function OrgNav({ fallbackOrgSlug }: { fallbackOrgSlug: string }) {
  const pathname = usePathname()
  const params = useParams()
  const searchParams = useSearchParams()
  const orgSlug = (params?.orgSlug as string | undefined) ?? fallbackOrgSlug
  const { data: session } = useSession()

  const base = `/organizations/${orgSlug}`
  const isAppAdmin = session?.user?.role === 'ADMIN'
  /**
   * The tab the URL currently resolves to, through the same function the page
   * uses. Going through the resolver rather than reading `?tab=` raw is what makes
   * a bare `/discover` highlight Directory, and an old alias like `?tab=cart`
   * highlight Cart & Order instead of nothing.
   */
  const currentTab = resolveTabParams(searchParams.get('tab'), searchParams.get('view')).tab

  /** Manual expand/collapse, keyed by the branch's href. */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const toggle = useCallback((key: string, open: boolean) => {
    setOverrides(o => ({ ...o, [key]: !open }))
  }, [])

  const items = useMemo(
    () => ORG_NAV_ITEMS.filter(i => !i.adminOnly || isAppAdmin),
    [isAppAdmin],
  )

  /**
   * A `tab` means the entry is one of Discover's, so its URL comes from Discover's
   * own `tabHref` — the same function the workspace navigates with, so the link in
   * the sidebar and the link the page pushes are byte for byte the same.
   */
  const hrefOf = (item: OrgNavItem) =>
    item.tab ? tabHref(orgSlug, item.tab, item.view) : `${base}/${item.path}`

  /**
   * Tabbed entries share a route, so they match on the resolved tab; ordinary
   * entries prefix-match the path, which keeps a section highlighted on its detail
   * pages — a creator under Discover, an order, a campaign dashboard.
   *
   * Deliberately matched on the tab alone and not on the view: which section of
   * Cart & Order you are in is the in-page strip's business, and comparing it here
   * would leave the sidebar entry unlit on two of its own three steps.
   */
  const isActive = useCallback((item: OrgNavItem): boolean => {
    const route = `${base}/${item.path}`
    if (item.tab) return pathname === route && currentTab === item.tab
    return pathname === route || pathname.startsWith(`${route}/`)
  }, [base, pathname, currentTab])

  /** A branch is "on the path" when it or any descendant is active. */
  const containsActive = useCallback((item: OrgNavItem): boolean => {
    if (isActive(item)) return true
    return (item.children ?? []).some(containsActive)
  }, [isActive])

  return (
    <nav className="flex-1 py-3 px-2 flex flex-col gap-0.5 overflow-y-auto">
      {items.map(item => (
        <NavNode
          key={item.path + (item.tab ?? '')}
          item={item}
          depth={0}
          hrefOf={hrefOf}
          isActive={isActive}
          containsActive={containsActive}
          overrides={overrides}
          onToggle={toggle}
        />
      ))}
    </nav>
  )
}

function NavNode({
  item, depth, hrefOf, isActive, containsActive, overrides, onToggle,
}: {
  item: OrgNavItem
  depth: number
  hrefOf: (i: OrgNavItem) => string
  isActive: (i: OrgNavItem) => boolean
  containsActive: (i: OrgNavItem) => boolean
  overrides: Record<string, boolean>
  onToggle: (key: string, open: boolean) => void
}) {
  const href = hrefOf(item)
  const key = `${item.path}:${item.tab ?? ''}:${item.label}`
  const hasChildren = !!item.children?.length
  const onPath = containsActive(item)

  // A branch points at its first child's route (Workspace → Reports, Ordering →
  // Rate Cards), so both would match the URL and both would highlight. The
  // child is the more specific answer, so the parent yields to it and shows
  // only as on-path.
  const childActive = (item.children ?? []).some(containsActive)
  const active = isActive(item) && !childActive

  // Auto-open the branch holding the current page; a manual toggle wins.
  const open = overrides[key] ?? onPath

  // Depth 0 keeps the original chunky treatment; deeper levels step down in
  // size so the tree reads as a hierarchy rather than a list of equals.
  const height = depth === 0 ? 'h-9' : depth === 1 ? 'h-8' : 'h-[30px]'
  const text = depth === 0 ? 'text-[13px]' : depth === 1 ? 'text-[12.5px]' : 'text-[12px]'
  const iconSize = depth === 0 ? 'text-[18px]' : depth === 1 ? 'text-[16px]' : 'text-[15px]'

  return (
    <div>
      <div
        className={`group flex items-center rounded-md transition-colors border-l-[3px] ${
          active
            ? 'border-l-[#285D6E] bg-[#f0f7fa]'
            : onPath && hasChildren
              ? 'border-l-transparent'
              : 'border-l-transparent hover:bg-[#f9fafb]'
        }`}
        style={{ paddingLeft: depth * INDENT }}
      >
        {/* expand/collapse — only for branches */}
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(key, open)}
            aria-expanded={open}
            aria-label={open ? `Tutup ${item.label}` : `Buka ${item.label}`}
            className="w-5 h-5 ml-1.5 flex items-center justify-center flex-shrink-0 rounded hover:bg-[#e5e7eb]"
          >
            <span className={`material-symbols-outlined text-[16px] transition-transform ${
              active ? 'text-[#285D6E]' : 'text-[#9ca3af]'
            } ${open ? 'rotate-90' : ''}`}>
              chevron_right
            </span>
          </button>
        ) : (
          // Keeps leaf labels aligned with their expandable siblings.
          <span className="w-5 ml-1.5 flex-shrink-0" />
        )}

        <Link
          href={href}
          style={PJ}
          className={`flex items-center gap-2 flex-1 min-w-0 pr-2 pl-1 font-semibold ${height} ${text} ${
            active
              ? 'text-[#111827]'
              : onPath
                ? 'text-[#374151]'
                : 'text-[#6b7280] group-hover:text-[#374151]'
          }`}
        >
          <span className={`material-symbols-outlined flex-shrink-0 ${iconSize} ${
            active ? 'text-[#285D6E]' : onPath ? 'text-[#6b7280]' : 'text-[#9ca3af]'
          }`}>
            {item.icon}
          </span>
          <span className="truncate">{item.label}</span>
        </Link>
      </div>

      {hasChildren && open && (
        <div className="mt-0.5 mb-0.5 flex flex-col gap-0.5">
          {item.children!.map(child => (
            <Fragment key={child.path + (child.tab ?? '') + child.label}>
              {/* Stage label above the first entry of each group, so a long branch
                  reads as a few short lists instead of one column to scan. Not a
                  link and not focusable — it names the rows below it. */}
              {child.groupLabel && (
                <div
                  className="flex items-center gap-1.5 pr-2 pt-2 pb-0.5"
                  style={{ paddingLeft: (depth + 1) * INDENT + 26 }}
                >
                  <span style={PJ} className="text-[9.5px] font-bold uppercase tracking-widest text-[#b6bcc6]">
                    {child.groupLabel}
                  </span>
                  <span className="flex-1 h-px bg-[#f3f4f6]" />
                </div>
              )}
              <NavNode
                item={child}
                depth={depth + 1}
                hrefOf={hrefOf}
                isActive={isActive}
                containsActive={containsActive}
                overrides={overrides}
                onToggle={onToggle}
              />
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
