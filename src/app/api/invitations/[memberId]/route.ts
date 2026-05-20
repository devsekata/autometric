import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { acceptInvitation, declineInvitation } from '@/lib/invitations/queries'

type Params = { params: Promise<{ memberId: string }> }

// POST /api/invitations/[memberId]/accept — accept a pending invitation
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId  = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { memberId } = await params
    const result = await acceptInvitation(memberId, userId)
    if (!result.ok) return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 })

    return NextResponse.json({ data: { org_slug: result.org_slug } })
  } catch (err) {
    console.error('[POST /api/invitations/[memberId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// DELETE /api/invitations/[memberId] — decline a pending invitation
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId  = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { memberId } = await params
    const ok = await declineInvitation(memberId, userId)
    if (!ok) return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 })

    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[DELETE /api/invitations/[memberId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
