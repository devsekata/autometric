import { featureUnavailable } from '@/lib/discover/featureUnavailable'

/**
 * GET /api/csv/categories
 *
 * Switched off with the Brands module: it asks mapping-engine, a service that reads the analytics warehouse, for CSV categories. The KOL product uses the KOL
 * database only.
 */
export async function GET() {
  return featureUnavailable('Upload CSV brand')
}
