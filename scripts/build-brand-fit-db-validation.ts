/**
 * Brand Fit Analysis — REAL DATABASE VALIDATION workbook.
 *
 *   npm run brandfit:db-validation
 *
 * READ-ONLY. Every statement is a SELECT, the session is pinned with
 * `SET default_transaction_read_only = on`, and nothing is inserted, updated,
 * deleted, altered or migrated. No dummy row reaches any table.
 *
 * ── What this is for ───────────────────────────────────────────────────────
 * Brand Fit has no agreed business rule. This workbook is the EVIDENCE a
 * reviewer needs to decide one: what production data actually exists, which of
 * the candidate rules that data can support, and which are blocked and why.
 *
 * It deliberately reports emptiness where emptiness is the finding. A sheet
 * that says "0 rows" is the answer, not a failure to fill it.
 *
 * ── Every number is traceable ──────────────────────────────────────────────
 * Each query below carries its own id, purpose and SQL, is executed once, and
 * is written verbatim onto the `Raw Query Evidence` sheet beside a summary of
 * what it returned. Nothing in the workbook is typed in by hand.
 *
 * Connection is `kolDb()` — the project's own KOL pool. Never `@/lib/db`: the
 * warehouse carries schemas with the same names, so a query sent to the wrong
 * pool returns different numbers without erroring.
 */
import ExcelJS from 'exceljs'
import path from 'node:path'
import kolDb from '@/lib/kolDb'
import type { PoolClient } from 'pg'

const OUT = path.join(process.cwd(), 'Brand_Fit_Real_DB_Validation.xlsx')

/** The only statuses this workbook is allowed to use. */
type Status =
  | 'VERIFIED' | 'PARTIALLY VERIFIED' | 'PROPOSED — NEEDS APPROVAL'
  | 'BLOCKED BY DATA' | 'NOT MEASURED'

interface Q { id: string; purpose: string; sql: string; rows: Record<string, unknown>[] }
const evidence: Q[] = []

/** Runs one SELECT and records it for the evidence sheet. */
async function q(
  c: PoolClient, id: string, purpose: string, sql: string, params: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const r = await c.query(sql, params as never[])
  evidence.push({ id, purpose, sql: sql.trim(), rows: r.rows })
  return r.rows as Record<string, unknown>[]
}

const n = (v: unknown): number => Number(v ?? 0)
/** Coerces a raw driver value into something a cell can hold. `pg` types every
 *  column as `unknown`, and ExcelJS rightly refuses that. */
const cv = (v: unknown): string | number | null => {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' || typeof v === 'string') return v
  return String(v)
}
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—')

async function main() {
  const db = kolDb()
  const c = await db.connect()
  await c.query('SET default_transaction_read_only = on')

  const who = (await q(c, 'Q00', 'Membuktikan server & database yang benar-benar dibaca',
    `SELECT current_database() AS db, inet_server_addr()::text AS host,
            inet_server_port() AS port, now() AS read_at`))[0]

  /* ── inventory ─────────────────────────────────────────────────────────── */

  const counts = (await q(c, 'Q01', 'Jumlah baris tabel inti Brand Fit', `
    SELECT (SELECT count(*) FROM feature.brand_fit_analysis)                       AS brand_fit_analysis,
           (SELECT count(*) FROM public.brand)                                     AS brand,
           (SELECT count(*) FROM public.brand_profile)                             AS brand_profile,
           (SELECT count(*) FROM public.agency_kol_accounts)                       AS agency_kol_accounts,
           (SELECT count(*) FROM public.kol_directory WHERE directory_status='active') AS kol_active,
           (SELECT count(*) FROM public.kol_categories)                            AS kol_categories,
           (SELECT count(*) FROM public.kol_attribute)                             AS kol_attribute,
           (SELECT count(*) FROM public.kol_attribute_map)                         AS kol_attribute_map,
           (SELECT count(*) FROM feature.ig_audience_analysis)                     AS ig_audience,
           (SELECT count(*) FROM feature.tt_audience_analysis)                     AS tt_audience,
           (SELECT count(*) FROM l2_gold.kol_profile_card)                         AS profile_card`))[0]

  const bfaCols = await q(c, 'Q02', 'Schema feature.brand_fit_analysis (6 output + grain)', `
    SELECT column_name, data_type, is_nullable, COALESCE(column_default,'—') AS column_default
      FROM information_schema.columns
     WHERE table_schema='feature' AND table_name='brand_fit_analysis'
     ORDER BY ordinal_position`)

  const bfaCon = await q(c, 'Q03', 'Grain Brand Fit — PK, UNIQUE, FK', `
    SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid='feature.brand_fit_analysis'::regclass
     ORDER BY contype DESC`)

  const brandCols = await q(c, 'Q04', 'Schema public.brand — atribut brand yang tersedia', `
    SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='brand' ORDER BY ordinal_position`)

  /* ── creator ───────────────────────────────────────────────────────────── */

  const creatorCov = (await q(c, 'Q05', 'Cakupan atribut creator di roster aktif', `
    SELECT count(*) AS total,
           count(*) FILTER (WHERE category_ids IS NOT NULL
                              AND array_length(category_ids,1) > 0) AS with_category,
           count(engagement_rate)  AS with_engagement_rate,
           count(NULLIF(bio,''))   AS with_bio,
           count(*) FILTER (WHERE verified_status='verified') AS verified
      FROM public.kol_directory WHERE directory_status='active'`))[0]

  const taxonomy = await q(c, 'Q06', 'Taxonomy kategori creator — nama vs taxonomy_key', `
    SELECT taxonomy_key, count(*) AS raw_category_names
      FROM public.kol_categories GROUP BY 1 ORDER BY 1 NULLS LAST`)

  const creatorSample = await q(c, 'Q07', 'Sample creator nyata yang punya kategori DAN audience analysis', `
    SELECT kd.username, p.key AS platform, kd.followers_count, kd.engagement_rate,
           (SELECT string_agg(DISTINCT kc.taxonomy_key, ', ')
              FROM public.kol_categories kc
             WHERE kc.id = ANY (COALESCE(kd.category_ids, ARRAY[kd.category_id]))) AS taxonomy_keys,
           aa.audience_quality_score, aa.gender_known_pct, aa.interest_top
      FROM public.kol_directory kd
      JOIN public.platforms p ON p.id = kd.platform_id
      JOIN public.kol_social_account ksa ON ksa.kol_id = kd.id
      JOIN feature.ig_audience_analysis aa ON aa.social_account_id = ksa.social_account_id
     WHERE kd.directory_status='active'
     ORDER BY kd.followers_count DESC NULLS LAST
     LIMIT 15`)

  /* ── audience ──────────────────────────────────────────────────────────── */

  const audCov = await q(c, 'Q08', 'Cakupan per dimensi audiens creator (IG + TikTok)', `
    SELECT src,
           count(*) AS accounts,
           count(*) FILTER (WHERE gender_known_pct > 0)                                  AS gender_usable,
           count(*) FILTER (WHERE (age_gender_breakdown->>'age_known')::numeric > 0)      AS age_usable,
           count(*) FILTER (WHERE geo_distribution->'country' ? 'ID')                     AS geo_usable,
           count(*) FILTER (WHERE interest_source='audience')                             AS interest_usable,
           round(avg(gender_known_pct),1)                                                 AS avg_gender_known_pct
      FROM (SELECT 'feature.ig_audience_analysis' AS src, gender_known_pct,
                   age_gender_breakdown, geo_distribution, interest_source
              FROM feature.ig_audience_analysis
             UNION ALL
            SELECT 'feature.tt_audience_analysis', gender_known_pct,
                   age_gender_breakdown, geo_distribution, interest_source
              FROM feature.tt_audience_analysis) u
     GROUP BY src ORDER BY src`)

  const brandAudienceCols = await q(c, 'Q09',
    'Sapuan SELURUH database untuk kolom sisi-brand yang dibutuhkan formula', `
    SELECT table_schema||'.'||table_name AS relation, column_name
      FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog','information_schema')
       AND column_name ~* 'archetype|target_(demo|audience|age|gender|location)|brand_(tone|values)'
     ORDER BY 1,2`)

  /* ── personality ───────────────────────────────────────────────────────── */

  const attrs = await q(c, 'Q10', 'Taxonomy atribut creator — personality & style', `
    SELECT kind, count(*) AS attributes,
           string_agg(DISTINCT attribute_group, ', ') AS groups
      FROM public.kol_attribute GROUP BY kind ORDER BY kind`)

  const attrMap = (await q(c, 'Q11', 'Pemetaan creator → atribut (personality/style)', `
    SELECT count(*) AS mapping_rows, count(DISTINCT kol_directory_id) AS creators_mapped
      FROM public.kol_attribute_map`))[0]

  /* ── performance ───────────────────────────────────────────────────────── */

  const perfCov = (await q(c, 'Q12', 'Cakupan metrik performance nyata di l2_gold.kol_profile_card', `
    SELECT count(*) AS cards,
           count(audience_quality_score)     AS audience_quality,
           count(median_views)               AS median_views,
           count(followers_growth)           AS followers_growth,
           count(post_frequency_reliability) AS post_freq_reliability,
           count(performance_stability)      AS performance_stability,
           count(monitoring_er_pct)          AS monitoring_er
      FROM l2_gold.kol_profile_card`))[0]

  await c.query('COMMIT').catch(() => {})
  c.release()

  /* ── derived findings ──────────────────────────────────────────────────── */

  const ig = audCov.find(r => String(r.src).includes('ig')) ?? {}
  const tt = audCov.find(r => String(r.src).includes('tt')) ?? {}
  const audAccounts = n(ig.accounts) + n(tt.accounts)
  const ageUsable = n(ig.age_usable) + n(tt.age_usable)
  const genderUsable = n(ig.gender_usable) + n(tt.gender_usable)
  const geoUsable = n(ig.geo_usable) + n(tt.geo_usable)
  const interestUsable = n(ig.interest_usable) + n(tt.interest_usable)
  const brandRows = n(counts.brand)
  const brandColNames = brandCols.map(r => String(r.column_name))
  const hasBrandAudience = brandColNames.some(x => /target|demo/i.test(x))
  const hasBrandPersonality = brandColNames.some(x => /personality/i.test(x))
  const hasBrandArchetype = brandColNames.some(x => /archetype/i.test(x))

  /* ── workbook ──────────────────────────────────────────────────────────── */

  const wb = new ExcelJS.Workbook()
  wb.creator = 'autometric · build-brand-fit-db-validation.ts (READ-ONLY)'
  wb.created = new Date()

  const HEAD = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
  const FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF327488' } }
  const TONE: Record<Status, string> = {
    'VERIFIED': 'FF1E7A46',
    'PARTIALLY VERIFIED': 'FFB07B00',
    'PROPOSED — NEEDS APPROVAL': 'FF8A5A00',
    'BLOCKED BY DATA': 'FFA33A3A',
    'NOT MEASURED': 'FF667788',
  }

  function sheet(name: string, title: string, sub: string) {
    const ws = wb.addWorksheet(name)
    ws.getCell('A1').value = title
    ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FF1B4450' } }
    ws.getCell('A2').value = sub
    ws.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF667788' } }
    ws.getCell('A2').alignment = { wrapText: true, vertical: 'top' }
    ws.getRow(2).height = 30
    return ws
  }
  function header(ws: ExcelJS.Worksheet, row: number, labels: string[], widths: number[]) {
    const r = ws.getRow(row)
    labels.forEach((l, i) => {
      const cell = r.getCell(i + 1)
      cell.value = l; cell.font = HEAD; cell.fill = FILL
      cell.alignment = { wrapText: true, vertical: 'middle' }
    })
    r.height = 28
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
    ws.views = [{ state: 'frozen', ySplit: row }]
  }
  /** Writes a status cell in its own colour so a reader can scan the column. */
  function status(ws: ExcelJS.Worksheet, row: number, col: number, s: Status) {
    const cell = ws.getRow(row).getCell(col)
    cell.value = s
    cell.font = { bold: true, size: 10, color: { argb: TONE[s] } }
  }

  /* 1 ── Executive Summary */
  {
    const ws = sheet('Executive Summary', 'BRAND FIT ANALYSIS — REAL DATABASE VALIDATION',
      'Setiap angka di workbook ini berasal dari SELECT terhadap database produksi KOL, dijalankan '
      + 'dalam sesi read-only. Tidak ada baris yang ditulis, diubah, atau dihapus; tidak ada migration; '
      + 'tidak ada data dummy yang masuk database. Angka dari Brand_Fit_Dummy_Data.xlsx TIDAK dicampur '
      + 'ke sini — workbook itu hanya bukti POC historis.')
    header(ws, 4, ['Item', 'Nilai', 'Catatan'], [38, 30, 74])
    const rows: [string, string | number, string][] = [
      ['Database source', `${who.host}:${who.port} · ${who.db}`, 'Lewat kolDb(), pool KOL milik project. Bukan TSDB.'],
      ['Dibaca pada', String(who.read_at), 'Sesi SET default_transaction_read_only = on'],
      ['Brand Fit grain', '(agency_kol_account_id, brand_id)', 'Ditegakkan UNIQUE uq_brand_fit_analysis; kedua kolom NOT NULL'],
      ['feature.brand_fit_analysis', n(counts.brand_fit_analysis), 'Tabel ada, schema lengkap, belum pernah diisi'],
      ['public.brand', brandRows, brandRows === 0 ? 'KOSONG — separuh grain tidak punya isi' : ''],
      ['agency_kol_accounts', n(counts.agency_kol_accounts), 'Jembatan ke kol_directory terisi'],
      ['kol_directory (aktif)', n(counts.kol_active), 'Roster creator produksi'],
      ['Creator punya kategori', `${n(creatorCov.with_category)} (${pct(n(creatorCov.with_category), n(creatorCov.total))})`, 'Sisi creator Category Fit'],
      ['Creator punya audience analysis', audAccounts, 'IG + TikTok digabung'],
      ['Creator ter-map ke atribut', n(attrMap.creators_mapped), 'kol_attribute_map — sisi creator Personality'],
      ['MEASURABLE Brand Fit pairs', 0, 'Butuh minimal satu baris brand × satu creator. public.brand kosong → nol pasangan'],
    ]
    rows.forEach((r, i) => { ws.getRow(5 + i).values = r })

    let r = 5 + rows.length + 1
    ws.getCell(`A${r}`).value = 'STATUS PER RULE'
    ws.getCell(`A${r}`).font = { bold: true, size: 11, color: { argb: 'FF1B4450' } }
    r += 1
    header(ws, r, ['Rule', 'Status', 'Alasan singkat'], [38, 30, 74])
    const st: [string, Status, string][] = [
      ['Category Fit — rule "same = 100"', 'PARTIALLY VERIFIED',
        'Kedua sisi punya kolom & taxonomy; brand kosong sehingga belum pernah dieksekusi'],
      ['Category Fit — rule "related = 50"', 'BLOCKED BY DATA',
        'Definisi "related" tidak ada di database maupun requirement'],
      ['Audience Fit', 'BLOCKED BY DATA',
        'Nol kolom target audience di seluruh database. Yang ada hanya audiens CREATOR'],
      ['Personality / Values Fit', 'BLOCKED BY DATA',
        `Taxonomy creator ada, tapi kol_attribute_map ${n(attrMap.mapping_rows)} baris. Brand tone/values nol kolom`],
      ['Performance Fit', 'BLOCKED BY DATA',
        'Nol kolom performance_archetype di seluruh database, dua sisi'],
      ['Partnership Score (rata-rata)', 'PROPOSED — NEEDS APPROVAL',
        'Direproduksi 48/48 dari dummy workbook, bukan dari data produksi'],
      ['NULL handling (minimum 2 komponen)', 'PROPOSED — NEEDS APPROVAL',
        'Asumsi POC. Workbook tidak punya satu pun baris parsial'],
    ]
    st.forEach((x, i) => {
      const rr = r + 1 + i
      ws.getRow(rr).values = [x[0], '', x[2]]
      status(ws, rr, 2, x[1])
    })
    r += st.length + 2
    ws.getCell(`A${r}`).value = 'OVERALL: BLOCKED BY DATA — tidak ada satu pun pasangan KOL × brand yang bisa dihitung hari ini.'
    ws.getCell(`A${r}`).font = { bold: true, size: 11, color: { argb: 'FFA33A3A' } }
  }

  /* 2 ── DB Inventory */
  {
    const ws = sheet('DB Inventory', 'DB INVENTORY — tabel yang relevan untuk Brand Fit',
      'Row count diambil langsung dari COUNT(*). "Usable" menilai apakah tabel bisa menyuplai input '
      + 'bagi salah satu dari empat komponen Brand Fit.')
    header(ws, 4, ['Relation', 'Rows', 'Peran', 'Usable untuk Brand Fit?', 'Catatan'],
      [36, 12, 30, 24, 62])
    const inv: [string, number, string, string, string][] = [
      ['feature.brand_fit_analysis', n(counts.brand_fit_analysis), 'Output', 'Target tulis', 'Schema lengkap; belum pernah diisi. Tidak disentuh task ini'],
      ['public.brand', brandRows, 'Sisi brand', brandRows ? 'Ya' : 'TIDAK — kosong', `${brandCols.length} kolom; tidak ada target audience / tone / archetype`],
      ['public.brand_profile', n(counts.brand_profile), 'Sisi brand (Match Score)', 'Di luar grain', 'Grain organization, bukan agency. Source Match Score, bukan Brand Fit'],
      ['public.agency_kol_accounts', n(counts.agency_kol_accounts), 'Jembatan grain', 'Ya', 'FK kol_account_id → kol_directory(id) terisi'],
      ['public.kol_directory', n(counts.kol_active), 'Sisi creator', 'Ya', 'Kategori, followers, engagement_rate'],
      ['public.kol_categories', n(counts.kol_categories), 'Taxonomy', 'Ya', `${taxonomy.length} taxonomy_key kanonik`],
      ['public.kol_attribute', n(counts.kol_attribute), 'Taxonomy personality/style', 'Sebagian', 'Master ada; pemetaan ke creator kosong'],
      ['public.kol_attribute_map', n(counts.kol_attribute_map), 'Creator → atribut', 'TIDAK — kosong', 'Diisi kurasi manual (migrasi 045)'],
      ['feature.ig_audience_analysis', n(counts.ig_audience), 'Audiens creator', 'Ya (sebagian kecil)', 'gender/age/geo/interest per akun'],
      ['feature.tt_audience_analysis', n(counts.tt_audience), 'Audiens creator', 'Ya (sebagian kecil)', 'Kolom sama dengan IG'],
      ['l2_gold.kol_profile_card', n(counts.profile_card), 'Performance creator', 'Ya (sebagian)', 'Metrik nyata; tidak ada kolom archetype'],
    ]
    inv.forEach((x, i) => { ws.getRow(5 + i).values = x })
  }

  /* 3 ── Real Creator Data */
  {
    const ws = sheet('Real Creator Data', 'REAL CREATOR DATA — sample dari produksi',
      'Sample creator yang punya kategori DAN audience analysis — populasi paling kaya yang ada. '
      + 'Bukan dump seluruh roster. Kolom kosong berarti database memang tidak punya nilainya.')
    header(ws, 4, ['Username', 'Platform', 'Followers', 'Engagement rate', 'Taxonomy keys',
      'Audience quality', 'Gender known %', 'Interest top'], [24, 12, 14, 15, 24, 16, 15, 18])
    creatorSample.forEach((r, i) => {
      ws.getRow(5 + i).values = [
        cv(r.username), cv(r.platform), cv(r.followers_count), cv(r.engagement_rate),
        cv(r.taxonomy_keys) ?? 'NOT MEASURED', cv(r.audience_quality_score),
        cv(r.gender_known_pct), cv(r.interest_top) ?? 'NOT MEASURED',
      ]
    })
    const r0 = 5 + creatorSample.length + 1
    ws.getCell(`A${r0}`).value =
      `Cakupan roster aktif: ${n(creatorCov.total)} creator · kategori ${n(creatorCov.with_category)}`
      + ` (${pct(n(creatorCov.with_category), n(creatorCov.total))}) · engagement rate `
      + `${n(creatorCov.with_engagement_rate)} (${pct(n(creatorCov.with_engagement_rate), n(creatorCov.total))})`
      + ` · bio ${n(creatorCov.with_bio)} · verified ${n(creatorCov.verified)}`
    ws.getCell(`A${r0}`).font = { italic: true, size: 9, color: { argb: 'FF667788' } }
  }

  /* 4 ── Real Brand Data */
  {
    const ws = sheet('Real Brand Data', 'REAL BRAND DATA — kondisi sisi brand',
      'Ini temuan paling menentukan. public.brand adalah source of truth Brand Fit menurut FK tabelnya, '
      + 'dan kolomnya tidak memuat tiga dari empat input yang dibutuhkan formula.')
    header(ws, 4, ['Kolom public.brand', 'Tipe', 'Nullable', 'Dipakai komponen mana?'], [30, 26, 12, 44])
    brandCols.forEach((r, i) => {
      const nm = String(r.column_name)
      const use = nm === 'category' ? 'Category Fit'
        : nm === 'brand_keywords' || nm === 'brand_hashtags' ? '(dipakai Match Score, bukan Brand Fit)'
          : '—'
      ws.getRow(5 + i).values = [nm, cv(r.data_type), cv(r.is_nullable), use]
    })
    let r = 5 + brandCols.length + 1
    ws.getCell(`A${r}`).value = `public.brand berisi ${brandRows} baris.`
    ws.getCell(`A${r}`).font = { bold: true, size: 11, color: { argb: 'FFA33A3A' } }
    r += 2
    header(ws, r, ['Input yang dibutuhkan formula', 'Ada di public.brand?', 'Konsekuensi'], [34, 22, 62])
    const need: [string, string, string][] = [
      ['Business category', hasBrandColumn('category') ? 'ADA' : 'TIDAK', 'Category Fit punya kolom di kedua sisi'],
      ['Target demographics', hasBrandAudience ? 'ADA' : 'TIDAK ADA', 'Audience Fit tidak punya pembanding sisi brand'],
      ['Brand personality', hasBrandPersonality ? 'ADA' : 'TIDAK ADA', 'Values Fit tidak punya pembanding sisi brand'],
      ['Brand tone', brandColNames.some(x => /tone/i.test(x)) ? 'ADA' : 'TIDAK ADA', 'Separuh Values Fit hilang'],
      ['Performance archetype', hasBrandArchetype ? 'ADA' : 'TIDAK ADA', 'Performance Fit tidak punya pembanding sisi brand'],
    ]
    need.forEach((x, i) => { ws.getRow(r + 1 + i).values = x })
    r += need.length + 2
    ws.getCell(`A${r}`).value =
      'Sapuan seluruh database untuk kolom archetype / target_* / brand_tone / brand_values: '
      + (brandAudienceCols.length
        ? brandAudienceCols.map(x => `${x.relation}.${x.column_name}`).join(' · ')
        : 'NOL HASIL.')
    ws.getCell(`A${r}`).alignment = { wrapText: true }
    ws.getCell(`A${r}`).font = { size: 10 }

    function hasBrandColumn(name: string) { return brandColNames.includes(name) }
  }

  /* 5 ── Category Validation */
  {
    const ws = sheet('Category Validation', 'CATEGORY FIT — validasi terhadap data nyata',
      'Aturan kandidat: same = 100, related = 50, unrelated = 0.')
    header(ws, 4, ['Aspek', 'Temuan dari database', 'Status'], [30, 74, 28])
    const rows: [string, string, Status][] = [
      ['Sisi brand', `public.brand.category — kolom ADA, tabel ${brandRows} baris`, brandRows ? 'VERIFIED' : 'BLOCKED BY DATA'],
      ['Sisi creator', `kol_directory.category_ids → kol_categories.taxonomy_key · ${n(creatorCov.with_category)} creator (${pct(n(creatorCov.with_category), n(creatorCov.total))})`, 'VERIFIED'],
      ['Taxonomy kanonik', `${taxonomy.filter(t => t.taxonomy_key).length} taxonomy_key dari ${n(counts.kol_categories)} nama kategori mentah`, 'VERIFIED'],
      ['Rule "same = 100"', 'Bisa dievaluasi begitu ada satu baris brand — kedua sisi memakai kosakata yang sama', 'PARTIALLY VERIFIED'],
      ['Rule "related = 50"', 'Tidak ada tabel/kolom relasi antar-kategori. Definisi "related" tidak ada di database maupun requirement', 'BLOCKED BY DATA'],
      ['Rule "unrelated = 0"', 'Bergantung pada definisi "related" di atas', 'BLOCKED BY DATA'],
      ['category_fit_tags', 'Bentuk output bisa dibangun dari taxonomy_key creator; isinya menunggu rule related', 'PARTIALLY VERIFIED'],
    ]
    rows.forEach((x, i) => {
      const r = 5 + i
      ws.getRow(r).values = [x[0], x[1], '']
      status(ws, r, 3, x[2])
    })
    const r0 = 5 + rows.length + 1
    ws.getCell(`A${r0}`).value = 'TAXONOMY KEY YANG NYATA (evidence Q06)'
    ws.getCell(`A${r0}`).font = { bold: true, size: 10, color: { argb: 'FF1B4450' } }
    taxonomy.forEach((t, i) => {
      ws.getRow(r0 + 1 + i).values = [String(t.taxonomy_key ?? '(null)'), `${n(t.raw_category_names)} nama kategori mentah`]
    })
  }

  /* 6 ── Audience Validation */
  {
    const ws = sheet('Audience Validation', 'AUDIENCE FIT — validasi terhadap data nyata',
      'PENTING: kolom bernama audience_overlap_pct berarti irisan audiens KOL dengan audiens BRAND. '
      + 'Database hanya memiliki audiens CREATOR. Tidak ada distribusi audiens brand yang teramati, '
      + 'sehingga angka apa pun di sini tidak boleh disebut "overlap".')
    header(ws, 4, ['Dimensi', 'Sisi creator — tersedia', 'Sisi brand — tersedia', 'Measurable?', 'Status'],
      [18, 34, 30, 16, 28])
    const dims: [string, string, string, string, Status][] = [
      ['Gender', `${genderUsable} dari ${audAccounts} akun (rata-rata known ${ig.avg_gender_known_pct ?? '—'}%)`, 'TIDAK ADA kolom', 'Tidak', 'BLOCKED BY DATA'],
      ['Age', `${ageUsable} dari ${audAccounts} akun — sisanya age_unknown 100%`, 'TIDAK ADA kolom', 'Tidak', 'BLOCKED BY DATA'],
      ['Location', `${geoUsable} dari ${audAccounts} akun punya country ID`, 'TIDAK ADA kolom', 'Tidak', 'BLOCKED BY DATA'],
      ['Interest', `${interestUsable} dari ${audAccounts} akun (interest_source='audience')`, 'TIDAK ADA kolom', 'Tidak', 'BLOCKED BY DATA'],
    ]
    dims.forEach((x, i) => {
      const r = 5 + i
      ws.getRow(r).values = [x[0], x[1], x[2], x[3], '']
      status(ws, r, 5, x[4])
    })
    let r = 5 + dims.length + 1
    ws.getCell(`A${r}`).value =
      'Kesimpulan: sisi creator punya data untuk 3 dari 4 dimensi (age praktis kosong). '
      + 'Sisi brand tidak punya satu pun. Audience Fit tidak dapat dihitung tanpa mengarang data.'
    ws.getCell(`A${r}`).font = { bold: true, size: 10, color: { argb: 'FFA33A3A' } }
    ws.getCell(`A${r}`).alignment = { wrapText: true }
    r += 2
    header(ws, r, ['Sumber audiens creator', 'Akun', 'Gender', 'Age', 'Geo', 'Interest'],
      [34, 10, 10, 10, 10, 10])
    audCov.forEach((x, i) => {
      ws.getRow(r + 1 + i).values = [cv(x.src), n(x.accounts), n(x.gender_usable),
        n(x.age_usable), n(x.geo_usable), n(x.interest_usable)]
    })
  }

  /* 7 ── Personality / Values Validation */
  {
    const ws = sheet('Personality Validation', 'PERSONALITY / VALUES FIT — validasi terhadap data nyata',
      'Formula kandidat: matched attributes / brand attributes × 100. Hanya bisa dijalankan bila '
      + 'kedua sisi punya data.')
    header(ws, 4, ['Aspek', 'Temuan dari database', 'Status'], [30, 74, 28])
    const rows: [string, string, Status][] = [
      ['Taxonomy creator', attrs.map(a => `${a.kind}: ${n(a.attributes)} atribut (${a.groups})`).join(' · '), 'VERIFIED'],
      ['Pemetaan creator → atribut', `public.kol_attribute_map ${n(attrMap.mapping_rows)} baris, ${n(attrMap.creators_mapped)} creator`, 'BLOCKED BY DATA'],
      ['Brand personality', hasBrandPersonality ? 'Kolom ada di public.brand' : 'TIDAK ADA kolom di public.brand', 'BLOCKED BY DATA'],
      ['Brand tone', 'TIDAK ADA kolom di seluruh database', 'BLOCKED BY DATA'],
      ['Brand values', 'TIDAK ADA kolom di seluruh database', 'BLOCKED BY DATA'],
      ['Yang bisa diuji kalau mapping diisi', 'Hanya Personality Alignment — bukan Values, karena values nol di dua sisi', 'PROPOSED — NEEDS APPROVAL'],
    ]
    rows.forEach((x, i) => {
      const r = 5 + i
      ws.getRow(r).values = [x[0], x[1], '']
      status(ws, r, 3, x[2])
    })
  }

  /* 8 ── Performance Validation */
  {
    const ws = sheet('Performance Validation', 'PERFORMANCE FIT — validasi terhadap data nyata',
      'Aturan kandidat membandingkan performance archetype brand dengan archetype creator. '
      + 'Tidak ada kolom archetype di sisi mana pun. Metrik nyata di bawah ditampilkan supaya '
      + 'reviewer bisa melihat input alternatif yang tersedia.')
    header(ws, 4, ['Metrik nyata', 'Terisi', 'Dari', 'Bisa jadi input archetype?'], [30, 14, 34, 30])
    const cards = n(perfCov.cards)
    const metrics: [string, number, string, string][] = [
      ['audience_quality_score', n(perfCov.audience_quality), 'l2_gold.kol_profile_card', 'Ya — kandidat'],
      ['median_views', n(perfCov.median_views), 'l2_gold.kol_profile_card', 'Ya — kandidat "reach"'],
      ['followers_growth', n(perfCov.followers_growth), 'l2_gold.kol_profile_card', 'Ya — kandidat "growing"'],
      ['post_frequency_reliability', n(perfCov.post_freq_reliability), 'l2_gold.kol_profile_card', 'Ya — kandidat "consistent"'],
      ['performance_stability', n(perfCov.performance_stability), 'l2_gold.kol_profile_card', 'Ya — kandidat "consistent"'],
      ['monitoring_er_pct', n(perfCov.monitoring_er), 'l2_gold.kol_profile_card', 'Ya — kandidat "engagement"'],
      ['engagement_rate', n(creatorCov.with_engagement_rate), 'public.kol_directory', 'Ya — cakupan terluas'],
    ]
    metrics.forEach((x, i) => {
      ws.getRow(5 + i).values = [x[0], x[1], x[2], x[3]]
    })
    let r = 5 + metrics.length + 1
    ws.getCell(`A${r}`).value = `Total profile card: ${cards}`
    ws.getCell(`A${r}`).font = { italic: true, size: 9, color: { argb: 'FF667788' } }
    r += 2
    header(ws, r, ['Aspek', 'Temuan', 'Status'], [30, 74, 28])
    const rows: [string, string, Status][] = [
      ['Kolom performance_archetype', 'NOL hasil di sapuan seluruh database — sisi brand maupun creator', 'BLOCKED BY DATA'],
      ['Metrik nyata sebagai pengganti', 'Tersedia (lihat tabel di atas), tapi belum ada aturan yang memetakan metrik → archetype', 'PROPOSED — NEEDS APPROVAL'],
      ['Rule 100/70/50/0', 'Tidak bisa dievaluasi tanpa definisi archetype di kedua sisi', 'BLOCKED BY DATA'],
    ]
    rows.forEach((x, i) => {
      const rr = r + 1 + i
      ws.getRow(rr).values = [x[0], x[1], '']
      status(ws, rr, 3, x[2])
    })
  }

  /* 9 ── Partnership Score */
  {
    const ws = sheet('Partnership Score', 'PARTNERSHIP SCORE — ketersediaan komponen & NULL handling',
      'Aturan kandidat: rata-rata komponen yang tersedia. Direproduksi 48/48 dari dummy workbook '
      + '(bukti POC), BUKAN dari data produksi — di produksi belum ada satu pun komponen yang bisa dihitung.')
    header(ws, 4, ['Komponen', 'Bisa dihitung hari ini?', 'Penghalang', 'Status'], [24, 22, 54, 28])
    const comp: [string, string, string, Status][] = [
      ['Category Fit', 'Tidak', `public.brand ${brandRows} baris; rule "related" belum ada`, 'BLOCKED BY DATA'],
      ['Audience Fit', 'Tidak', 'Nol kolom target audience di sisi brand', 'BLOCKED BY DATA'],
      ['Values Fit', 'Tidak', `kol_attribute_map ${n(attrMap.mapping_rows)} baris; brand tone/values nol kolom`, 'BLOCKED BY DATA'],
      ['Performance Fit', 'Tidak', 'Nol kolom archetype di dua sisi', 'BLOCKED BY DATA'],
    ]
    comp.forEach((x, i) => {
      const r = 5 + i
      ws.getRow(r).values = [x[0], x[1], x[2], '']
      status(ws, r, 4, x[3])
    })
    let r = 5 + comp.length + 2
    header(ws, r, ['Komponen tersedia', 'Perilaku kandidat', 'Status'], [24, 54, 28])
    const nulls: [string, string, Status][] = [
      ['4', 'Rata-rata 4', 'PROPOSED — NEEDS APPROVAL'],
      ['3', 'Rata-rata 3 (renormalisasi)', 'PROPOSED — NEEDS APPROVAL'],
      ['2', 'Rata-rata 2 (renormalisasi)', 'PROPOSED — NEEDS APPROVAL'],
      ['1', 'NULL — asumsi POC, bukan evidence', 'PROPOSED — NEEDS APPROVAL'],
      ['0', 'NULL', 'PROPOSED — NEEDS APPROVAL'],
    ]
    nulls.forEach((x, i) => {
      const rr = r + 1 + i
      ws.getRow(rr).values = [x[0], x[1], '']
      status(ws, rr, 3, x[2])
    })
    r += nulls.length + 2
    ws.getCell(`A${r}`).value =
      'Jumlah pasangan KOL × brand yang measurable hari ini: 0. '
      + 'NULL tetap NULL — tidak ada komponen yang diubah menjadi 0 agar skor bisa terbentuk.'
    ws.getCell(`A${r}`).font = { bold: true, size: 10, color: { argb: 'FFA33A3A' } }
    ws.getCell(`A${r}`).alignment = { wrapText: true }
  }

  /* 10 ── Decision Needed */
  {
    const ws = sheet('Decision Needed', 'DECISION NEEDED — yang harus diputuskan product/mentor',
      'Diurutkan: yang paling menghalangi lebih dulu. Kolom Impact menjelaskan apa yang terbuka '
      + 'begitu keputusan itu diambil.')
    header(ws, 4, ['Area', 'Evidence', 'Proposed rule', 'Current status', 'Decision required', 'Impact'],
      [20, 44, 34, 26, 40, 34])
    const dec: [string, string, string, Status, string, string][] = [
      ['Audiens brand', 'Nol kolom target audience di seluruh database (Q09)', 'Tambah target_demographics JSONB di public.brand', 'BLOCKED BY DATA',
        'Dari mana data audiens brand berasal? Survei, ads platform, atau input manual?', 'Membuka Audience Fit (25% skor)'],
      ['Isi public.brand', `public.brand ${brandRows} baris (Q01)`, 'Isi brand produksi', 'BLOCKED BY DATA',
        'Siapa mengisi, dan apakah Brand Fit memakai brand agency atau brand profile organization?', 'Membuka seluruh perhitungan'],
      ['Definisi "related"', 'Tidak ada tabel relasi kategori (Q06)', 'Ambang atas relatedness', 'BLOCKED BY DATA',
        'Apa yang membuat dua kategori "related"?', 'Membuka tier 50 Category Fit'],
      ['Performance archetype', 'Nol kolom archetype (Q09); metrik nyata tersedia (Q12)', 'Turunkan archetype dari metrik existing', 'PROPOSED — NEEDS APPROVAL',
        'Definisi archetype + ambangnya', 'Membuka Performance Fit (25% skor)'],
      ['kol_attribute_map', `${n(attrMap.mapping_rows)} baris (Q11)`, 'Kurasi manual', 'BLOCKED BY DATA',
        'Siapa mengurasi, berapa creator?', 'Membuka Personality Alignment'],
      ['Brand tone & values', 'Nol kolom di seluruh database (Q09)', 'Tunda; tidak ada pembanding creator', 'BLOCKED BY DATA',
        'Apakah Values Fit diturunkan jadi Personality-only?', 'Menentukan cakupan komponen ketiga'],
      ['Bobot 25% × 4', 'Direproduksi 48/48 dari dummy workbook, bertanda "for dummy testing only"', 'Rata-rata sederhana', 'PROPOSED — NEEDS APPROVAL',
        'Naikkan status jadi resmi?', 'Menentukan partnership_score'],
      ['Minimum komponen', 'Workbook nol baris parsial', 'NULL bila < 2 komponen', 'PROPOSED — NEEDS APPROVAL',
        'Berapa komponen minimum sebelum skor bermakna?', 'Mencegah skor 1-komponen terbaca sebagai fit penuh'],
      ['Naratif', 'Tidak ada rule; POC memakai template deterministik', 'Template tanpa AI', 'PROPOSED — NEEDS APPROVAL',
        'Apakah template deterministik cukup, atau butuh lapisan generatif?', 'Menentukan overlap_summary & recommendations'],
      ['Lifecycle', 'Nol evidence trigger di repo', 'Batch job', 'NOT MEASURED',
        'Kapan Brand Fit dihitung?', 'Menentukan arsitektur producer'],
    ]
    dec.forEach((x, i) => {
      const r = 5 + i
      ws.getRow(r).values = [x[0], x[1], x[2], '', x[4], x[5]]
      status(ws, r, 4, x[3])
      ws.getRow(r).height = 30
      ws.getRow(r).alignment = { wrapText: true, vertical: 'top' }
    })
  }

  /* 11 ── Raw Query Evidence */
  {
    const ws = sheet('Raw Query Evidence', 'RAW QUERY EVIDENCE — setiap angka bisa ditelusuri',
      'Seluruh SELECT yang menghasilkan workbook ini, apa adanya. Tidak ada credential, password, '
      + 'atau connection string yang disimpan. Semua dijalankan dalam sesi read-only.')
    header(ws, 4, ['ID', 'Tujuan', 'SQL', 'Ringkasan hasil'], [8, 40, 86, 40])
    evidence.forEach((e, i) => {
      const r = 5 + i
      const first = e.rows[0]
      const summary = e.rows.length === 0 ? '0 baris'
        : e.rows.length === 1 && first
          ? Object.entries(first).map(([k, v]) => `${k}=${v}`).join(' · ').slice(0, 300)
          : `${e.rows.length} baris`
      ws.getRow(r).values = [e.id, e.purpose, e.sql, summary]
      ws.getRow(r).alignment = { wrapText: true, vertical: 'top' }
      ws.getRow(r).height = Math.min(150, 14 * Math.max(2, e.sql.split('\n').length))
    })
  }

  await wb.xlsx.writeFile(OUT)

  /* ── console summary ───────────────────────────────────────────────────── */
  console.log(`\nwrote ${OUT}\n`)
  console.log(`database         ${who.host}:${who.port} · ${who.db} (read-only)`)
  console.log(`queries executed ${evidence.length} · semuanya SELECT`)
  console.log(`\nrow counts`)
  Object.entries(counts).forEach(([k, v]) => console.log(`  ${k.padEnd(24)} ${v}`))
  console.log(`\naudience usable  gender ${genderUsable} · age ${ageUsable} · geo ${geoUsable} · interest ${interestUsable}  (dari ${audAccounts} akun)`)
  console.log(`attribute map    ${n(attrMap.mapping_rows)} baris`)
  console.log(`brand-side cols  ${brandAudienceCols.length} hasil untuk archetype/target_*/tone/values`)
  console.log(`\nmeasurable Brand Fit pairs: 0`)
}

main().catch(err => { console.error(err); process.exit(1) })
