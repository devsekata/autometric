'use client'

/**
 * The role the sidebar is drawn for.
 *
 * Two inputs, because they answer different questions. `mode` is what the user
 * picked on the "Viewing as" screen after signing in — a session-wide choice,
 * carried in a cookie. `actualRole` is their membership in the workspace
 * currently open, which `OrgTracker` reports as they move between orgs.
 *
 * `role` is the **intersection** of the two, never the mode alone. The mode
 * lives in a cookie the browser can edit, so it may narrow what a user sees and
 * must never widen it: a Member who sets it to `ADMIN` by hand is still a
 * Member, and must not even be shown the entries. The server applies the same
 * rule in `effectiveOrgRole`, which is what actually refuses the routes — this
 * is the half that keeps the sidebar from offering links that would bounce.
 *
 * Nothing here writes the cookie. The mode is chosen once, on its own screen,
 * through a server action; there is no role control inside the application.
 *
 * The cookie's name and parser live in `@/lib/organizations/viewRole`, not here.
 * Both sides read them, and an export from a `'use client'` module becomes a
 * client reference the moment a Server Component imports it — which is exactly
 * what made the dashboard layout throw when they lived in this file.
 */

import { createContext, useContext, useMemo, useState } from 'react'
import type { OrgRole } from '@/lib/organizations/viewRole'

export type { OrgRole }

interface OrgContextValue {
  /** What the navigation should show: the mode, narrowed by the membership. */
  role: OrgRole | null
  /** This user's membership in the workspace currently open. */
  actualRole: OrgRole | null
  /** The mode chosen after login, for reference. Not a permission on its own. */
  mode: OrgRole | null
  setActualRole: (r: OrgRole | null) => void
}

const OrgContext = createContext<OrgContextValue>({
  role: null, actualRole: null, mode: null, setActualRole: () => {},
})

export function OrgProvider({
  children, initialViewRole = null, initialActualRole = null,
}: {
  children: React.ReactNode
  /** The chosen mode, read from its cookie by the layout on the server. */
  initialViewRole?: OrgRole | null
  /**
   * The membership for the org this session was last in. Seeded on the server
   * for the same reason the mode is: `OrgTracker` can only report it from an
   * effect, so a Member would otherwise see the Admin entries for one frame.
   */
  initialActualRole?: OrgRole | null
}) {
  const [actualRole, setActualRole] = useState<OrgRole | null>(initialActualRole)
  const mode = initialViewRole

  const value = useMemo<OrgContextValue>(() => ({
    role: actualRole === 'MEMBER' ? 'MEMBER' : mode ?? actualRole,
    actualRole,
    mode,
    setActualRole,
  }), [mode, actualRole])

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}

/** The role the navigation is drawn for — null only before an org page loads. */
export function useOrgRole() {
  return useContext(OrgContext).role
}

export function useSetOrgRole() {
  return useContext(OrgContext).setActualRole
}
