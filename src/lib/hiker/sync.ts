import { fetchAllHikerIgMedias, HikerIgUser } from './client'
import { saveCompetitorSnapshot, saveCompetitorMedias } from './queries'

const COMPETITOR_POST_DAYS = 30

export type CompetitorSyncResult = {
  ig_competitor_profile: { count: number; error: string | null }
  ig_competitor_posts:   { count: number; error: string | null }
}

export async function initialCompetitorSync(
  socialAccountId: string,
  hikerUser: HikerIgUser,
): Promise<CompetitorSyncResult> {
  const [profileResult, postsResult] = await Promise.allSettled([
    // 1. Profile snapshot (today)
    (async () => {
      await saveCompetitorSnapshot(socialAccountId, hikerUser)
      return 1
    })(),

    // 2. Posts — last 30 days
    (async () => {
      const items = await fetchAllHikerIgMedias(hikerUser.pk, COMPETITOR_POST_DAYS)
      await saveCompetitorMedias(socialAccountId, items)
      return items.length
    })(),
  ])

  const errMsg = (r: PromiseSettledResult<unknown>) =>
    r.status === 'rejected'
      ? (r.reason instanceof Error ? r.reason.message : String(r.reason))
      : null

  return {
    ig_competitor_profile: profileResult.status === 'fulfilled'
      ? { count: 1,                          error: null }
      : { count: 0,                          error: errMsg(profileResult) },
    ig_competitor_posts:   postsResult.status === 'fulfilled'
      ? { count: postsResult.value as number, error: null }
      : { count: 0,                           error: errMsg(postsResult) },
  }
}
