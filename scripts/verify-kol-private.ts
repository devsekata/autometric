/**
 * D009 Private Account Detection — the Add KOL warning and its two choices.
 *
 *   npm run verify:kol-private
 *
 * How it stays harmless:
 *   * no actor is ever called: `readPrivateFlag` is a pure function, and the
 *     payload shapes it is tested against are read from `l0_raw` rows the
 *     pipeline already stored (SELECT only);
 *   * `APIFY_API_TOKEN` is blanked before any import, so even an accidental
 *     call cannot reach Apify;
 *   * the warehouse is unreachable (`DATABASE_URL` points at an invalid host);
 *   * nothing is written: the only statements are SELECTs, and roster counts
 *     are compared before and after the run.
 *
 * Covers: the flag is read from the payload each platform actually sends, a
 * missing or non-boolean value never warns, the dialog warns only for an
 * explicit `true`, Continue is the same `onAdd` the public path uses, Cancel is
 * the dialog's own close, and the non-private path is byte-identical to before.
 */
import { readFileSync } from 'node:fs'
import pg from 'pg'

process.env.DATABASE_URL = 'postgres://tsdb-blocked.invalid:1/blocked'
for (const k of ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGPORT']) delete process.env[k]
process.env.APIFY_API_TOKEN = ''

let bad = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  else { bad++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(p, 'utf8')

async function main() {
  const { readPrivateFlag } = await import('../src/lib/kolDirectory/addKolCheck')

  /* ── 1. the flag itself ────────────────────────────────────────────────── */
  console.log('reading the platform flag')
  ok('Instagram private=true → true', readPrivateFlag('instagram', { private: true }) === true)
  ok('Instagram private=false → false', readPrivateFlag('instagram', { private: false }) === false)
  ok('TikTok privateAccount=true → true', readPrivateFlag('tiktok', { privateAccount: true }) === true)
  ok('TikTok privateAccount=false → false', readPrivateFlag('tiktok', { privateAccount: false }) === false)
  ok('a missing field never warns', readPrivateFlag('instagram', {}) === null
    && readPrivateFlag('tiktok', {}) === null)
  ok('null/undefined payloads never warn',
    readPrivateFlag('instagram', null) === null && readPrivateFlag('tiktok', undefined) === null)
  ok('a non-boolean value never warns',
    readPrivateFlag('instagram', { private: 'true' } as never) === null
    && readPrivateFlag('tiktok', { privateAccount: 1 } as never) === null)
  ok('each platform reads its own field only',
    readPrivateFlag('instagram', { privateAccount: true } as never) === null
    && readPrivateFlag('tiktok', { private: true } as never) === null)

  /* ── 2. the check hands it to the dialog ───────────────────────────────── */
  console.log('\nthe check step exposes it')
  const checkSrc = read('src/lib/kolDirectory/addKolCheck.ts')
  ok('the new-account payload declares isPrivate', checkSrc.includes('isPrivate: boolean | null'))
  ok('Instagram fills it from its own payload', checkSrc.includes("isPrivate: readPrivateFlag('instagram', profile)"))
  ok('TikTok fills it from the author', checkSrc.includes("isPrivate: readPrivateFlag('tiktok', author)"))
  ok('no new persistence was added for it',
    !/INSERT INTO|UPDATE .*SET/i.test(checkSrc.slice(checkSrc.indexOf('readPrivateFlag'))))
  ok('the other four check states are untouched',
    checkSrc.includes("state: 'invalid_input'") && checkSrc.includes("state: 'already_in_directory'")
    && checkSrc.includes("state: 'not_found'") && checkSrc.includes("state: 'unverified'"))

  /* ── 3. the dialog ─────────────────────────────────────────────────────── */
  console.log('\nthe dialog warns and offers both choices')
  const ui = read('src/components/discover/AddKolDirectoryModal.tsx').replace(/\r\n/g, '\n')
  ok('a private account gets its own branch', ui.includes("result.state === 'new' && result.account.isPrivate === true"))
  ok('the public branch runs only when it is not private',
    ui.includes("result.state === 'new' && result.account.isPrivate !== true"))
  ok('the warning says the account is private and the data will be limited',
    ui.includes('Akun ini adalah akun private. Data yang tersedia akan terbatas'))
  ok('Continue is offered, in Indonesian', ui.includes('Lanjutkan dengan data terbatas'))
  ok('Cancel is offered, in Indonesian', ui.includes('Batalkan</Action>'))
  const branch = ui.slice(ui.indexOf("result.account.isPrivate === true"), ui.indexOf("result.account.isPrivate !== true"))
  ok('Continue calls the same onAdd the public path calls', branch.includes('onClick={() => onAdd(result.account)}'))
  ok('Cancel is the dialog’s existing close, not a new path', branch.includes('onClick={onCancel}'))
  ok('the warning starts no request of its own',
    !branch.includes('fetch(') && !/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(branch))
  ok('the existing Add to Directory action is unchanged',
    ui.includes('<Action onClick={() => onAdd(result.account)} variant="primary" busy={submitting}>')
    && ui.includes('Add to Directory'))
  ok('the dialog reuses the existing Outcome/Action components',
    branch.includes('<Outcome') && branch.includes('<Action') && !branch.includes('function '))

  /* ── 4. nothing else moved ─────────────────────────────────────────────── */
  console.log('\nneighbouring requirements are untouched')
  const scrape = read('src/lib/kolDirectory/addKolScrape.ts')
  ok('D010/D013/D054: the pipeline, retry and refresh entry points are unchanged',
    scrape.includes('async function runRestOfPipeline') && scrape.includes('export async function retryKolScrape')
    && scrape.includes('export async function refreshKolScrape')
    && !scrape.includes('isPrivate: readPrivateFlag'))
  ok('no private branch was added to the pipeline',
    !/private/i.test(scrape.slice(scrape.indexOf('async function runRestOfPipeline'),
      scrape.indexOf('/* ── kol_directory update'))))
  ok('D008 duplicate detection still answers first',
    checkSrc.includes("state: 'already_in_directory'") && checkSrc.indexOf('findInDirectory(parsed.platform')
      < checkSrc.indexOf('checkInstagram(parsed.username'))
  ok('the check route contract is unchanged (returns the result as-is)',
    read('src/app/api/kol-directory/add/check/route.ts').includes('return NextResponse.json(result)'))
  ok('the add route still takes only platform/username/profileUrl/existing ids',
    !read('src/app/api/kol-directory/add/route.ts').includes('isPrivate'))

  /* ── 5. no warehouse, no writes ────────────────────────────────────────── */
  console.log('\nsafety')
  ok('this feature imports no warehouse pool',
    !checkSrc.includes("from '@/lib/db'") && !ui.includes("from '@/lib/db'"))
  ok('no migration ships with D009',
    !read('package.json').includes('migrate:d009'))

  const kolCfg = {
    host: process.env.PG_HOST_KOL, port: Number(process.env.PG_PORT_KOL ?? 5432),
    database: process.env.PG_DB_KOL, user: process.env.PG_USER_KOL, password: process.env.PG_PASSWORD_KOL,
  }
  if (!kolCfg.host || !kolCfg.database) {
    console.log('\n(no PG_*_KOL configured — skipping the recorded-payload check)')
  } else {
    const db = new pg.Client({ ...kolCfg, connectionTimeoutMillis: 10_000 })
    await db.connect()
    try {
      const before = (await db.query<{ n: string }>(
        `SELECT count(*) n FROM public.kol_directory WHERE directory_status='active'`)).rows[0].n

      /* The shapes the pipeline actually stored, judged by the same function. */
      const ig = await db.query<{ payload: Record<string, unknown> }>(
        `SELECT raw_payload AS payload FROM l0_raw.ig_profile_apify
          WHERE (raw_payload->>'private')::boolean IS TRUE LIMIT 5`)
      const igPublic = await db.query<{ payload: Record<string, unknown> }>(
        `SELECT raw_payload AS payload FROM l0_raw.ig_profile_apify
          WHERE (raw_payload->>'private')::boolean IS FALSE LIMIT 5`)
      ok('recorded private Instagram payloads read as private',
        ig.rows.length > 0 && ig.rows.every(r => readPrivateFlag('instagram', r.payload) === true),
        `${ig.rows.length} payload(s)`)
      ok('recorded public Instagram payloads read as public',
        igPublic.rows.length > 0 && igPublic.rows.every(r => readPrivateFlag('instagram', r.payload) === false),
        `${igPublic.rows.length} payload(s)`)

      const tt = await db.query<{ author: Record<string, unknown> }>(
        `SELECT raw_payload->'authorMeta' AS author FROM l0_raw.tt_profile_apify
          WHERE (raw_payload->'authorMeta'->>'privateAccount')::boolean IS TRUE LIMIT 5`)
      const ttPublic = await db.query<{ author: Record<string, unknown> }>(
        `SELECT raw_payload->'authorMeta' AS author FROM l0_raw.tt_profile_apify
          WHERE (raw_payload->'authorMeta'->>'privateAccount')::boolean IS FALSE LIMIT 5`)
      ok('recorded private TikTok payloads read as private',
        tt.rows.length > 0 && tt.rows.every(r => readPrivateFlag('tiktok', r.author) === true),
        `${tt.rows.length} payload(s)`)
      ok('recorded public TikTok payloads read as public',
        ttPublic.rows.length > 0 && ttPublic.rows.every(r => readPrivateFlag('tiktok', r.author) === false),
        `${ttPublic.rows.length} payload(s)`)

      /* The canonical column is untouched by this feature. */
      const canon = (await db.query<{ n: string; filled: string }>(
        `SELECT count(*) n, count(is_private) filled FROM l2_gold.kol_profile_card`)).rows[0]
      ok('the canonical is_private column is still the one the profile reads',
        canon.n === canon.filled, `${canon.filled}/${canon.n} filled`)

      const after = (await db.query<{ n: string }>(
        `SELECT count(*) n FROM public.kol_directory WHERE directory_status='active'`)).rows[0].n
      ok('the active roster count is unchanged by this run', before === after, `${before} → ${after}`)
    } finally {
      await db.end()
    }
  }

  console.log(bad === 0 ? '\nall checks passed' : `\n${bad} check(s) failed`)
  if (bad) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
