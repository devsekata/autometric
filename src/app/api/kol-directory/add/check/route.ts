import { NextRequest, NextResponse } from 'next/server'
import { requireAgencyMember } from '@/lib/kolDirectory/agencyAccess'
import { checkKolExists, type AddKolPlatform } from '@/lib/kolDirectory/addKolCheck'

/**
 * POST /api/kol-directory/add/check
 *
 * "Add New KOL" — step one. `kol_directory` itself is not org-scoped, but
 * this is the first step of a flow that writes to it on an agency's behalf,
 * so the caller must be an active member of `orgId`.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const access = await requireAgencyMember(body?.orgId)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
    const platform = body?.platform as AddKolPlatform | undefined
    const input = body?.input as string | undefined

    if (platform !== 'instagram' && platform !== 'tiktok') {
      return NextResponse.json({ error: 'platform must be "instagram" or "tiktok".' }, { status: 400 })
    }
    if (typeof input !== 'string' || !input.trim()) {
      return NextResponse.json({ error: 'input is required.' }, { status: 400 })
    }

    const result = await checkKolExists(platform, input)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[POST /api/kol-directory/add/check]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
