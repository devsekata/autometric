import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, addCompetitor, listBrandCompetitors, countBrandCompetitorsOnPlatform } from '@/lib/brands/queries'
import { PLATFORM_LIST, PLATFORM_CONFIG, type Platform } from '@/lib/brands/types'
import { MAX_COMPETITORS_PER_PLATFORM, competitorQuotaMessage } from '@/lib/quotas'
import {
  initialFbCompetitorSync, initialTiktokCompetitorSync, initialIgCompetitorSync,
  type SyncLeg,
} from '@/lib/apify/sync'
import {
  competitorHasSnapshot, markCompetitorVerified,
  deleteCompetitorLinks, recordCompetitorVerifyError,
} from '@/lib/competitors/queries'
import {
  precheckAccount, notFoundMessage, outcomeFromScrape, outcomeFromProfileLeg,
  isValidHandle, invalidHandleMessage, type VerifyOutcome,
} from '@/lib/competitors/verify'
import { logInitialScrape, summarizeScrapeResult, type ScrapeResult } from '@/lib/monitoring/logger'
import { COMPETITOR_ADD_ENABLED } from '@/lib/featureFlags'

type Params = { params: Promise<{ brandId: string }> }

// GET /api/brands/[brandId]/competitors
// Returns the brand's competitors with their (possibly backfilled) avatars.
// Used by the client to poll for Facebook avatars that land after the async Apify sync.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    const competitors = await listBrandCompetitors(brandId)
    return NextResponse.json({ data: competitors })
  } catch (err) {
    console.error('[GET /api/brands/[brandId]/competitors]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// POST /api/brands/[brandId]/competitors
export async function POST(req: NextRequest, { params }: Params) {
  try {
    // Adding competitors is temporarily disabled app-wide (see @/lib/featureFlags).
    if (!COMPETITOR_ADD_ENABLED) {
      return NextResponse.json({ error: 'Adding competitors is temporarily disabled.' }, { status: 403 })
    }

    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    const body = await req.json()
    const platform = typeof body?.platform === 'string' ? body.platform.trim() : ''
    const username  = typeof body?.username  === 'string' ? body.username.trim().replace(/^@/, '') : ''

    if (!platform || !PLATFORM_LIST.includes(platform as never)) {
      return NextResponse.json({ error: 'Valid platform is required.' }, { status: 400 })
    }
    if (!username) {
      return NextResponse.json({ error: 'Username is required.' }, { status: 400 })
    }
    // Handle berspasi/berkarakter aneh membuat actor Apify menolak start-run
    // ("must match pattern …"), bukan sekadar tidak menemukan akunnya — jadi
    // ditolak di sini sebelum ada baris yang dibuat.
    if (!isValidHandle(platform, username)) {
      return NextResponse.json({ error: invalidHandleMessage(platform, username) }, { status: 400 })
    }

    // Quota is per platform, so a full Instagram slot doesn't block TikTok/Facebook.
    // Username ini dikecualikan dari hitungan: menambahkan ulang yang sudah ada
    // tidak memakai slot baru, sehingga percobaan ulang tidak tertolak 409.
    if (await countBrandCompetitorsOnPlatform(brandId, platform, username) >= MAX_COMPETITORS_PER_PLATFORM) {
      return NextResponse.json(
        { error: competitorQuotaMessage(PLATFORM_CONFIG[platform as Platform].label) },
        { status: 409 }
      )
    }

    // ── Pre-check: tangkap salah tulis SEBELUM ada baris dibuat ──
    // Hanya 'not_found' yang menolak; 'exists' bukan jaminan dan 'unknown' bukan
    // bukti apa-apa, jadi keduanya diteruskan ke verifikasi Apify di background.
    // Saat ini hanya TikTok yang punya lookup publik yang bisa dipercaya dari
    // server — alasannya, beserta hasil pengujiannya, ada di @/lib/competitors/verify.
    const pre = await precheckAccount(platform, username)
    if (pre.state === 'not_found') {
      return NextResponse.json({ error: notFoundMessage(platform, username) }, { status: 404 })
    }
    if (pre.state === 'unknown') {
      console.warn(`[competitors] pre-check @${username} (${platform}) inconclusive: ${pre.reason}`)
    }

    let profile: { avatarUrl?: string; profileUrl?: string; platformUserId?: string } | undefined

    if (platform === 'instagram') {
      // Instagram profile (incl. avatar) is fetched in the background Apify sync —
      // runs take minutes, so we don't block. Avatar/platform_user_id are
      // backfilled by initialIgCompetitorSync.
      profile = { profileUrl: `https://www.instagram.com/${username}` }
    } else if (platform === 'facebook') {
      // Facebook profile (incl. avatar) is fetched in the background sync —
      // Apify runs take minutes, so we don't block the request. Store the page
      // URL now; avatar/platform_user_id are backfilled by initialFbCompetitorSync.
      profile = { profileUrl: `https://www.facebook.com/${username}` }
    } else if (platform === 'tiktok') {
      // TikTok profile (incl. avatar) is fetched in the background Apify sync —
      // runs take minutes, so we don't block. Avatar/platform_user_id are
      // backfilled by initialTiktokCompetitorSync.
      profile = { profileUrl: `https://www.tiktok.com/@${username}` }
    }

    const competitor = await addCompetitor(brandId, platform, username, profile)

    // Fire-and-forget: initial sync ke l0_raw (profile + posts 30 hari).
    // Skip hanya jika competitor INI sudah punya snapshot (sudah pernah di-sync,
    // shared antar brand/org). Jangan pakai is_new_account: social_accounts row
    // bisa tersisa sebagai orphan setelah removeCompetitor, sehingga re-add tidak
    // pernah ter-sync padahal datanya kosong.
    const accountId     = competitor.social_account_id
    const alreadySynced = await competitorHasSnapshot(accountId, platform)

    if (alreadySynced) {
      // Snapshot-nya sudah ada, artinya akun ini pernah berhasil di-scrape —
      // keberadaannya sudah terbukti. Langsung 'verified', tanpa Apify run baru.
      await markCompetitorVerified(accountId)
      competitor.verification_status = 'verified'
    } else {
      // Record each initial competitor scrape in initial_scrape_logs once it finishes.
      // Fire-and-forget: Apify runs take minutes, so we don't block the response — the
      // log write is chained onto the sync's completion.
      const startedAt = new Date()
      const logScrape = (result: ScrapeResult) => {
        const finishedAt = new Date()
        return logInitialScrape({
          socialAccountId: accountId, platform, brandId, orgId,
          ...summarizeScrapeResult(result),
          startedAt, finishedAt,
        }).catch(e => console.error('[competitor initial-scrape] log failed:', e))
      }

      // Verifikasi definitif: naikkan ke 'verified', atau lepaskan linknya kalau
      // platform memastikan akunnya tidak ada. Error transien (Apify 500, fetch
      // failed, timeout) dibiarkan 'pending' supaya scheduler harian mengulang —
      // menghapus di kasus itu berarti membuang competitor yang valid.
      const resolveVerification = async (outcome: VerifyOutcome) => {
        if (outcome.state === 'verified') return markCompetitorVerified(accountId)
        if (outcome.state === 'not_found') {
          const removed = await deleteCompetitorLinks(accountId)
          console.warn(
            `[competitors] @${username} (${platform}) tidak ada — ${removed} link dilepas: ${outcome.error}`)
          return
        }
        console.warn(`[competitors] verifikasi @${username} (${platform}) ditunda: ${outcome.error}`)
        return recordCompetitorVerifyError(accountId, outcome.error)
      }

      // Putuskan begitu PROFIL-nya turun, jangan tunggu kaki posts.
      //
      // Keduanya jalan berbarengan, tapi cuma profil yang menentukan (lihat
      // outcomeFromProfileLeg) dan kaki posts jauh lebih lama — 30 hari, sampai
      // 1000 post, bisa bermenit-menit. Menunggunya berarti user menatap spinner
      // untuk pekerjaan yang jawabannya tidak dipakai, dan sering baru dapat
      // jawaban setelah UI-nya menyerah di 2 menit.
      const onProfileSettled = (leg: SyncLeg) => {
        resolveVerification(outcomeFromProfileLeg(leg))
          .catch(e => console.error('[competitor verify] gagal:', e))
      }

      // Instagram: fire-and-forget Apify sync (profile + posts 30 hari)
      if (platform === 'instagram') {
        initialIgCompetitorSync(accountId, username, { onProfileSettled })
          .then(logScrape)
          .catch(err => console.error('[ig competitor initial-sync]', err))
      }

      // Facebook: fire-and-forget Apify sync (profile + posts 30 hari)
      if (platform === 'facebook') {
        initialFbCompetitorSync(accountId, username, { onProfileSettled })
          .then(logScrape)
          .catch(err => console.error('[fb competitor initial-sync]', err))
      }

      // TikTok: fire-and-forget Apify sync (profile + posts 30 hari).
      // Satu actor run membawa profil DAN posts, jadi tidak ada yang bisa
      // diputuskan lebih awal — verifikasinya dari hasil lengkap.
      if (platform === 'tiktok') {
        initialTiktokCompetitorSync(accountId, username)
          .then(result => Promise.all([
            logScrape(result),
            resolveVerification(outcomeFromScrape(result)),
          ]))
          .catch(err => console.error('[tiktok competitor initial-sync]', err))
      }
    }

    return NextResponse.json({ data: competitor }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/brands/[brandId]/competitors]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
