/**
 * Applies a migration from `migrations/kol/` to the KOL database.
 *
 *   npm run migrate:kol            # applies every pending file, in order
 *   node scripts/apply-kol-migration.js --dry-run
 *
 * ── Why this is separate from `migrate:up` ──────────────────────────────────
 * `npm run migrate:up` runs node-pg-migrate against `DATABASE_URL`, which is
 * the warehouse `tsdb`. The files under `migrations/` are that database's
 * migrations. This one targets the KOL server instead — a different host, a
 * different set of credentials (`PG_*_KOL`) and a different schema history —
 * so its files live in their own directory with their own numbering, and the
 * two can never be applied to the wrong server by picking the wrong command.
 *
 * ── Idempotent by construction ──────────────────────────────────────────────
 * Every statement in `migrations/kol/` is written `IF NOT EXISTS`, and each
 * file is recorded in `public.pgmigrations` after it runs, so a second run is a
 * no-op twice over. The whole file runs inside one transaction: a failure
 * halfway leaves the database exactly as it was.
 *
 * Nothing here reads, writes or deletes a row of existing data.
 */
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const DIR = path.join(__dirname, '..', 'migrations', 'kol')
const DRY = process.argv.includes('--dry-run')

const REQUIRED = ['PG_HOST_KOL', 'PG_DB_KOL', 'PG_USER_KOL', 'PG_PASSWORD_KOL']

/** Only the Up half; the Down block is commented out, as elsewhere in this repo. */
function upSql(raw) {
  const start = raw.indexOf('-- Up Migration')
  const end = raw.indexOf('-- Down Migration')
  if (start === -1) throw new Error('missing "-- Up Migration" marker')
  return raw.slice(start, end === -1 ? undefined : end)
}

;(async () => {
  const missing = REQUIRED.filter(k => !process.env[k])
  if (missing.length) {
    console.error(`KOL database is not configured: ${missing.join(', ')} missing.`)
    process.exit(1)
  }

  const client = new Client({
    host: process.env.PG_HOST_KOL,
    port: Number(process.env.PG_PORT_KOL ?? 5432),
    database: process.env.PG_DB_KOL,
    user: process.env.PG_USER_KOL,
    password: process.env.PG_PASSWORD_KOL,
    connectionTimeoutMillis: 8000,
  })
  await client.connect()

  try {
    // Says which server this actually reached, not which one the environment
    // claims. Applying a KOL migration to the warehouse by accident is the one
    // mistake this script exists to make impossible to miss.
    const { rows: [who] } = await client.query(
      'SELECT current_database() db, inet_server_addr()::text host')
    console.log(`server  : ${who.host} · database ${who.db}`)
    if (who.db !== process.env.PG_DB_KOL) {
      throw new Error(`connected to '${who.db}' but PG_DB_KOL is '${process.env.PG_DB_KOL}'`)
    }

    await client.query(`CREATE TABLE IF NOT EXISTS public.pgmigrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      run_on TIMESTAMP NOT NULL DEFAULT NOW())`)

    const files = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()
    if (!files.length) { console.log('no migrations found'); return }

    for (const file of files) {
      const name = file.replace(/\.sql$/, '')
      const { rows } = await client.query(
        'SELECT 1 FROM public.pgmigrations WHERE name = $1', [name])
      if (rows.length) { console.log(`skip    : ${name} (already recorded)`); continue }

      const sql = upSql(fs.readFileSync(path.join(DIR, file), 'utf8'))
      if (DRY) { console.log(`would run: ${name} (${sql.length} chars)`); continue }

      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(
          'INSERT INTO public.pgmigrations (name, run_on) VALUES ($1, NOW())', [name])
        await client.query('COMMIT')
        console.log(`applied : ${name}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
  } finally {
    await client.end()
  }
})().catch(err => { console.error(err.message); process.exit(1) })
