import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { checkCreatorAccount } from '@/lib/discover/creatorIntake'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/organizations/[id]/discover/creators/check
 *   { platform: 'instagram' | 'tiktok' | 'facebook', input: '<@handle or profile URL>' }
 *
 * Runs the five validation checks and returns one of the modal's result screens
 * (see `CheckResult`). Nothing is written — this endpoint only looks.
 *
 * A POST rather than a GET despite being read-only: the handle is user input
 * that would otherwise sit in a URL, in logs and in browser history, and the
 * call costs an Apify run, which is not something a link should be able to
 * trigger by being visited.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => ({})) as { platform?: unknown; input?: unknown }
    const platform = typeof body.platform === 'string' ? body.platform : ''
    const input = typeof body.input === 'string' ? body.input : ''

    if (!platform || !input.trim()) {
      return NextResponse.json({ error: 'Both a platform and a username or profile URL are required.' }, { status: 400 })
    }

    return NextResponse.json(await checkCreatorAccount(orgId, platform, input))
  } catch (err) {
    console.error('[POST /api/organizations/[id]/discover/creators/check]', err)
    return NextResponse.json({
      error: 'The check could not be completed.',
      detail: process.env.NODE_ENV === 'development'
        ? String(err instanceof Error ? err.message : err)
        : undefined,
    }, { status: 500 })
  }
}
