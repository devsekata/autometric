import { Pool } from 'pg'

/**
 * Connection to the commercial KOL platform's Postgres, which is a different
 * server from the analytics warehouse `@/lib/db` talks to — hence its own pool
 * and its own `PG_*_KOL` credentials rather than a schema inside `DATABASE_URL`.
 *
 * Most of the app only reads from it — the KOL Directory page, and anything
 * checking whether a handle is already in the commercial roster — and should
 * keep using `kolDb()` for that. The one exception is the "Add New KOL"
 * pipeline (`@/lib/kolDirectory/addKolScrape.ts`), which writes a new roster
 * entry and its raw scrape into this same database and needs `kolDbWrite()`
 * below. Every other caller should have no reason to reach for the write pool.
 */

const REQUIRED = ['PG_HOST_KOL', 'PG_DB_KOL', 'PG_USER_KOL', 'PG_PASSWORD_KOL'] as const

let pool: Pool | null = null
let writePool: Pool | null = null

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

/**
 * The write-capable counterpart to `kolDb()`, for the "Add New KOL" pipeline
 * only. Same server, same credentials (there is no separate read/write user on
 * this database) — kept as a distinct pool and a distinct function so that
 * every call site says, by which function it imported, whether it intends to
 * write to the commercial roster. Grep for `kolDbWrite` to find everything that
 * does.
 */
export function kolDbWrite(): Pool {
  if (writePool) return writePool

  const missing = REQUIRED.filter(k => !process.env[k])
  if (missing.length) {
    throw new Error(
      `KOL database is not configured: ${missing.join(', ')} missing from the environment. ` +
      'If these were just added to .env.local, restart the dev server so Next reloads it.',
    )
  }

  writePool = new Pool({
    host: process.env.PG_HOST_KOL,
    port: Number(process.env.PG_PORT_KOL ?? 5432),
    database: process.env.PG_DB_KOL,
    user: process.env.PG_USER_KOL,
    password: process.env.PG_PASSWORD_KOL,
    // Even smaller than the read pool: this path runs one creator at a time,
    // fire-and-forget from the Add KOL route — it never needs concurrency.
    max: 3,
    connectionTimeoutMillis: 8_000,
  })

  return writePool
}
