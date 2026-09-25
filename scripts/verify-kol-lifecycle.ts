/**
 * KOL master lifecycle (active = serving, inactive = kept but not served) — offline checks.
 *
 *   npx tsx scripts/verify-kol-lifecycle.ts
 *
 * No database, no Apify: the decision function is pure, and the SQL the Add New
 * KOL pipeline and Discovery run is read from source.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { existingKolAction } from '../src/lib/kolDirectory/addKolCheck'

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
let n = 0
const check = (name: string, fn: () => void) => { fn(); n++; console.log(`ok  ${name}`) }

check('new handle -> insert (Case 1)', () =>
  assert.equal(existingKolAction(null), 'insert'))
check('active + scraped -> already in directory, no duplicate (Case 2)', () =>
  assert.equal(existingKolAction({ directory_status: 'active', hasFollowerData: true }), 'already_in_directory'))
check('inactive + scraped -> reuse same ids, re-scrape (Case 3)', () =>
  assert.equal(existingKolAction({ directory_status: 'inactive', hasFollowerData: true }), 'reuse'))
check('inactive, never scraped -> reuse (Case 3)', () =>
  assert.equal(existingKolAction({ directory_status: 'inactive', hasFollowerData: false }), 'reuse'))
check('active, never scraped -> reuse (existing behaviour)', () =>
  assert.equal(existingKolAction({ directory_status: 'active', hasFollowerData: false }), 'reuse'))

const scrape = src('src/lib/kolDirectory/addKolScrape.ts')
check('new identity row is inserted active', () =>
  assert.match(scrape, /VALUES \(\$1, \$2, \$3, 'manual_add', 'active', \$4, now\(\), now\(\)\)/))
check('successful IG + TikTok scrape sets directory_status active (inactive -> active)', () =>
  assert.equal((scrape.match(/directory_status\s+=\s+'active',/g) ?? []).length, 2))
check('reuse paths never INSERT a second kol_directory row', () =>
  assert.equal((scrape.match(/INSERT INTO public\.kol_directory/g) ?? []).length, 1))
check('check lookup ignores status (finds inactive rows too) and reads it', () => {
  const chk = src('src/lib/kolDirectory/addKolCheck.ts')
  assert.match(chk, /kd\.directory_status, ksa\.social_account_id/)
  assert.doesNotMatch(chk.split('async function findInDirectory')[1].split('}')[0], /directory_status\s*=/)
})
check('Discovery serves only active rows', () =>
  assert.match(src('src/lib/discover/kolDirectory.ts'), /const ACTIVE = `kd\.directory_status = 'active'`/))
console.log(`\n${n} checks passed`)
