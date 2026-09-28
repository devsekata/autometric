import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { listKolDirectory, listKolFacets, type ProfileEligibility } from '@/lib/discover/kolDirectory'
import { getBrandProfile } from '@/lib/discover/brandMatch/profile'
import { scoringRecordsFor } from '@/lib/discover/brandMatch/records'
import { measuredSignals } from '@/lib/discover/brandMatch/measured'
import { brandMatchForDirectory } from '@/lib/discover/whatMatters/brandMatch'
import { storedBrandMatchForDirectory } from '@/lib/discover/whatMatters/brandMatchStore'
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

    /**
     * Brand Profile eligibility — `?brandProfile=1`, sent by the main Creator
     * Database list only.
     *
     * The saved Ideal Creator Profile is the base of that list: Preferred
     * platforms, Preferred creator tier and Preferred creator categories become
     * hard filters, AND-ed with whatever the user sets in the filter panel.
     * Read from the KOL server on every request, so a saved profile applies on
     * the next load with no cache to clear.
     *
     * Deliberately NOT filters: Target Audience (gender, age, country, city,
     * interests) and What Matters are Brand Match criteria — they score, they
     * do not exclude; brand category is the brand's own industry; content style
     * has no creator-side data.
     *
     * Never applied to `?ids=`: Compare, Cart and the Brand Match request fetch
     * creators already picked, and must get exactly those back.
     */
    let profileEligibility: ProfileEligibility | null = null
    if (sp.get('brandProfile') === '1' && !ids.length) {
      const p = await getBrandProfile(access.orgId)
      const e: ProfileEligibility = {
        platforms: p.preferredPlatforms.length ? p.preferredPlatforms : null,
        tiers: p.preferredTiers.length ? p.preferredTiers : null,
        categoryKeys: p.preferredCategories.length ? p.preferredCategories : null,
      }
      if (e.platforms || e.tiers || e.categoryKeys) profileEligibility = e
    }

    const data = await listKolDirectory({
      ids,
      profileEligibility,
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
      // Audience filters — same parameter names as the reconcile branch.
      minFemalePct: num('femaleMin'),
      minMalePct: num('maleMin'),
      audienceQualityTier: list('audQuality'),
      audienceGeoKey: sp.get('geoKey'),
      audienceGeoLevel: sp.get('geoLevel'),
      audienceGender: sp.get('audGender'),
      audienceAge: sp.get('audAge'),
      connectedOnly: sp.get('connected') === '1',
      createdAfter,
      refreshedAfter,
      sort: sortKey,
      dir: sortDir,
      page: num('page') ?? 1,
      // An explicit id list is the page: paging it would drop selections.
      pageSize: ids.length ? ids.length : (num('pageSize') ?? 20),
    })

    if (profileEligibility) data.profileEligibility = profileEligibility

    // Facets are requested on the first load and again when the platform
    // changes, because the tier counts are scoped to it (BE-02).
    if (sp.get('facets') === '1') data.facets = await listKolFacets({ platform })

    /**
     * The measured creator signals for this page — `?measured=1`.
     *
     * Creator facts only: authenticity, audience quality, growth, views,
     * cadence. Nothing about a brand enters them, which is why they ride the
     * list request while Brand Match is asked for separately. Opt-in because
     * they cost extra reads against the KOL server and not every caller draws
     * them.
     */
    if (sp.get('measured') === '1') {
      const records = await scoringRecordsFor(data.rows.map(r => r.id))
      data.measured = Object.fromEntries(
        [...records].map(([id, record]) => [id, measuredSignals(record)]))
    }

    /**
     * Brand Match, for the creators asked for — `?ids=…&match=1`.
     *
     * ONE engine: `whatMatters/brandMatch`. Match % is the plain mean of this
     * creator's What Matters scores on the criteria the workspace's Brand
     * Profile chose, plus one score per Target Audience field it filled in
     * (`whatMatters/audienceMatch`), read from the KOL server only. Equal
     * weight per criterion, and a criterion this creator cannot be measured on
     * leaves the DENOMINATOR — it is never scored as zero. With nothing chosen
     * `brandMatch.unavailable` is `no_selection` and nobody is scored.
     *
     * The choice comes from the authorised agency's own Brand Profile
     * (`public.agencies.id`), never from the query string: a caller cannot ask
     * to be scored on criteria its workspace did not choose.
     *
     * Asked for by id and in its own request, so the list never depends on it:
     * if Brand Match cannot be answered, the directory still loads.
     */
    if (sp.get('match') === '1') {
      const profile = await getBrandProfile(access.orgId)
      // Shadows the `?ids=` list on purpose: this is the page that was actually
      // returned, which is that list whenever the caller sent one.
      const ids = data.rows.map(r => r.id)
      // The background result (`brand_match_result`) while it is still current
      // for this profile and this state of the KOL data; otherwise on demand.
      data.brandMatch =
        await storedBrandMatchForDirectory(access.orgId, ids, profile.whatMatters, profile)
        ?? await brandMatchForDirectory(ids, profile.whatMatters, profile)
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
