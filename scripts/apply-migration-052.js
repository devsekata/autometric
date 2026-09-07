/**
 * Applies `migrations/052_discover-favorites-lists.sql` and records it in
 * `pgmigrations`, which is exactly what `npm run migrate:up` would do.
 *
 * It exists because `migrate:up` cannot run at all on this repo right now:
 *
 *   Error: Not run migration 048_roster-rate-cards is preceding already run
 *          migration 047_org-limits
 *
 * The message names the wrong file. The real cause is that three migrations
 * were applied to the database from somewhere outside this repo and their files
 * were never committed — `047_org-limits`, `050_ig-fb-metric-columns` and
 * `051_l0extra-id-sequence-resync` are all in `pgmigrations` with no `.sql` to
 * match. node-pg-migrate cannot derive a timestamp from the `NNN_name` naming
 * this project uses, so with a hole at 047 its ordering check mis-pairs the file
 * list against the run list and blames 048.
 *
 * This script is a bypass, not a fix. The migration chain stays broken until
 * those three files are recovered from whoever applied them — see the note in
 * the completion report. Nothing here touches the missing migrations or the
 * existing schema: the SQL is additive and every statement is `IF NOT EXISTS`,
 * so re-running is a no-op.
 *
 *   npm run migrate:052
 */
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const NAME = '052_discover-favorites-lists'
const FILE = path.join(__dirname, '..', 'migrations', `${NAME}.sql`)

/** Only the Up half — the Down block is commented out in the file, as with 049. */
function upSql(raw) {
  const start = raw.indexOf('-- Up Migration')
  const end = raw.indexOf('-- Down Migration')
  if (start === -1) throw new Error('missing "-- Up Migration" marker')
  return raw.slice(start, end === -1 ? undefined : end)
}

;(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows } = await client.query('SELECT 1 FROM pgmigrations WHERE name = $1', [NAME])
    if (rows.length) {
      console.log(`${NAME} already recorded — nothing to do.`)
      return
    }

    // One transaction: either the tables and the ledger entry both land, or
    // neither does. A half-applied migration is the state this whole script
    // exists to avoid creating more of.
    await client.query('BEGIN')
    await client.query(upSql(fs.readFileSync(FILE, 'utf8')))
    await client.query('INSERT INTO pgmigrations (name, run_on) VALUES ($1, now())', [NAME])
    await client.query('COMMIT')
    console.log(`Applied ${NAME}.`)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error(`Failed to apply ${NAME}:`, err.message)
    process.exitCode = 1
  } finally {
    await client.end()
  }
})()
