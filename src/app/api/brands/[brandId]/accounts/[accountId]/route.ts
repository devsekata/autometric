import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

/**
 * DELETE /api/brands/[brandId]/accounts/[accountId]
 *
 * Switched off: this endpoint links OAuth social accounts to brands on the analytics warehouse; KOL social accounts are creator accounts only. The KOL product reads the KOL database
 * only, so it answers "unavailable" instead of serving warehouse data.
 */
async function unavailable() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return featureUnavailable('Brand accounts')
}

export async function DELETE() { return unavailable() }
