import { Pool } from 'pg'

/**
 * Connection to the commercial KOL platform's Postgres, which is a different
 * server from the analytics warehouse `@/lib/db` talks to — hence its own pool
 * and its own `PG_*_KOL` credentials rather than a schema inside `DATABASE_URL`.
 *
 * Only the KOL Directory reads from it, and only from `public.kol_directory`
 * plus its lookup tables (`platforms`, `kol_categories`, `kol_tiers`). The app
 * never writes here: the roster is maintained by the KOL platform itself.
 */

const REQUIRED = ['PG_HOST_KOL', 'PG_DB_KOL', 'PG_USER_KOL', 'PG_PASSWORD_KOL'] as const

let pool: Pool | null = null

/**
 * The pool is built on first use, not at import time: a missing variable has to
 * surface as a handled 500 from the route, not as a module that throws while
 * Next is collecting routes at build time.
 *
 * Every field is passed explicitly and checked first because `pg` falls back to
 * the standard `PGHOST` / `PGUSER` / `PGDATABASE` variables for anything left
 * undefined — and those are set in the same `.env.local`, pointing at the
 * warehouse. Without this check a missing `PG_*_KOL` would quietly dial the
 * wrong server and hang until the TCP timeout instead of saying what is wrong.
 */
export default function kolDb(): Pool {
  if (pool) return pool

  const missing = REQUIRED.filter(k => !process.env[k])
  if (missing.length) {
    throw new Error(
      `KOL database is not configured: ${missing.join(', ')} missing from the environment. ` +
      'If these were just added to .env.local, restart the dev server so Next reloads it.',
    )
  }

  pool = new Pool({
    host: process.env.PG_HOST_KOL,
    port: Number(process.env.PG_PORT_KOL ?? 5432),
    database: process.env.PG_DB_KOL,
    user: process.env.PG_USER_KOL,
    password: process.env.PG_PASSWORD_KOL,
    // Smaller than the warehouse pool: one read-only page, not the whole app.
    max: 5,
    // The KOL host is on a private network. Fail in seconds with a clear error
    // rather than letting the page hang on the OS-level TCP timeout.
    connectionTimeoutMillis: 8_000,
  })

  return pool
}
