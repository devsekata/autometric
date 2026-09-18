/**
 * Stand-in for `@/lib/kolDb`, used only by `scripts/verify-brand-profile-kol.ts`.
 *
 * Both pools resolve to ONE client that the script holds inside a transaction
 * it always rolls back. That puts every query the route makes — the membership
 * lookup, the profile read and the upsert — into that transaction, so the real
 * route and the real SQL can be exercised against the KOL database without a
 * single row surviving the run.
 */
import type { PoolClient } from 'pg'

let client: PoolClient | null = null

export function bindClient(c: PoolClient | null) {
  client = c
}

function bound(): PoolClient {
  if (!client) throw new Error('verify-brand-profile-kol: no transaction client bound')
  return client
}

export default function kolDb(): PoolClient {
  return bound()
}

export function kolDbWrite(): PoolClient {
  return bound()
}
