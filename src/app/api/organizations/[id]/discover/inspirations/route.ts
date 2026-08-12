import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { countInspirations, toggleInspiration } from '@/lib/discover/inspirations'
import type { DiscoverSource } from '@/lib/discover/types'

type Params = { params: Promise<{ id: string }> }

const SOURCES: DiscoverSource[] = ['brand', 'competitor']

// GET /api/organizations/[id]/discover/inspirations — current saved count
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    return NextResponse.json({ count: await countInspirations(orgId) })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/inspirations]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// POST /api/organizations/[id]/discover/inspirations — toggle one post
// body: { source: 'brand'|'competitor', postRowId: number, platform: string }
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const source = body?.source
    const postRowId = Number(body?.postRowId)
    const platform = typeof body?.platform === 'string' ? body.platform : ''

    if (!SOURCES.includes(source) || !Number.isInteger(postRowId) || postRowId <= 0 || !platform) {
      return NextResponse.json(
        { error: 'source (brand|competitor), postRowId and platform are required.' },
        { status: 400 },
      )
    }

    const result = await toggleInspiration(orgId, access.userId, { source, postRowId, platform })
    return NextResponse.json({ ...result, count: await countInspirations(orgId) })
  } catch (err) {
    console.error('[POST /api/organizations/[id]/discover/inspirations]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
