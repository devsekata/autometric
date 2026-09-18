import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

/**
 * GET /api/brands/[brandId]/instagram/stories/raw
 *
 * Switched off: this endpoint fetches and stores brand-owned account data on the analytics warehouse. The KOL product reads the KOL database
 * only, so it answers "unavailable" instead of serving warehouse data.
 */
async function unavailable() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return featureUnavailable('Brand sync')
}

export async function GET() { return unavailable() }
