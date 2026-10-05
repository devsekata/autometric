/**
 * Tenant isolation of the Creator Database's tenant fields — READ-ONLY.
 *
 *   npm run verify:tenant-metadata
 *
 * `public.kol_directory` is global; `public.agency_kol_accounts` is per agency.
 * The fields a row carries from the latter — `agency`, `displayName` (the
 * link's `label`) and the label half of `?q=` — must come from the viewing
 * agency's own active link only, never from another agency's.
 *
 * Every case is exercised against live data through the same functions the
 * routes call (`listKolDirectory`, `getKolCreator`), with the expectations
 * taken from independent SQL. Nothing is written: the session is forced
 * read-only and the script aborts unless Postgres confirms it.
 *
 *   A  viewer holds no link to X, another agency does → no agency, no label
 *   B  two agencies both hold X → each sees its own
 *   C  the viewer's link is older than another agency's → still its own
 *   D  an inactive link → never a source, for anyone
 *   E  search by another agency's label → does not surface X
 *   F  creator detail → the viewer's own agency only
 *   R  regression: the global roster, pagination and Brand Profile eligibility
 *      are unchanged by the viewer
 */
process.env.PGOPTIONS = '-c default_transaction_read_only=on'

import { readFileSync } from 'node:fs'
import kolDb from '../src/lib/kolDb'
import { getKolCreator, listKolDirectory } from '../src/lib/discover/kolDirectory'

let bad = 0
const ok = (label: string, cond: boolean, extra = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
}
const eq = (label: string, got: unknown, want: unknown) =>
  ok(label, got === want, got === want ? `${got}` : `got ${got}, want ${want}`)
const skip = (label: string, why: string) => console.log(`SKIP  ${label} — ${why}`)

const db = kolDb()

/** What `displayName` must be for a label: the same handle rule the app uses. */
const shownLabel = (label: string | null, username: string) => {
  const l = label?.trim()
  return l && l.toLowerCase() !== username.toLowerCase() ? l : null
}

/** The viewer's own active link to a creator, or null — the expected source. */
async function ownLink(kolId: string, agencyId: string) {
  const { rows } = await db.query<{ name: string; label: string | null }>(`
    SELECT ag.name, a.label
      FROM public.agency_kol_accounts a
      JOIN public.agencies ag ON ag.id = a.agency_id AND ag.deleted_at IS NULL
     WHERE a.kol_account_id = $1 AND a.agency_id = $2 AND a.is_active IS TRUE
     ORDER BY a.created_at DESC NULLS LAST LIMIT 1`, [kolId, agencyId])
  return rows[0] ?? null
}

/** Checks one viewer's view of one creator in the list and in the detail. */
async function expectView(tag: string, kol: { id: string; username: string }, viewer: string) {
  const own = await ownLink(kol.id, viewer)
  const wantAgency = own?.name ?? null
  const wantName = shownLabel(own?.label ?? null, kol.username)

  const row = (await listKolDirectory({ ids: [kol.id], viewerAgencyId: viewer, pageSize: 1 })).rows[0]
  eq(`${tag}: list agency = viewer's own`, row?.agency ?? null, wantAgency)
  eq(`${tag}: list displayName = viewer's own label`, row?.displayName ?? null, wantName)

  const detail = await getKolCreator(kol.id, viewer)
  eq(`${tag}: detail identity.agency = viewer's own`, detail?.identity.agency ?? null, wantAgency)
  eq(`${tag}: detail identity.displayName = viewer's own label`, detail?.identity.displayName ?? null, wantName)
  eq(`${tag}: detail creator.agency = viewer's own`, detail?.creator.agency ?? null, wantAgency)
}

async function main() {
  const { rows: [ro] } = await db.query<{ transaction_read_only: string }>('SHOW transaction_read_only')
  if (ro?.transaction_read_only !== 'on') {
    console.error('ABORT: the KOL session is not read-only')
    process.exit(2)
  }
  ok('KOL session is read-only', true)

  /* ── Fixtures, read from live data ─────────────────────────────────────── */

  // A creator linked (actively) by two different agencies, with the link of
  // `older` created before the link of `newer` — covers B, C and F.
  const { rows: [shared] } = await db.query<{
    id: string; username: string; older: string; newer: string
  }>(`
    SELECT kd.id, kd.username, o.agency_id::text AS older, n.agency_id::text AS newer
      FROM public.kol_directory kd
      JOIN public.agency_kol_accounts o ON o.kol_account_id = kd.id AND o.is_active IS TRUE
      JOIN public.agency_kol_accounts n ON n.kol_account_id = kd.id AND n.is_active IS TRUE
                                       AND n.agency_id <> o.agency_id
     WHERE kd.directory_status = 'active'
       AND (o.created_at IS NULL OR o.created_at < n.created_at)
       AND n.created_at IS NOT NULL
     ORDER BY (o.label IS NOT NULL) DESC, kd.id LIMIT 1`)

  // A creator whose only label belongs to one agency, with a label no global
  // field matches — covers A and E.
  const { rows: [labelled] } = await db.query<{
    id: string; username: string; owner: string; label: string
  }>(`
    SELECT kd.id, kd.username, a.agency_id::text AS owner, trim(a.label) AS label
      FROM public.kol_directory kd
      JOIN public.agency_kol_accounts a ON a.kol_account_id = kd.id AND a.is_active IS TRUE
      JOIN public.agencies ag ON ag.id = a.agency_id AND ag.deleted_at IS NULL
     WHERE kd.directory_status = 'active'
       AND length(trim(a.label)) >= 4 AND trim(a.label) ~ ' '
       AND position(lower(trim(a.label)) IN lower(kd.username)) = 0
       AND position(lower(trim(a.label)) IN lower(COALESCE(kd.bio, ''))) = 0
       AND position(lower(trim(a.label)) IN lower(COALESCE(kd.username_normalized, ''))) = 0
     ORDER BY kd.id LIMIT 1`)

  // An agency that holds no link at all to `labelled` — the viewer of case A.
  // Any real agency will do; none existing is itself worth reporting.
  const { rows: [stranger] } = labelled ? await db.query<{ id: string }>(`
    SELECT ag.id::text AS id FROM public.agencies ag
     WHERE ag.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.agency_kol_accounts a
                        WHERE a.agency_id = ag.id AND a.kol_account_id = $1)
     ORDER BY ag.id LIMIT 1`, [labelled.id]) : { rows: [] as { id: string }[] }

  /* ── A — viewer holds no link, another agency does ─────────────────────── */
  console.log('\n── A: no own link ──')
  if (labelled && stranger) {
    const row = (await listKolDirectory({ ids: [labelled.id], viewerAgencyId: stranger.id, pageSize: 1 })).rows[0]
    ok('A: creator still listed (global roster)', !!row)
    eq('A: agency is null, not the owner agency', row?.agency ?? null, null)
    eq('A: displayName is null, not the owner label', row?.displayName ?? null, null)
    const none = (await listKolDirectory({ ids: [labelled.id], pageSize: 1 })).rows[0]
    eq('A: no viewer at all → agency null', none?.agency ?? null, null)
    eq('A: no viewer at all → displayName null', none?.displayName ?? null, null)
  } else {
    skip('A', 'no labelled creator or no agency without a link to it')
  }

  /* ── B / C / F — two agencies, the viewer's link older ─────────────────── */
  console.log('\n── B/C/F: shared creator ──')
  if (shared) {
    console.log(`  creator @${shared.username}; older link vs newer link from two agencies`)
    await expectView('B/C older agency', shared, shared.older)
    await expectView('B newer agency', shared, shared.newer)
    const [a, b] = await Promise.all([
      getKolCreator(shared.id, shared.older), getKolCreator(shared.id, shared.newer)])
    ok('B: the two agencies see different agency names', a?.identity.agency !== b?.identity.agency,
      `${a?.identity.agency} vs ${b?.identity.agency}`)
    const detailNone = await getKolCreator(shared.id)
    eq('F: detail without a viewer → agency null', detailNone?.identity.agency ?? null, null)
    eq('F: detail without a viewer → displayName null', detailNone?.identity.displayName ?? null, null)
  } else {
    skip('B/C/F', 'no creator is actively linked by two agencies')
  }
  if (labelled && stranger) {
    const d = await getKolCreator(labelled.id, stranger.id)
    ok('F: detail for a non-linked agency still found (global)', !!d)
    eq('F: detail for a non-linked agency → agency null', d?.identity.agency ?? null, null)
    eq('F: detail for a non-linked agency → displayName null', d?.identity.displayName ?? null, null)
    await expectView('F owner agency', labelled, labelled.owner)
  }

  /* ── D — inactive links are never a source ─────────────────────────────── */
  console.log('\n── D: inactive link ──')
  const { rows: [inactive] } = await db.query<{ id: string; username: string; agency_id: string }>(`
    SELECT kd.id, kd.username, a.agency_id::text AS agency_id
      FROM public.agency_kol_accounts a
      JOIN public.kol_directory kd ON kd.id = a.kol_account_id AND kd.directory_status = 'active'
     WHERE a.is_active IS NOT TRUE
     ORDER BY kd.id LIMIT 1`)
  if (inactive) {
    // Its own agency: the inactive link must not supply anything unless that
    // agency ALSO holds an active link (then ownLink returns that one).
    await expectView('D inactive link, its own agency', inactive, inactive.agency_id)
  } else {
    skip('D on data', 'no inactive agency_kol_accounts row on an active creator in live data')
  }
  // The predicate itself, in every query that reads a label or agency name, so
  // D holds even where the data has no inactive row to exercise it.
  // Each read of the table: the text from its FROM up to the next 8 lines.
  const lines = readFileSync('src/lib/discover/kolDirectory.ts', 'utf8').split('\n')
  const reads = lines.flatMap((l, i) =>
    /FROM public\.agency_kol_accounts a\b/.test(l) ? [{ line: i + 1, text: lines.slice(i, i + 8).join('\n') }] : [])
  // attachRosterExtras, getKolCreator, SEARCH_MATCH, RELEVANCE, and the
  // My Creators filter — five today; fewer means one was missed or renamed.
  ok('D: all agency_kol_accounts reads in kolDirectory.ts found', reads.length >= 5, `${reads.length} reads`)
  for (const r of reads) {
    ok(`D: read at kolDirectory.ts:${r.line} is scoped to one agency`, /a\.agency_id = \$\d+/.test(r.text))
    ok(`D: read at kolDirectory.ts:${r.line} requires an active link`, /a\.is_active IS TRUE/.test(r.text))
  }

  /* ── E — search by another agency's label ──────────────────────────────── */
  console.log('\n── E: search isolation ──')
  if (labelled && stranger) {
    const q = labelled.label
    const asStranger = await listKolDirectory({ q, ids: [labelled.id], viewerAgencyId: stranger.id, pageSize: 1 })
    eq(`E: another agency's label does not find @${labelled.username}`, asStranger.total, 0)
    const asOwner = await listKolDirectory({ q, ids: [labelled.id], viewerAgencyId: labelled.owner, pageSize: 1 })
    eq(`E: the owner's own label still finds @${labelled.username}`, asOwner.total, 1)
    const asNobody = await listKolDirectory({ q, ids: [labelled.id], pageSize: 1 })
    eq('E: without a viewer the label is not searched', asNobody.total, 0)
    // Global fields still search for everyone.
    const byHandle = await listKolDirectory({
      q: labelled.username, ids: [labelled.id], viewerAgencyId: stranger.id, pageSize: 1 })
    eq('E: the handle still finds the creator for any agency', byHandle.total, 1)
  } else {
    skip('E', 'no labelled creator or no agency without a link to it')
  }

  /* ── R — regression: the global roster is untouched ────────────────────── */
  console.log('\n── R: regression ──')
  const viewers = [stranger?.id, labelled?.owner, shared?.newer].filter((v): v is string => !!v)
  const base = await listKolDirectory({ pageSize: 1 })
  for (const v of viewers) {
    eq('R: roster total is the same for any viewer', (await listKolDirectory({ viewerAgencyId: v, pageSize: 1 })).total, base.total)
  }
  const elig = { platforms: ['instagram'], tiers: ['Mid-tier'], categoryKeys: ['Beauty'] }
  const eligNone = await listKolDirectory({ profileEligibility: elig, pageSize: 1 })
  for (const v of viewers) {
    eq('R: Brand Profile eligibility count unchanged by the viewer',
      (await listKolDirectory({ profileEligibility: elig, viewerAgencyId: v, pageSize: 1 })).total, eligNone.total)
  }
  if (viewers[0]) {
    const p1 = await listKolDirectory({ viewerAgencyId: viewers[0], page: 1, pageSize: 10, sort: 'followers' })
    const p2 = await listKolDirectory({ viewerAgencyId: viewers[0], page: 2, pageSize: 10, sort: 'followers' })
    const overlap = p1.rows.filter(r => p2.rows.some(s => s.id === r.id)).length
    eq('R: pages 1 and 2 do not overlap', overlap, 0)
    eq('R: page 1 is full', p1.rows.length, 10)
    const tiered = await listKolDirectory({ viewerAgencyId: viewers[0], tiers: ['Mid-tier'], platform: 'instagram', pageSize: 1 })
    const tieredNone = await listKolDirectory({ tiers: ['Mid-tier'], platform: 'instagram', pageSize: 1 })
    eq('R: platform + tier filter unchanged by the viewer', tiered.total, tieredNone.total)
  }

  await db.end()
  console.log(bad ? `\n${bad} check(s) FAILED` : '\nall checks passed')
  process.exit(bad ? 1 : 0)
}

main().catch(async err => {
  console.error(err)
  await db.end().catch(() => {})
  process.exit(1)
})
