import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

/**
 * DELETE /api/brands/[brandId]/competitors/[socialAccountId]
 *
 * Switched off: this endpoint reads and writes brand_competitors and competitor snapshots on the analytics warehouse. The KOL product reads the KOL database
 * only, so it answers "unavailable" instead of serving warehouse data.
 */
async function unavailable() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return featureUnavailable('Competitors')
}

export async function DELETE() { return unavailable() }
