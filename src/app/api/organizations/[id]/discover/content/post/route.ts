import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { getPostAnalytics, type PostSource } from '@/lib/discover/postAnalytics'

type Params = { params: Promise<{ id: string }> }

const SOURCES: PostSource[] = ['brand', 'competitor']

/**
 * GET /api/organizations/[id]/discover/content/post?source=brand&rowId=123
 *
 * One post's full analytics, for the detail a Discover card opens into. Takes
 * the same `source:rowId` pair the grid already uses as its React key, so the
 * client has nothing new to carry.
 *
 * Org membership is checked here and the row is re-checked against the org in
 * the query itself — the two id spaces are sequential integers, so scoping only
 * at this layer would let a member of any org page through another org's posts
 * by counting upwards.
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const sp = req.nextUrl.searchParams
    const source = (sp.get('source') ?? '') as PostSource
    const rowId = Number(sp.get('rowId'))

    if (!SOURCES.includes(source) || !Number.isInteger(rowId) || rowId <= 0) {
      return NextResponse.json({ error: 'Bad post reference.' }, { status: 400 })
    }

    const data = await getPostAnalytics(orgId, source, rowId)
    if (!data) return NextResponse.json({ error: 'Post tidak ditemukan.' }, { status: 404 })

    return NextResponse.json(data)
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/content/post]', err)
    return NextResponse.json({
      error: 'Something went wrong.',
      detail: process.env.NODE_ENV === 'development'
        ? String(err instanceof Error ? err.message : err)
        : undefined,
    }, { status: 500 })
  }
}
