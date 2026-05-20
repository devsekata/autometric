import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import {
  getOrgForUser,
  updateOrg,
  deleteOrg,
  getMemberRole,
} from '@/lib/organizations/queries'

type Params = { params: Promise<{ id: string }> }

// GET /api/organizations/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const org = await getOrgForUser(id, userId)
    if (!org) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })

    return NextResponse.json({ data: org })
  } catch (err) {
    console.error('[GET /api/organizations/[id]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// PATCH /api/organizations/[id] — Admin only
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const role = await getMemberRole(id, userId)
    if (!role) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })
    if (role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden. Only Admins can update the organization.' }, { status: 403 })

    const body = await req.json()
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'Organization name is required.' }, { status: 400 })
    if (name.length > 255) return NextResponse.json({ error: 'Organization name is too long.' }, { status: 400 })

    const org = await updateOrg(id, name)
    if (!org) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })

    return NextResponse.json({ data: org })
  } catch (err) {
    console.error('[PATCH /api/organizations/[id]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// DELETE /api/organizations/[id] — Admin only
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const role = await getMemberRole(id, userId)
    if (!role) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })
    if (role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden. Only Admins can delete an organization.' }, { status: 403 })

    const deleted = await deleteOrg(id)
    if (!deleted) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })

    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[DELETE /api/organizations/[id]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
