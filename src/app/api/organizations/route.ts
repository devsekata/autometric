import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { listOrgsForUser, createOrg } from '@/lib/organizations/queries'
import { generateSlug } from '@/lib/organizations/slug'

// GET /api/organizations — list all orgs for the logged-in user
export async function GET() {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orgs = await listOrgsForUser(userId)
    return NextResponse.json({ data: orgs })
  } catch (err) {
    console.error('[GET /api/organizations]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// POST /api/organizations — create a new organization
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const name = typeof body?.name === 'string' ? body.name.trim() : ''

    if (!name) {
      return NextResponse.json({ error: 'Organization name is required.' }, { status: 400 })
    }
    if (name.length > 255) {
      return NextResponse.json({ error: 'Organization name is too long.' }, { status: 400 })
    }

    const slug = generateSlug(name)
    const org = await createOrg(name, slug, userId)

    return NextResponse.json({ data: org }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/organizations]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
