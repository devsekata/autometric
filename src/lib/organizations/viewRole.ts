/**
 * The "Viewing as" role override — the cookie, and how to read it.
 *
 * Deliberately a plain module with no `'use client'` and no React import: both
 * sides need it. The sidebar reads it in the browser to know which entries to
 * draw; the dashboard layout and the route guards read it on the server, where
 * the actual access decision is made.
 *
 * That split is why this is not in `OrgContext`. Anything exported from a
 * `'use client'` module becomes a client reference when a Server Component
 * imports it, so calling it from the server throws at runtime — which is exactly
 * what happened when `parseViewRole` lived there.
 */

export type OrgRole = 'ADMIN' | 'MEMBER'

export const VIEW_ROLE_COOKIE = 'autometric_view_role'

/** A year: which role you are previewing is a preference, not a session detail. */
export const VIEW_ROLE_MAX_AGE = 60 * 60 * 24 * 365

/** Narrow a raw cookie value; anything unrecognised means "no override". */
export function parseViewRole(raw: string | undefined | null): OrgRole | null {
  return raw === 'ADMIN' || raw === 'MEMBER' ? raw : null
}
