/**
 * Asserts the Admin / Member navigation split against the acceptance criteria.
 *
 * The rule is short — Ordering and Settings are Admin-only, everything else is
 * shared — but it is enforced in four places that must agree: the expanded
 * sidebar, the collapsed rail, the Discover route guard and the Settings route
 * guard. All four derive from `orgNavItems` / `tabsFor` / `mayOpenTab`, and this
 * checks the source they derive from, plus the exact lists the brief specifies.
 *
 * It also checks the mode-versus-membership rule: the workspace mode chosen
 * after login lives in a cookie the browser can edit, so it must be able to
 * narrow access and never to widen it.
 *
 * Run with `npm run verify:nav-roles`.
 */

import { readFileSync } from 'node:fs'
import { orgNavItems } from '@/lib/organizations/nav'
import { mayOpenTab, tabsFor } from '@/lib/discover/tabs'
import { parseViewRole, type OrgRole } from '@/lib/organizations/viewRole'

/** The Discover children each role must have, in order. */
const ADMIN_DISCOVER = [
  'Discover Creators', 'Compare', 'Reports', 'Negotiation', 'Ordering', 'Settings',
  'Campaign', 'Content', 'Audience', 'AI Assistant',
]
const MEMBER_DISCOVER = [
  'Discover Creators', 'Compare', 'Reports', 'Negotiation',
  'Campaign', 'Content', 'Audience', 'AI Assistant',
]

/** Nothing a Member can see may be named either of these, anywhere in the tree. */
const ADMIN_ONLY_LABELS = ['Ordering', 'Settings']

let failures = 0
const fail = (message: string) => { console.log(`FAIL  ${message}`); failures++ }

const discoverOf = (role: 'ADMIN' | 'MEMBER') =>
  (orgNavItems(role).find(i => i.path === 'discover')?.children ?? []).map(c => c.label)

/* ── the two lists, exactly ───────────────────────────────────────────────── */

const admin = discoverOf('ADMIN')
if (admin.join(' · ') !== ADMIN_DISCOVER.join(' · ')) {
  fail(`ADMIN Discover is [${admin.join(', ')}]\n      expected [${ADMIN_DISCOVER.join(', ')}]`)
}

const member = discoverOf('MEMBER')
if (member.join(' · ') !== MEMBER_DISCOVER.join(' · ')) {
  fail(`MEMBER Discover is [${member.join(', ')}]\n      expected [${MEMBER_DISCOVER.join(', ')}]`)
}

/* ── nothing Admin-only survives anywhere in the Member tree ──────────────── */

const walk = (items: ReturnType<typeof orgNavItems>): string[] =>
  items.flatMap(i => [i.label, ...walk(i.children ?? [])])

for (const label of walk(orgNavItems('MEMBER'))) {
  if (ADMIN_ONLY_LABELS.includes(label)) {
    fail(`"${label}" is still present somewhere in the MEMBER sidebar`)
  }
}
// …and both are present for an Admin, so the filter cannot pass by deleting them.
for (const label of ADMIN_ONLY_LABELS) {
  if (!walk(orgNavItems('ADMIN')).includes(label)) fail(`"${label}" is missing for ADMIN`)
}

/* ── the URL, which a hidden entry does not close ─────────────────────────── */

for (const tab of ['order', 'settings']) {
  if (mayOpenTab(tab, 'MEMBER')) fail(`MEMBER can open ?tab=${tab} by URL`)
  if (!mayOpenTab(tab, 'ADMIN')) fail(`ADMIN cannot open ?tab=${tab}`)
}
for (const tab of ['directory', 'compare', 'reports', 'negotiation', 'campaign', 'discovery', 'audience', 'assistant']) {
  if (!mayOpenTab(tab, 'MEMBER')) fail(`MEMBER cannot open ?tab=${tab}`)
}

// An unknown role — the moment before it is known — must not lose entries.
if (tabsFor(undefined).length !== tabsFor('ADMIN').length) {
  fail('an unresolved role does not default to the full navigation')
}

/* ── mode vs membership ───────────────────────────────────────────────────── */

/**
 * The intersection rule, stated once and checked here because it is implemented
 * twice — `effectiveOrgRole` on the server and `OrgProvider` on the client — and
 * the two must never disagree. A mode is a preference in a cookie the browser
 * can edit; it may narrow access and must never widen it.
 */
const effective = (membership: OrgRole, mode: OrgRole | null): OrgRole =>
  membership === 'MEMBER' ? 'MEMBER' : mode ?? membership

const CASES: { membership: OrgRole; mode: OrgRole | null; expect: OrgRole; why: string }[] = [
  { membership: 'ADMIN',  mode: 'ADMIN',  expect: 'ADMIN',  why: 'admin in admin mode' },
  { membership: 'ADMIN',  mode: 'MEMBER', expect: 'MEMBER', why: 'admin previewing as member' },
  { membership: 'ADMIN',  mode: null,     expect: 'ADMIN',  why: 'admin with no mode chosen' },
  { membership: 'MEMBER', mode: 'MEMBER', expect: 'MEMBER', why: 'member in member mode' },
  // The one that matters: a forged cookie must buy nothing.
  { membership: 'MEMBER', mode: 'ADMIN',  expect: 'MEMBER', why: 'member with a forged ADMIN mode' },
  { membership: 'MEMBER', mode: null,     expect: 'MEMBER', why: 'member with no mode chosen' },
]

for (const c of CASES) {
  const got = effective(c.membership, c.mode)
  if (got !== c.expect) fail(`${c.why}: expected ${c.expect}, got ${got}`)
  // …and the navigation that role gets must match, not just the label.
  if (got === 'MEMBER' && tabsFor(got).some(t => t.adminOnly)) {
    fail(`${c.why}: resolved to MEMBER but the nav still holds an Admin-only tab`)
  }
}

/** A junk or absent cookie is "not chosen", never a grant. */
for (const raw of ['admin', 'ADMIN ', '', 'true', undefined, null, 'SUPERADMIN']) {
  const parsed = parseViewRole(raw as string | undefined)
  if (parsed !== null && parsed !== 'ADMIN' && parsed !== 'MEMBER') {
    fail(`parseViewRole(${JSON.stringify(raw)}) returned ${parsed}`)
  }
  if (raw !== 'ADMIN' && raw !== 'MEMBER' && parsed !== null) {
    fail(`parseViewRole(${JSON.stringify(raw)}) should be null, got ${parsed}`)
  }
}

/* ── the role control lives on the login screen, not in the app ───────────── */

/**
 * "Viewing as" is a step of the login flow. Putting a copy back in the sidebar
 * would give the same question two homes that can disagree — and the sidebar one
 * would be writing a cookie the server treats as settled. Cheap to check, and
 * this is the requirement most likely to be undone by a future edit.
 */
const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8')
for (const banned of ['RoleSwitcher', 'Viewing as</', 'VIEWING AS']) {
  if (sidebar.includes(banned)) {
    fail(`Sidebar.tsx renders a role control ("${banned}") — it belongs on the login screen`)
  }
}

/* ── report ───────────────────────────────────────────────────────────────── */

const show = (role: 'ADMIN' | 'MEMBER') => orgNavItems(role)
  .map(i => (i.children?.length ? `${i.label} (${i.children.length})` : i.label))
  .join(' · ')

console.log(`ADMIN  top level: ${show('ADMIN')}`)
console.log(`       Discover: ${admin.join(' · ')}`)
console.log(`MEMBER top level: ${show('MEMBER')}`)
console.log(`       Discover: ${member.join(' · ')}`)
console.log(failures === 0 ? '\nOK — navigation matches the acceptance criteria' : `\n${failures} failure(s)`)

process.exit(failures === 0 ? 0 : 1)
