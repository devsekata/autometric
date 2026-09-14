/**
 * Memastikan port TypeScript What Matters mereproduksi referensi Python-nya.
 *
 *   npm run whatmatters:port:verify
 *
 * Pola yang sama dengan `verify-brand-match-port.ts`: Python tetap menjadi
 * REFERENCE IMPLEMENTATION, TypeScript adalah port, dan skrip ini yang membuat
 * port itu aman. Dua salinan sebuah formula adalah cara mereka berpisah diam-
 * diam; satu-satunya penangkalnya adalah menjalankan keduanya atas input yang
 * sama dan membandingkan hasilnya.
 *
 * Referensinya di-vendor di `scripts/what-matters/what_matters_scoring.py`,
 * disalin apa adanya dari repo scrapper pada commit 0d6e571.
 *
 * ── Satu kriteria SENGAJA berbeda ──────────────────────────────────────────
 * `content_quality_score()` di Python selalu mengembalikan None. Produk
 * memutuskan untuk tetap menghitungnya (Engagement 40 + Format 30 + Topic 30),
 * jadi kriteria ke-6 TIDAK dibandingkan — skrip ini menegaskan Python memang
 * masih None di sana, supaya divergensinya tetap disengaja dan bukan hasil
 * port yang keliru. `brand_safety` juga None di Python dan memakai formula
 * Brand Match yang sudah locked, jadi diperlakukan sama.
 *
 * Butuh `python` di PATH. Read-only: tidak menyentuh database sama sekali.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  audienceQualityScore, communityStrengthScore, consistencyScore,
  engagementScore, meanAvailable, ordinalScore, percentileScore,
  reachProxyScore, whatMattersScore,
} from '@/lib/discover/whatMatters/score'
import {
  TINGKAT_RELIABILITAS, TINGKAT_STABILITAS, type CriterionKey,
} from '@/lib/discover/whatMatters/model'

let failures = 0
let compared = 0

function check(label: string, ok: boolean, detail = '') {
  if (ok) compared++
  else { failures++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

/** Sama sampai 6 desimal: cukup ketat untuk menangkap perbedaan formula. */
const near = (a: number | null, b: number | null): boolean => {
  if (a === null || b === null) return a === b
  return Math.abs(a - b) < 1e-6
}

/**
 * Populasi dan nilai uji dipilih untuk menekan cabang yang mudah salah:
 * populasi satu elemen, nilai di luar populasi, nilai persis sama dengan
 * anggota populasi, dan null di mana-mana.
 */
const POP_ER = [0.5, 1.2, 3.4, 3.4, 7.9, 12.0, 223.0]
const POP_VIEWS = [1200, 45_000, 345_000, 136_000_000]
const ER_CASES = [null, 0.5, 3.4, 8.0, 223.0, 500.0, -1]
const VIEW_CASES = [null, 1200, 100_000, 136_000_000, 999_999_999]
const AQ_CASES = [null, 0, 42.5, 100, 130, -5]
const LABELS = [null, 'Low', 'Medium', 'High', 'Low Stability',
  'Medium Stability', 'High Stability', 'Tidak Dikenal']

function pythonResults(): Record<string, (number | null)[]> {
  const dir = mkdtempSync(join(tmpdir(), 'wm-port-'))
  const script = join(dir, 'run.py')
  writeFileSync(script, `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(process.cwd(), 'scripts', 'what-matters'))})
import what_matters_scoring as wm

# Lewat json.loads, bukan literal Python: JSON menulis \`null\` sedangkan Python
# mengeja \`None\`, jadi menempelkan hasil JSON.stringify apa adanya akan
# NameError. json.loads memetakannya ke None — dan None adalah justru nilai
# yang paling penting diuji di sini.
POP_ER = json.loads(${JSON.stringify(JSON.stringify(POP_ER))})
POP_VIEWS = json.loads(${JSON.stringify(JSON.stringify(POP_VIEWS))})
ER = json.loads(${JSON.stringify(JSON.stringify(ER_CASES))})
VIEWS = json.loads(${JSON.stringify(JSON.stringify(VIEW_CASES))})
AQ = json.loads(${JSON.stringify(JSON.stringify(AQ_CASES))})
LABELS = json.loads(${JSON.stringify(JSON.stringify(LABELS))})

out = {}
out["percentile_er"] = [wm.persentil_ke_skor(v, POP_ER) for v in ER]
out["percentile_single"] = [wm.persentil_ke_skor(v, [3.4]) for v in ER]
out["percentile_empty"] = [wm.persentil_ke_skor(v, []) for v in ER]
out["engagement"] = [wm.engagement_score(v, POP_ER) for v in ER]
out["reach"] = [wm.reach_proxy_score(v, POP_VIEWS) for v in VIEWS]
out["audience_quality"] = [wm.audience_quality_score(a, b) for a in AQ for b in AQ]
out["consistency"] = [wm.consistency_score(a, b) for a in LABELS for b in LABELS]
out["community"] = [wm.community_strength_score(a, e, POP_ER) for a in AQ for e in ER]
out["mean_available"] = [wm._rata_rata_tersedia(a, b) for a in AQ for b in AQ]
out["ordinal_stab"] = [wm._ordinal_ke_skor(l, wm.TINGKAT_STABILITAS) for l in LABELS]
out["ordinal_rel"] = [wm._ordinal_ke_skor(l, wm.TINGKAT_RELIABILITAS) for l in LABELS]

# Kriteria yang sengaja belum dihitung di Python.
out["content_quality_is_none"] = [wm.content_quality_score()]
out["brand_safety_is_none"] = [wm.brand_safety_score()]

# Agregat: subset kriteria terpilih, sebagian NULL.
skor = {"engagement": 80.0, "audience_quality": None, "consistency": 40.0,
        "community": None, "reach": 10.0, "content_quality": None,
        "brand_safety": None}
out["aggregate"] = [
    wm.what_matters_score(skor, ["engagement"]),
    wm.what_matters_score(skor, ["engagement", "audience_quality"]),
    wm.what_matters_score(skor, ["engagement", "consistency", "reach"]),
    wm.what_matters_score(skor, ["audience_quality", "community"]),
    wm.what_matters_score(skor, []),
]
print(json.dumps(out))
`, 'utf8')
  const raw = execFileSync('python', [script], { encoding: 'utf8', timeout: 120_000 })
  return JSON.parse(raw)
}

function main() {
  console.log('\nWhat Matters — port TypeScript vs referensi Python\n')

  let py: Record<string, (number | null)[]>
  try {
    py = pythonResults()
  } catch (err) {
    console.error('Tidak bisa menjalankan referensi Python:',
      err instanceof Error ? err.message.slice(0, 200) : String(err))
    console.error('Pastikan `python` ada di PATH.')
    process.exit(1)
  }

  const ts: Record<string, (number | null)[]> = {
    percentile_er: ER_CASES.map(v => percentileScore(v, POP_ER)),
    percentile_single: ER_CASES.map(v => percentileScore(v, [3.4])),
    percentile_empty: ER_CASES.map(v => percentileScore(v, [])),
    engagement: ER_CASES.map(v => engagementScore(v, POP_ER)),
    reach: VIEW_CASES.map(v => reachProxyScore(v, POP_VIEWS)),
    audience_quality: AQ_CASES.flatMap(a => AQ_CASES.map(b => audienceQualityScore(a, b))),
    consistency: LABELS.flatMap(a => LABELS.map(b => consistencyScore(a, b))),
    community: AQ_CASES.flatMap(a => ER_CASES.map(e => communityStrengthScore(a, e, POP_ER))),
    mean_available: AQ_CASES.flatMap(a => AQ_CASES.map(b => meanAvailable(a, b))),
    ordinal_stab: LABELS.map(l => ordinalScore(l, TINGKAT_STABILITAS)),
    ordinal_rel: LABELS.map(l => ordinalScore(l, TINGKAT_RELIABILITAS)),
    aggregate: (() => {
      const s = {
        engagement: 80, audience_quality: null, consistency: 40,
        community: null, reach: 10, content_quality: null, brand_safety: null,
      }
      const sel = (...k: string[]) => whatMattersScore(s, k as CriterionKey[])
      return [
        sel('engagement'),
        sel('engagement', 'audience_quality'),
        sel('engagement', 'consistency', 'reach'),
        sel('audience_quality', 'community'),
        sel(),
      ]
    })(),
  }

  for (const key of Object.keys(ts)) {
    const a = py[key]
    const b = ts[key]
    if (!a) { check(`${key} hadir di Python`, false, 'kunci tidak ada'); continue }
    if (a.length !== b.length) {
      check(`${key} panjang sama`, false, `python ${a.length} vs ts ${b.length}`)
      continue
    }
    let bad = 0
    for (let i = 0; i < a.length; i++) if (!near(a[i], b[i])) {
      if (bad === 0) check(`${key}[${i}]`, false, `python ${a[i]} vs ts ${b[i]}`)
      bad++
    }
    if (bad === 0) {
      compared += a.length
      console.log(`  ok    ${key.padEnd(22)} ${a.length} nilai identik`)
    } else {
      console.error(`        ${key}: ${bad} dari ${a.length} nilai berbeda`)
    }
  }

  // Divergensi yang disengaja, ditegaskan bukan ditebak.
  check('content_quality masih None di Python (divergensi disengaja)',
    py.content_quality_is_none?.[0] === null)
  check('brand_safety masih None di Python (divergensi disengaja)',
    py.brand_safety_is_none?.[0] === null)

  console.log(
    failures === 0
      ? `\nOK — port TypeScript mereproduksi Python persis. ${compared} nilai dibandingkan.\n`
      : `\n${failures} perbedaan ditemukan.\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main()
