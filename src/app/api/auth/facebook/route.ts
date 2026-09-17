import { featureUnavailable } from '@/lib/discover/featureUnavailable'

/**
 * GET /api/auth/facebook
 *
 * Switched off with the Brands module: it started the OAuth flow that connects a brand's Facebook page to the analytics warehouse. The KOL product uses the KOL
 * database only.
 */
export async function GET() {
  return featureUnavailable('Koneksi akun brand')
}
