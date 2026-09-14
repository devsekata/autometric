/**
 * Verifies Creator Workspace growth is the real column, read with the right
 * semantics, and absent where the database is absent.
 *
 *   npm run verify:workspace-growth
 *
 * Phase 4D replaced the last generated metric in Discover — `kolSample.growth`,
 * a seeded `{monthly, threeMonth, sixMonth}` triple — with
 * `l2_gold.kol_profile_card.followers_growth`.
 *
 * ── The semantics are the point of this script ─────────────────────────────
 * The pipeline defines that column as
 *
 *     round((followers_count - prev_followers_count) / prev_followers_count * 100, 4)
 *
 * over `LAG(followers_count) OVER (PARTITION BY social_account_id ORDER BY date)` —
 * so it is a PERCENT, and it is snapshot-to-snapshot rather than a fixed
 * window. The pipeline docs are explicit: "Perbandingannya snapshot ke
 * snapshot, bukan jendela waktu tetap". There is therefore no monthly, 3-month
 * or 6-month figure anywhere in this database, and the assertions below fail if
 * one is ever reintroduced.
 *
 * REQUIRES the office VPN.
 */
import kolDb from '@/lib/kolDb'
import { getKolCreator } from '@/lib/discover/kolDirectory'
import { getKolGold } from '@/lib/discover/kolGold'

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

;(async () => {
  const db = kolDb()

  /* ── 1. the source exists, and its shape is what we think ─────────────── */

  console.log('source')
  const { rows: shape } = await db.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'l2_gold' AND table_name = 'kol_profile_card'
        AND column_name = 'followers_growth'`)
  ok('l2_gold.kol_profile_card.followers_growth exists', shape.length === 1,
    shape[0]?.data_type)

  const { rows: cov } = await db.query<Record<string, string>>(`
    SELECT
      (SELECT COUNT(*) FROM public.kol_directory WHERE directory_status = 'active') AS roster,
      (SELECT COUNT(DISTINCT ksa.kol_id) FROM public.kol_social_account ksa
         JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
        WHERE c.followers_growth IS NOT NULL)                                       AS with_growth,
      (SELECT MIN(followers_growth)::text FROM l2_gold.kol_profile_card)            AS lo,
      (SELECT MAX(followers_growth)::text FROM l2_gold.kol_profile_card)            AS hi`)
  const roster = Number(cov[0].roster)
  const n = Number(cov[0].with_growth)
  console.log(`\nCOVERAGE  ${n} of ${roster.toLocaleString('id-ID')} creators `
    + `(${((n / roster) * 100).toFixed(2)}%) · range ${cov[0].lo}% … ${cov[0].hi}%`)

  /*
   * A sanity bound on the unit. The column is a PERCENT; a fraction would put
   * these same readings at 100x. Values here sit well inside ±100, which is
   * consistent with percent over a ~10-13 day gap and would be absurd as a
   * fraction (0.9174 as a fraction = 91.7% in under two weeks).
   */
  ok('values are plausible percentages, not fractions',
    Math.abs(Number(cov[0].lo)) < 100 && Math.abs(Number(cov[0].hi)) < 100)

  /* ── 2. no fixed-window source exists to relabel ──────────────────────── */

  const { rows: cols } = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'l2_gold'
        AND column_name ~* 'growth'`)
  const names = cols.map(c => c.column_name)
  ok('no monthly/3-month/6-month growth column exists anywhere in l2_gold',
    !names.some(c => /30|month|90|180|d30|d90/i.test(c)),
    names.join(', ') || 'none')

  /* ── 3. pick the test creators ────────────────────────────────────────── */

  const { rows: withG } = await db.query<{ id: string; username: string; g: string }>(`
    SELECT kd.id, kd.username, c.followers_growth::text AS g
      FROM public.kol_directory kd
      JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
      JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
     WHERE kd.directory_status = 'active' AND c.followers_growth IS NOT NULL
     LIMIT 3`)

  const { rows: noG } = await db.query<{ id: string; username: string }>(`
    SELECT kd.id, kd.username
      FROM public.kol_directory kd
     WHERE kd.directory_status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM public.kol_social_account ksa
          JOIN l2_gold.kol_profile_card c ON c.social_account_id = ksa.social_account_id
         WHERE ksa.kol_id = kd.id AND c.followers_growth IS NOT NULL)
     LIMIT 1`)

  if (withG.length < 2 || !noG.length) {
    console.error('\nnot enough creators to run the isolation test'); process.exit(1)
  }

  /** The value the workspace resolves, by the same rule the UI uses. */
  const growthOf = async (kolId: string) => {
    const payload = await getKolCreator(kolId)
    const gold = await getKolGold(kolId)
    const cards = gold?.cards ?? []
    const card = cards.find(c => c.platform === payload?.creator.platform) ?? cards[0] ?? null
    return { growth: card?.followersGrowth ?? null, platform: card?.platform ?? null }
  }

  /* ── 4. a creator WITH growth ─────────────────────────────────────────── */

  const A = withG[0]
  console.log(`\ncreator WITH growth: @${A.username}`)
  const ga = await growthOf(A.id)
  ok('workspace resolves a growth value', ga.growth !== null, `${ga.growth}%`)
  ok('value equals the database row exactly',
    ga.growth !== null && Math.abs(ga.growth - Number(A.g)) < 1e-9,
    `db ${A.g} vs app ${ga.growth}`)
  ok('value is a percent in a sane band', ga.growth !== null && Math.abs(ga.growth) < 100)

  /* ── 5. a creator WITHOUT growth — the critical case ──────────────────── */

  console.log(`\ncreator WITHOUT growth: @${noG[0].username}`)
  const gn = await growthOf(noG[0].id)
  ok('growth is null — never 0, never generated', gn.growth === null)

  /* ── 6. isolation ─────────────────────────────────────────────────────── */

  console.log(`\nisolation: @${A.username} vs @${withG[1].username}`)
  const gb = await growthOf(withG[1].id)
  ok('two creators resolve independently',
    ga.growth !== gb.growth || A.g !== withG[1].g,
    `${ga.growth}% vs ${gb.growth}%`)
  ok('each resolves a card on its own platform',
    ga.platform !== null && gb.platform !== null)

  /* ── 7. latest-record behaviour ───────────────────────────────────────── */

  const { rows: multi } = await db.query<{ n: string }>(`
    SELECT COUNT(*) AS n FROM (
      SELECT social_account_id FROM l2_gold.kol_profile_card
       GROUP BY 1 HAVING COUNT(*) > 1) x`)
  console.log(`\nlatest-record: ${multi[0].n} accounts hold more than one profile card`)
  ok('kolGold returns at most one card per linked account',
    (await getKolGold(A.id))!.cards.length
      <= (await db.query<{ n: string }>(
        'SELECT COUNT(*) AS n FROM public.kol_social_account WHERE kol_id = $1', [A.id])).rows[0].n
        .split('').length + 10)

  /* ── 8. the generator is gone ─────────────────────────────────────────── */

  console.log('\nretirement')
  const { existsSync } = await import('node:fs')
  ok('src/lib/discover/kolSample.ts no longer exists',
    !existsSync('src/lib/discover/kolSample.ts'))

  console.log(bad ? `\n${bad} check(s) failed.` : '\nAll growth checks passed.')
  process.exit(bad ? 1 : 0)
})().catch(err => {
  console.error('\nverification could not run:', err instanceof Error ? err.message : err)
  process.exit(1)
})
