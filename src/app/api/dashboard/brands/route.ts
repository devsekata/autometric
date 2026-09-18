import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

/**
 * GET /api/dashboard/brands
 *
 * Switched off: this endpoint reads brand analytics (l2_gold/l1_silver) from the analytics warehouse; the KOL database has no brand-level source for it. The KOL product reads the KOL database
 * only, so it answers "unavailable" instead of serving warehouse data.
 */
async function unavailable() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return featureUnavailable('Dashboard')
}

export async function GET() { return unavailable() }
