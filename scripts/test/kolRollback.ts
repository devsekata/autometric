/**
 * Runs every KOL query of a test inside ONE transaction that is rolled back.
 *
 * `kolDb()` and `kolDbWrite()` build their own `pg` pools. This patches the Pool
 * prototype so both pools hand their work to a single client that has already
 * issued BEGIN:
 *
 *   * a plain `pool.query()` runs inside its own SAVEPOINT, so a failing
 *     statement (a unique violation the code handles, say) fails alone, the way
 *     it would with autocommit, instead of aborting the whole test transaction;
 *   * `pool.connect()` returns a client whose BEGIN / COMMIT / ROLLBACK become
 *     SAVEPOINT / RELEASE / ROLLBACK TO, so the code's own transactions behave
 *     as written — and still commit nothing.
 *
 * Work is serialised: a savepoint cannot interleave with another one on the
 * same connection. `finish()` rolls everything back, so the test leaves no row
 * behind — fixtures included.
 *
 * Must be imported before anything that imports `@/lib/kolDb`.
 */
import pg from 'pg'

type Cfg = { host?: string; port?: number; database?: string; user?: string; password?: string }

let shared: pg.Client | null = null
let chain: Promise<unknown> = Promise.resolve()
let seq = 0

/** Runs `fn` after everything queued before it. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
}

async function inSavepoint(text: string, values?: unknown[]) {
  const sp = `t_${++seq}`
  await shared!.query(`SAVEPOINT ${sp}`)
  try {
    const res = await shared!.query(text, values as unknown[])
    await shared!.query(`RELEASE SAVEPOINT ${sp}`)
    return res
  } catch (err) {
    await shared!.query(`ROLLBACK TO SAVEPOINT ${sp}`)
    await shared!.query(`RELEASE SAVEPOINT ${sp}`)
    throw err
  }
}

const argsOf = (a: unknown, b: unknown): [string, unknown[] | undefined] =>
  typeof a === 'string' ? [a, b as unknown[] | undefined] : [(a as { text: string }).text, (a as { values?: unknown[] }).values]

export async function start(cfg: Cfg) {
  shared = new pg.Client({ ...cfg, connectionTimeoutMillis: 10_000 })
  await shared.connect()
  const { rows } = await shared.query('SELECT current_database() AS db')
  if (rows[0].db !== cfg.database) throw new Error(`connected to ${rows[0].db}, expected ${cfg.database}`)
  await shared.query('BEGIN')

  const proto = pg.Pool.prototype as unknown as Record<string, unknown>
  proto.query = function (a: unknown, b?: unknown) {
    const [text, values] = argsOf(a, b)
    return serial(() => inSavepoint(text, values))
  }
  proto.end = async function () { /* the shared client is closed by finish() */ }
  proto.connect = async function () {
    // Wait for our turn, then hold the queue until release(), so nothing
    // interleaves with this client's transaction.
    let release!: () => void
    const held = new Promise<void>(r => { release = r })
    let acquired!: () => void
    const turn = new Promise<void>(r => { acquired = r })
    void serial(async () => { acquired(); await held })
    await turn
    const stack: string[] = []
    const client = {
      async query(a: unknown, b?: unknown) {
        const [text, values] = argsOf(a, b)
        const verb = text.trim().toUpperCase()
        if (verb === 'BEGIN') {
          const sp = `c_${++seq}`; stack.push(sp)
          return shared!.query(`SAVEPOINT ${sp}`)
        }
        if (verb === 'COMMIT') {
          const sp = stack.pop(); return shared!.query(`RELEASE SAVEPOINT ${sp}`)
        }
        if (verb === 'ROLLBACK') {
          const sp = stack.pop()
          if (!sp) return { rows: [], rowCount: 0 }
          await shared!.query(`ROLLBACK TO SAVEPOINT ${sp}`)
          return shared!.query(`RELEASE SAVEPOINT ${sp}`)
        }
        if (stack.length) return shared!.query(text, values as unknown[])
        return inSavepoint(text, values)
      },
      release() { release() },
    }
    return client
  }
}

/** Direct access for fixtures and assertions, inside the same transaction. */
export function sql<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]) {
  return serial(() => inSavepoint(text, values)) as Promise<pg.QueryResult<R>>
}

export async function finish() {
  if (!shared) return
  await shared.query('ROLLBACK')
  await shared.end()
  shared = null
}
