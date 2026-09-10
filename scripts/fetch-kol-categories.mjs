/**
 * Reads the real `public.kol_categories` master list off the KOL server and
 * writes it to `scripts/brand-match/kol-categories.json`, which the Taxonomy
 * sheet picks up automatically on the next build.
 *
 *   npm run taxonomy:fetch          (office VPN required)
 *   npm run brandmatch:build
 *
 * It exists because the workbook must not guess. The 8 Sep 2026 audit measured
 * five of the 28 master categories by name — Lifestyle 2.522, Beauty 1.271,
 * Moms 581, Entertainment 476, Gen Z 150 — and section F of the Taxonomy sheet
 * lists exactly those five plus a row saying the other 23 have not been read.
 * Inventing 23 plausible category names would produce a sheet that looks
 * finished and maps onto nothing, which is worse than an honest gap.
 *
 * Read-only, and on the KOL pool rather than the warehouse: `kol_categories`
 * and `kol_directory` live on the commercial platform's Postgres, not in the
 * tsdb warehouse — the two servers carry schemas with the same names, so the
 * pool is what decides which database a query lands in.
 */

import pg from 'pg'
import path from 'node:path'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), 'brand-match', 'kol-categories.json')

const REQUIRED = ['PG_HOST_KOL', 'PG_DB_KOL', 'PG_USER_KOL', 'PG_PASSWORD_KOL']
const missing = REQUIRED.filter(k => !process.env[k])
if (missing.length) {
  console.error(`missing from the environment: ${missing.join(', ')}`)
  console.error('run through the env loader: npm run taxonomy:fetch')
  process.exit(1)
}

// Every master row, with the creators actually carrying it. LEFT JOIN, not
// INNER: a category with no creators is still a category the chip UI offers,
// and leaving it out would misreport the master list as smaller than it is.
const SQL = `
  SELECT kc.name,
         COUNT(kd.id)::int AS creators
    FROM public.kol_categories kc
    LEFT JOIN public.kol_directory kd
      ON kc.id = ANY (COALESCE(kd.category_ids, ARRAY[kd.category_id]))
   GROUP BY kc.name
   ORDER BY creators DESC, kc.name`

const pool = new pg.Pool({
  host: process.env.PG_HOST_KOL,
  port: Number(process.env.PG_PORT_KOL ?? 5432),
  database: process.env.PG_DB_KOL,
  user: process.env.PG_USER_KOL,
  password: process.env.PG_PASSWORD_KOL,
  max: 2,
  // The KOL host is on the office network. Fail in seconds with a sentence that
  // names the likely cause, rather than on the OS-level TCP timeout.
  connectionTimeoutMillis: 8_000,
})

try {
  const { rows } = await pool.query(SQL)
  const uncategorised = await pool.query(
    'SELECT COUNT(*)::int AS n FROM public.kol_directory WHERE category_ids IS NULL OR cardinality(category_ids) = 0')
  const total = await pool.query('SELECT COUNT(*)::int AS n FROM public.kol_directory')

  writeFileSync(OUT, `${JSON.stringify({
    measuredAt: new Date().toISOString().slice(0, 10),
    roster: total.rows[0].n,
    uncategorised: uncategorised.rows[0].n,
    rows,
  }, null, 2)}\n`)

  console.log(`wrote ${OUT}`)
  console.log(`  ${rows.length} master categories · roster ${total.rows[0].n} · uncategorised ${uncategorised.rows[0].n}`)
  for (const r of rows) console.log(`  ${String(r.creators).padStart(6)}  ${r.name}`)
  console.log('\nnext: npm run brandmatch:build — section F of Taxonomy fills in from this file.')
} catch (e) {
  console.error(`could not read kol_categories: ${e.message}`)
  if (/timeout|ENOTFOUND|EHOSTUNREACH|ECONNREFUSED/i.test(e.message)) {
    console.error(`${process.env.PG_HOST_KOL} is on the office network — connect to the VPN and run this again.`)
  }
  process.exitCode = 1
} finally {
  await pool.end()
}
