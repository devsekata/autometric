import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getPendingInvitationsForUser } from '@/lib/invitations/queries'

// GET /api/invitations — pending invitations for the current user
export async function GET() {
  try {
    const session = await auth()
    const userId  = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const invitations = await getPendingInvitationsForUser(userId)
    return NextResponse.json({ data: invitations })
  } catch (err) {
    console.error('[GET /api/invitations]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
