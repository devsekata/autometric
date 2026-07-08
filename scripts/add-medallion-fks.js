/**
 * Declares & enforces the foreign keys on the medallion layers, pointing each
 * account/brand column at the RIGHT parent table:
 *
 *   l0_extra, l0_harmonization, l1_silver : brand_id    -> public.social_accounts(id)
 *       (here "brand_id" actually holds a social_accounts.id — per-account grain)
 *   l2_gold                               : brand_id    -> public.brands(id)
 *       (gold is rolled up to the umbrella brand via brand_social_accounts)
 *   l2_gold.brand_metric_daily            : account_id  -> public.social_accounts(id)
 *       (the only gold table that keeps per-account detail)
 *   l2_gold.post_metric                   : brand_id    -> public.social_accounts(id)
 *       (sp_build_post_metric() copies l1_silver.unified_post.brand_id as-is,
 *        without translating through brand_social_accounts, so despite the
 *        column name this table is per-account grain, not per-brand)
 *
 * All FKs are ON DELETE RESTRICT.
 *
 * Self-healing & idempotent: for each target column it inspects the existing
 * single-column FK. If it already points at the correct parent it is left
 * alone; if it points somewhere else it is dropped and recreated; if missing
 * it is created. Safe to re-run after the external pipeline rebuilds tables.
 *
 * Usage:  npm run fk:medallion   (or)   node scripts/add-medallion-fks.js
 */
const { Client } = require('pg')
require('dotenv').config({ path: '.env.local' })

const SOCIAL = 'public.social_accounts'
const BRANDS = 'public.brands'
const SA_SCHEMAS = ['l0_extra', 'l0_harmonization', 'l1_silver'] // brand_id -> social_accounts
const L2_ACCOUNT_GRAIN = new Set(['post_metric']) // l2_gold tables where brand_id actually holds social_accounts.id

const client = new Client({ connectionString: process.env.DATABASE_URL })

// Build the list of base tables in a schema that have a given column.
async function tablesWithColumn(schema, column) {
  const { rows } = await client.query(
    `SELECT c.table_name t
       FROM information_schema.columns c
       JOIN information_schema.tables tb
         ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
        AND tb.table_type = 'BASE TABLE'
      WHERE c.table_schema = $1 AND c.column_name = $2
      ORDER BY c.table_name`,
    [schema, column],
  )
  return rows.map((r) => r.t)
}

// Existing single-column FK on (schema.table, column): returns {conname, parent} or null.
async function existingFk(schema, table, column) {
  const { rows } = await client.query(
    `SELECT con.conname,
            fns.nspname || '.' || frel.relname AS parent
       FROM pg_constraint con
       JOIN pg_attribute att
         ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
       JOIN pg_class frel ON frel.oid = con.confrelid
       JOIN pg_namespace fns ON fns.oid = frel.relnamespace
      WHERE con.contype = 'f'
        AND con.conrelid = format('%I.%I', $1::text, $2::text)::regclass
        AND att.attname = $3
        AND array_length(con.conkey, 1) = 1`,
    [schema, table, column],
  )
  return rows[0] || null
}

async function enforce(schema, table, column, parent) {
  const short = parent === SOCIAL ? 'social_account' : 'brand'
  const constraint = `fk_${table}_${column}_${short}`
  const cur = await existingFk(schema, table, column)

  if (cur && cur.parent === parent) {
    console.log(`  ok    ${schema}.${table}.${column} -> ${parent}`)
    return 'ok'
  }
  if (cur) {
    await client.query(`ALTER TABLE "${schema}"."${table}" DROP CONSTRAINT "${cur.conname}"`)
    console.log(`  drop  ${schema}.${table}.${column} (was -> ${cur.parent})`)
  }
  await client.query(
    `ALTER TABLE "${schema}"."${table}"
       ADD CONSTRAINT "${constraint}"
       FOREIGN KEY ("${column}") REFERENCES ${parent}(id) ON DELETE RESTRICT`,
  )
  console.log(`  ${cur ? 'fix ' : 'add '}  ${schema}.${table}.${column} -> ${parent}`)
  return cur ? 'fixed' : 'added'
}

async function main() {
  await client.connect()
  console.log('Connected:', (await client.query('SELECT current_database() d')).rows[0].d)

  const plan = []
  for (const s of SA_SCHEMAS) {
    for (const t of await tablesWithColumn(s, 'brand_id')) plan.push([s, t, 'brand_id', SOCIAL])
  }
  for (const t of await tablesWithColumn('l2_gold', 'brand_id')) {
    plan.push(['l2_gold', t, 'brand_id', L2_ACCOUNT_GRAIN.has(t) ? SOCIAL : BRANDS])
  }
  for (const t of await tablesWithColumn('l2_gold', 'account_id')) plan.push(['l2_gold', t, 'account_id', SOCIAL])

  const tally = { ok: 0, added: 0, fixed: 0 }
  for (const [s, t, c, p] of plan) tally[await enforce(s, t, c, p)]++

  console.log(`\nDone. ${plan.length} FKs enforced — ok ${tally.ok}, added ${tally.added}, fixed ${tally.fixed}.`)
  await client.end()
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
