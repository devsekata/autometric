import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { listKolDirectory, listKolFacets, MATCH_SORT, rankByMatch } from '@/lib/discover/kolDirectory'
import { matchCreators, toEligibility } from '@/lib/discover/brandMatch'
import {
  matchWhatMatters, parseMatters, CRITERIA_ORDER, CRITERIA_LABELS,
} from '@/lib/discover/whatMatters'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/organizations/[id]/discover/kol-directory
 *   ?q=&platform=&category=a,b&tier=a,b&follMin=&follMax=&minEr=&maxRate=&connected=1
 *   &growthMin=&growthMax=
 *   &createdAfter=&refreshedAfter=&sort=&dir=&page=&pageSize=&facets=1
 *
 * The roster itself is global — it is the commercial KOL platform's directory,
 * not org-scoped data — but the endpoint still requires org membership so the
 * page behaves like every other Discover surface.
 *
 * `category` and `tier` both accept a comma-separated list and union their
 * members. A single value behaves exactly as it did before, so existing callers
 * — the sidebar, the toolbar chips, saved lists in localStorage — are unaffected.
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const sp = req.nextUrl.searchParams
    /**
     * An absent param must stay absent: `Number(null)` is 0, and a `minEr` of 0
     * is not the same as no minimum — `er_pct >= 0` drops every creator whose
     * engagement rate was never measured, which is most of the roster.
     */
    const num = (key: string) => {
      const raw = sp.get(key)
      if (raw === null || raw.trim() === '') return null
      const v = Number(raw)
      return Number.isFinite(v) ? v : null
    }

    // `?ids=` fetches an explicit set — what Compare asks for. Shape-checked
    // because the column is UUID and a malformed value would fail the statement
    // rather than return nothing, and capped so a hand-made query cannot ask for
    // the whole roster at once.
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const ids = (sp.get('ids') || '')
      .split(',').map(v => v.trim()).filter(v => UUID.test(v)).slice(0, 50)

    /** `a,b` unions; a lone value behaves exactly as the single-value param did. */
    const list = (key: string) =>
      (sp.get(key) || '').split(',').map(v => v.trim()).filter(Boolean)

    /**
     * A date param is either absent or a real instant — a typo must not silently
     * become "no filter", which would answer a narrowed question with the whole
     * roster. Absent stays absent, for the same reason `num()` above does.
     */
    const badDates: string[] = []
    const date = (key: string) => {
      const raw = sp.get(key)
      if (raw === null || raw.trim() === '') return null
      const d = new Date(raw.trim())
      if (Number.isNaN(d.getTime())) { badDates.push(key); return null }
      return d
    }
    const createdAfter = date('createdAfter')
    const refreshedAfter = date('refreshedAfter')
    if (badDates.length) {
      return NextResponse.json({
        error: `Invalid date for ${badDates.join(', ')}. Expected an ISO 8601 date, e.g. 2026-08-07.`,
      }, { status: 400 })
    }

    const platform = sp.get('platform')
    const sortKey = sp.get('sort')
    const sortDir = sp.get('dir')

    const data = await listKolDirectory({
      ids,
      q: sp.get('q'),
      platform,
      categories: list('category'),
      tiers: list('tier'),
      minFollowers: num('follMin'),
      maxFollowers: num('follMax'),
      minErPct: num('minEr'),
      maxRate: num('maxRate'),
      // Growth is a signed percentage where 0 and negatives are real answers,
      // so both bounds go through `num` — which keeps an absent param absent —
      // rather than through the 0-means-any convention the other numbers use.
      minGrowth: num('growthMin'),
      maxGrowth: num('growthMax'),
      connectedOnly: sp.get('connected') === '1',
      createdAfter,
      refreshedAfter,
      sort: sortKey,
      dir: sortDir,
      page: num('page') ?? 1,
      // An explicit id list is the page: paging it would drop selections.
      pageSize: ids.length ? ids.length : (num('pageSize') ?? 20),
    })

    // Facets are requested on the first load and again when the platform
    // changes, because the tier counts are scoped to it (BE-02).
    if (sp.get('facets') === '1') data.facets = await listKolFacets({ platform })

    /**
     * Brand Match, for the creators on this page.
     *
     * Opt-in via `?match=1` rather than always, because it is six extra reads
     * against the KOL server and not every caller shows a score. It costs
     * nothing for an org with no saved profile: `matchCreators` returns before
     * it queries anything.
     *
     * Scored over `data.rows` — the page that was actually returned — so the
     * number a creator wears is a function of that creator and the brand, and
     * of nothing else on screen. Deliberately the ABSOLUTE Final Match Score:
     * normalising against the page maximum would move every score when the user
     * pressed Next, and the Match Status bands are defined against the absolute.
     */
    if (sp.get('match') === '1') {
      const { profile, scoreable, matches, measured } =
        await matchCreators(orgId, data.rows.map(r => r.id))
      data.match = {
        scoreable,
        brandName: profile.brandName,
        brandCategory: profile.brandCategory,
        updatedAt: profile.updatedAt,
        // The Ideal Creator Profile, returned rather than applied. Silently
        // narrowing the roster to a saved preference would make the result count
        // disagree with the filters the user can see; the UI offers it as a
        // one-press filter set instead.
        eligibility: toEligibility(profile),
        rows: Object.fromEntries(matches),
        measured: Object.fromEntries(measured),
      }

      /**
       * `sort=match` — re-rank THIS PAGE by the score just computed.
       *
       * Page-scoped, and deliberately so: see `MATCH_SORT` in `kolDirectory`.
       * The page was selected and ordered by the follower ordering that
       * `SORT_COLUMNS.match` aliases to, so which creators are on it does not
       * depend on the score; only their order within it does. Paging, filters,
       * `total` and `pageSize` are untouched.
       *
       * The ordering itself lives in `rankByMatch` — unscored last in both
       * directions, nothing coerced into a number, stable on ties. It is a pure
       * function there so `verify:match-sort` can check those three properties
       * without a database or a running route.
       */
      if (sortKey === MATCH_SORT && scoreable) {
        data.rows = rankByMatch(data.rows, r => matches.get(r.id)?.score ?? null, sortDir)
      }
    }

    /**
     * What Matters Most, for the creators on this page.
     *
     * Opt-in via `?matters=engagement,reach,...` — absent means the caller does
     * not show it and nothing is computed. Unknown keys are dropped by
     * `parseMatters` rather than failing the request, so a newer UI can send a
     * criterion this build does not know yet.
     *
     * Scored HERE and nowhere else. The response carries the per-criterion
     * scores, the average over the selected ones, and how many of them actually
     * contributed — so the client renders numbers rather than deriving them. A
     * criterion the database cannot answer arrives as `null` and must be drawn
     * as unmeasured; it is not a zero and must never be averaged as one.
     *
     * `criteria` ships the canonical key/label list with the page so the UI does
     * not keep a second copy of the seven names that could drift from the
     * engine's.
     */
    const matters = parseMatters(sp.get('matters'))
    if (matters.length) {
      const scored = await matchWhatMatters(data.rows.map(r => r.id), matters)
      data.whatMatters = {
        selected: matters,
        criteria: CRITERIA_ORDER.map(key => ({ key, label: CRITERIA_LABELS[key] })),
        rows: Object.fromEntries(scored),
      }
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/kol-directory]', err)
    return NextResponse.json({
      error: 'Something went wrong.',
      // The KOL database sits on a private network, so "it failed" is rarely
      // enough to act on locally: in development the page shows the real reason
      // (unreachable host, missing PG_*_KOL, bad credentials).
      detail: process.env.NODE_ENV === 'development'
        ? String(err instanceof Error ? err.message : err)
        : undefined,
    }, { status: 500 })
  }
}
