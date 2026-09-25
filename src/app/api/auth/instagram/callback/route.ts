import { featureUnavailable } from '@/lib/discover/featureUnavailable'

/**
 * GET /api/auth/instagram/callback
 *
 * Switched off with the Brands module: it finished the OAuth flow that connects a brand's Instagram account to the analytics warehouse. The KOL product uses the KOL
 * database only.
 */
export async function GET() {
  return featureUnavailable('Koneksi akun brand')
}
