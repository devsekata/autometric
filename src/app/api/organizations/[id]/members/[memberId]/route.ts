import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getMemberRole } from '@/lib/organizations/queries'
import { removeMember, updateMemberRole } from '@/lib/organizations/members'
import pool from '@/lib/db'

type Params = { params: Promise<{ id: string; memberId: string }> }

// PATCH /api/organizations/[id]/members/[memberId] — Admin only: change role
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id, memberId } = await params
    const requesterRole = await getMemberRole(id, userId)
    if (!requesterRole) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })
    if (requesterRole !== 'ADMIN') return NextResponse.json({ error: 'Forbidden. Only Admins can change roles.' }, { status: 403 })

    const body = await req.json()
    const role = body?.role
    if (!['ADMIN', 'MEMBER'].includes(role)) {
      return NextResponse.json({ error: 'Role must be ADMIN or MEMBER.' }, { status: 400 })
    }

    // Prevent downgrading the last admin
    if (role === 'MEMBER') {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM organization_members
         WHERE organization_id = $1 AND role = 'ADMIN' AND status = 'ACTIVE'`,
        [id]
      )
      if (parseInt(rows[0].count) <= 1) {
        return NextResponse.json(
          { error: 'Cannot change role. The organization must have at least one Admin.' },
          { status: 409 }
        )
      }
    }

    const ok = await updateMemberRole(memberId, id, role as 'ADMIN' | 'MEMBER')
    if (!ok) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/organizations/[id]/members/[memberId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// DELETE /api/organizations/[id]/members/[memberId]
// Admin can remove anyone; any member can remove themselves (leave)
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id, memberId } = await params
    const requesterRole = await getMemberRole(id, userId)
    if (!requesterRole) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })

    // Check if the requester is removing themselves (leave)
    const { rows: target } = await pool.query<{ user_id: string | null }>(
      `SELECT user_id FROM organization_members WHERE id = $1 AND organization_id = $2`,
      [memberId, id]
    )
    const isSelf = target[0]?.user_id === userId

    if (!isSelf && requesterRole !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Only Admins can remove members.' }, { status: 403 })
    }

    const ok = await removeMember(memberId, id)
    if (!ok) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })

    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[DELETE /api/organizations/[id]/members/[memberId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
