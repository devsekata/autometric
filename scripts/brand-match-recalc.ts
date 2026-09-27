/**
 * Recalculates Brand Match in the background and stores it (brand_match_result).
 *
 *   npm run brand-match:recalc -- --all --trigger kol_data
 *   npm run brand-match:recalc -- --agency <agency id> --trigger brand_profile
 *
 * Run by the Dagster `brand_match_job` (scrapper-project,
 * orchestration/kol_orchestration/brand_match.py), which is triggered by:
 *   * `brand_profile_changed_sensor`  — a Brand Profile was saved
 *   * `brand_match_after_transform`   — transform_chain_job reached L2
 *
 * Uses the existing Brand Match calculation (`whatMatters/brandMatch.ts`) on the
 * KOL database only. Prints one JSON line per agency; exits 1 if any agency
 * failed, so the Dagster run fails and is retried.
 */
import {
  agenciesToRecalculate, recalculateBrandMatch, type BrandMatchTrigger,
} from '@/lib/discover/whatMatters/brandMatchStore'

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : undefined
}

;(async () => {
  const trigger = (arg('--trigger') ?? 'manual') as BrandMatchTrigger
  if (!['brand_profile', 'kol_data', 'manual'].includes(trigger)) throw new Error(`unknown --trigger ${trigger}`)
  const one = arg('--agency')
  const agencies = one ? [one] : process.argv.includes('--all') ? await agenciesToRecalculate() : []
  if (!agencies.length && !process.argv.includes('--all')) throw new Error('pass --all or --agency <id>')

  let failed = 0
  for (const agencyId of agencies) {
    const started = Date.now()
    try {
      const out = await recalculateBrandMatch(agencyId, trigger)
      console.log(JSON.stringify({ ...out, trigger, ms: Date.now() - started }))
    } catch (err) {
      failed++
      console.log(JSON.stringify({
        agencyId, status: 'failed', trigger, ms: Date.now() - started,
        error: String(err instanceof Error ? err.message : err),
      }))
    }
  }
  console.log(JSON.stringify({ summary: true, agencies: agencies.length, failed, trigger }))
  process.exit(failed ? 1 : 0)
})().catch(err => {
  console.error(err)
  process.exit(1)
})
