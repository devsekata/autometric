import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { listDirectory } from '@/lib/discover/directory'

type Params = { params: Promise<{ id: string }> }

// GET /api/organizations/[id]/discover/directory?brand=
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const data = await listDirectory(orgId, req.nextUrl.searchParams.get('brand') || null)
    return NextResponse.json(data)
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/directory]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
