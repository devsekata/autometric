'use client'

/**
 * Organization sidebar navigation.
 *
 * Renders the nav tree recursively so hierarchy is expressed by nesting rather
 * than by a flat list plus a horizontal strip elsewhere on the page:
 *
 *   Discover
 *     ├ KOL Intelligence
 *     │   ├ Directory
 *     │   │   └ Profile · Performance · … · Rate Card  (only with a creator active)
 *     │   ├ Compare
 *     │   ├ Discover Reports
 *     │   └ Settings
 *     ├ Discovery Content
 *     ├ Campaign Management
 *     ├ Audience
 *     ├ AI Assistant
 *     └ Workspace
 *         └ Reports · Settings
 *
 * Two behaviours make deep trees usable:
 *   * a branch containing the current page auto-expands, so a reload or a deep
 *     link never lands you inside a collapsed subtree;
 *   * manual toggles are remembered per branch for the session, so opening a
 *     sibling does not fight the user's own expansions.
 *
 * The per-creator sections are injected at render time from the active-KOL
 * selection, because a static list would render seven dead links before any
 * creator has been chosen.
 */

import { Fragment, useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useParams, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ORG_NAV_ITEMS, KOL_CREATOR_SECTIONS, type OrgNavItem } from '@/lib/organizations/nav'
import { useActiveKol } from '@/components/discover/useActiveKol'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

/** Indent per level; deep enough to read, tight enough for a 280px sidebar. */
const INDENT = 12

/** Where the creator's own sections begin, so the name chip can precede them. */
const FIRST_CREATOR_TAB = KOL_CREATOR_SECTIONS[0].tab

export default function OrgNav({ fallbackOrgSlug }: { fallbackOrgSlug: string }) {
  const pathname = usePathname()
  const params = useParams()
  const searchParams = useSearchParams()
  const orgSlug = (params?.orgSlug as string | undefined) ?? fallbackOrgSlug
  const { data: session } = useSession()
  const activeKol = useActiveKol(orgSlug)

  const base = `/organizations/${orgSlug}`
  const isAppAdmin = session?.user?.role === 'ADMIN'
  const currentTab = searchParams.get('tab')

  /** Manual expand/collapse, keyed by the branch's href. */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const toggle = useCallback((key: string, open: boolean) => {
    setOverrides(o => ({ ...o, [key]: !open }))
  }, [])

  /**
   * Inject the KOL Detail sections under Akun Saya once a creator is selected.
   *
   * They hang off Akun Saya because that is where the creator was found —
   * opening one is a drill-down from that list, not a sibling of it. Directory
   * browses the commercial roster, which has no post history behind it and so
   * opens no detail sections. Matched on `tab` rather than on the label, so
   * renaming the entry cannot silently detach the creator's sections.
   */
  const items = useMemo(() => {
    const withCreator = (item: OrgNavItem): OrgNavItem => {
      if (item.tab === 'accounts') {
        return activeKol.kol
          ? { ...item, children: [...KOL_CREATOR_SECTIONS, ...(item.children ?? [])] }
          : item
      }
      return item.children ? { ...item, children: item.children.map(withCreator) } : item
    }
    return ORG_NAV_ITEMS
      .filter(i => !i.adminOnly || isAppAdmin)
      .map(withCreator)
  }, [isAppAdmin, activeKol.kol])

  const hrefOf = (item: OrgNavItem) =>
    `${base}/${item.path}${item.tab && item.tab !== 'directory' ? `?tab=${item.tab}` : ''}`

  /**
   * Exact match for tabbed items (they share one route), prefix match for
   * ordinary ones so a detail page keeps its parent highlighted.
   */
  const isActive = useCallback((item: OrgNavItem): boolean => {
    const route = `${base}/${item.path}`
    if (item.tab) {
      if (pathname !== route) return false
      // Directory is the default tab, so it owns both the bare route and an
      // explicit ?tab=directory. Matching only the bare form left that valid
      // deep link with nothing highlighted and its branch collapsed.
      return item.tab === 'directory'
        ? !currentTab || currentTab === 'directory'
        : currentTab === item.tab
    }
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
          creatorName={activeKol.kol?.username}
        />
      ))}
    </nav>
  )
}

function NavNode({
  item, depth, hrefOf, isActive, containsActive, overrides, onToggle, creatorName,
}: {
  item: OrgNavItem
  depth: number
  hrefOf: (i: OrgNavItem) => string
  isActive: (i: OrgNavItem) => boolean
  containsActive: (i: OrgNavItem) => boolean
  overrides: Record<string, boolean>
  onToggle: (key: string, open: boolean) => void
  creatorName?: string
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
              {/* Name the creator whose sections these are, so a run of nine
                  analysis views in the middle of the list is not ambiguous.
                  Rendered inline, immediately before the first of them, because
                  they no longer sit at the top of their parent's children. */}
              {creatorName && child.tab === FIRST_CREATOR_TAB && (
                <div className="flex items-center gap-1.5 pr-2 py-0.5"
                  style={{ paddingLeft: (depth + 1) * INDENT + 26 }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4E96AC] flex-shrink-0" />
                  <span style={PJ} className="text-[10px] font-bold uppercase tracking-wider text-[#9ca3af] truncate">
                    {creatorName}
                  </span>
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
                creatorName={creatorName}
              />
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
