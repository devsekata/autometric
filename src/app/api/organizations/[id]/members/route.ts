import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getMemberRole } from '@/lib/organizations/queries'
import { getMembersByOrgId, inviteMember } from '@/lib/organizations/members'

type Params = { params: Promise<{ id: string }> }

// GET /api/organizations/[id]/members
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const role = await getMemberRole(id, userId)
    if (!role) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })

    const members = await getMembersByOrgId(id)
    return NextResponse.json({ data: members })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/members]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// POST /api/organizations/[id]/members — any member can invite
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const requesterRole = await getMemberRole(id, userId)
    if (!requesterRole) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })

    const body = await req.json()
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const role  = body?.role

    if (!email) return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
    if (!['ADMIN', 'MEMBER'].includes(role)) {
      return NextResponse.json({ error: 'Role must be ADMIN or MEMBER.' }, { status: 400 })
    }

    const result = await inviteMember(id, email, role as 'ADMIN' | 'MEMBER', userId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 })

    return NextResponse.json({ data: result.member }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/organizations/[id]/members]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
