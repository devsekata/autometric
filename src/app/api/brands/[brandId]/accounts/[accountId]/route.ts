import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

type Params = { params: Promise<{ brandId: string; accountId: string }> }

/**
 * DELETE /api/brands/[brandId]/accounts/[accountId]
 *
 * Switched off: this endpoint reads or writes the analytics warehouse, and the
 * KOL product uses the KOL database only. It answers "unavailable" until its
 * data has a source of truth on the KOL server.
 */
async function unavailable(params: Params['params']) {
  void params
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return featureUnavailable('Brands')
}

export async function DELETE(_req: NextRequest, { params }: Params) { return unavailable(params) }
