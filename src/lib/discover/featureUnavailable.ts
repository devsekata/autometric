import { NextResponse } from 'next/server'

/**
 * The API answer for a Discover feature whose data still lives on the analytics
 * warehouse. The KOL product reads the KOL database only, so these endpoints
 * are switched off rather than served from the warehouse.
 */
export function featureUnavailable(feature: string) {
  return NextResponse.json(
    { error: `${feature} sementara tidak tersedia.`, code: 'feature_unavailable' },
    { status: 503 },
  )
}
