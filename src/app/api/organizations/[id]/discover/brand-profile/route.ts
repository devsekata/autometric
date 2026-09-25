import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { CANONICAL_CATEGORIES, INTEREST_KEYS } from '@/lib/discover/brandMatch/model'
import {
  BrandProfileError, GENDER_MAJORITIES,
  getBrandProfile, isScoreable, saveBrandProfile, type BrandProfileInput,
} from '@/lib/discover/brandMatch/profile'
import { WHAT_MATTERS_OPTIONS } from '@/lib/discover/whatMatters/brandMatch'

type Params = { params: Promise<{ id: string }> }

/**
 * The workspace's Brand Profile — the other half of every match score.
 *
 *     Brand Profile → Brand Match Engine → public.kol_directory → Match Score
 *
 * GET is open to any member, because every member sees the match scores this
 * drives and needs to be able to read what produced them. PUT is ADMIN only:
 * editing the profile silently re-ranks the Creator Database for the whole
 * workspace, which is a workspace-level decision — the same rule `Settings` and
 * `Ordering` already carry in `DISCOVER_TABS`.
 *
 * There is no cache between the write and the next read, which is what makes
 * a saved profile reach the directory immediately and without a restart.
 */

/** The closed vocabularies the form renders, served with the profile. */
const VOCABULARY = {
  categories: CANONICAL_CATEGORIES,
  interests: INTEREST_KEYS,
  genderMajorities: GENDER_MAJORITIES,
  /**
   * The six What Matters a profile can choose, with the labels What Matters
   * itself uses. Served with the profile so the form keeps no second copy of
   * the vocabulary — and so a criterion Brand Match cannot score, `brand_safety`
   * above all, is not offerable rather than offered and silently dropped.
   */
  whatMatters: WHAT_MATTERS_OPTIONS,
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) {
      return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
    }

    const profile = await getBrandProfile(access.orgId)
    return NextResponse.json({
      profile,
      // Whether the engine can produce a Match % at all: whether this profile
      // has SELECTED anything (What Matters, or a Target Audience field). The
      // directory reads this to choose between a score and the set-up prompt,
      // rather than inferring it from a null score — a profile that has chosen
      // nothing and a creator nobody has measured are different problems with
      // different fixes.
      scoreable: isScoreable(profile),
      canEdit: access.role === 'ADMIN',
      vocabulary: VOCABULARY,
    })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/brand-profile]', err)
    return NextResponse.json({ error: 'Unable to load the brand profile.' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) {
      return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
    }
    if (access.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only an organization admin can change the brand profile.' },
        { status: 403 },
      )
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'A brand profile object is required.' }, { status: 400 })
    }

    // Partial by construction: `saveBrandProfile` keeps the stored value for
    // every key the caller did not send, so a form that edits one section
    // cannot blank the others.
    const profile = await saveBrandProfile(access.orgId, body as BrandProfileInput, access.userId)

    return NextResponse.json({
      profile,
      scoreable: isScoreable(profile),
      canEdit: true,
      vocabulary: VOCABULARY,
    })
  } catch (err) {
    // A rejected value is the caller's mistake, not a server fault, and the
    // message names the field and the allowed values so the form can show it.
    if (err instanceof BrandProfileError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('[PUT /api/organizations/[id]/discover/brand-profile]', err)
    return NextResponse.json({ error: 'Unable to save the brand profile.' }, { status: 500 })
  }
}
