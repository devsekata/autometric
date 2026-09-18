import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

/**
 * GET, PATCH, DELETE /api/brands/[brandId]
 *
 * Switched off: this endpoint reads and writes brands on the analytics warehouse; KOL public.brand has no rows and no link to social accounts. The KOL product reads the KOL database
 * only, so it answers "unavailable" instead of serving warehouse data.
 */
async function unavailable() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return featureUnavailable('Brands')
}

export async function GET() { return unavailable() }
export async function PATCH() { return unavailable() }
export async function DELETE() { return unavailable() }
