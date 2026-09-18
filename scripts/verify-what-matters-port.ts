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
 * Referensinya di-vendor di `scripts/what-matters/what_matters_scoring.py`:
 * salinan repo scrapper pada commit 0d6e571, ditambah perubahan Content
 * Quality dari commit 5cf0578 (beserta `metrics_thresholds.py` yang ia pakai).
 *
 * ── Content Quality kini DIBANDINGKAN ──────────────────────────────────────
 * Dulu Python selalu None di sini dan skrip ini menegaskan divergensinya.
 * Sejak 5cf0578 referensinya menghitung sendiri (Engagement 50 + Views 30 +
 * Consistency 20 atas `l2_gold.post_metric`), jadi kontrak lamanya usang dan
 * diganti paritas: ringkasan post, label stability, dan skor akhirnya
 * dibandingkan nilai per nilai.
 *
 * ── Satu kriteria masih SENGAJA berbeda ────────────────────────────────────
 * `brand_safety` masih None di Python dan memakai formula Brand Match yang
 * sudah locked, jadi tidak dibandingkan — skrip ini menegaskan Python memang
 * masih None di sana.
 *
 * Butuh `python` di PATH. Read-only: tidak menyentuh database sama sekali.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  audienceQualityScore, communityStrengthScore, consistencyScore,
  contentQualityScore, engagementScore, meanAvailable, ordinalScore,
  percentileScore, reachProxyScore, stabilityLabel, summarisePostQuality,
  whatMattersScore, type PostQualityInput,
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

/* Content Quality: grid komponen mentah, plus kumpulan post yang menekan
 * aturan sampel (likes_hidden, kolaborasi, views 0/NULL, ER/followers NULL). */
const CQ_ER = [null, 0.5, 3.4, 500.0]
const CQ_VIEWS = [null, 1200, 999_999_999]
const CQ_SD = [null, 0.5, 1.0, 2.0, 3.0, 7.5]
const CQ_N = [null, 0, 2, 3, 10]
const p = (
  eng: number | null, foll: number | null, er: number | null, views: number | null,
  hidden: boolean | null = false, kolab: boolean | null = false,
): PostQualityInput => ({
  engagement_owned: eng, followers_at_post_date: foll, er_followers: er,
  views, likes_hidden: hidden, is_collaboration: kolab,
})
const CQ_POSTS: PostQualityInput[][] = [
  [],
  [p(20, 1000, 0.02, 5000)],
  [p(20, 1000, 0.02, 5000), p(21, 1000, 0.021, 6000),
    p(19, 1000, 0.019, 5500), p(20, 1000, 0.02, 5200)],
  [p(5, 1000, 0.005, 5000), p(80, 1000, 0.08, 6000),
    p(10, 1000, 0.01, 5500), p(120, 1000, 0.12, 5200)],
  [p(null, null, null, 5000), p(null, null, null, 999_999, true),
    p(null, null, null, 999_999, false, true), p(null, null, null, 0),
    p(null, null, null, null)],
  [p(33, 12_000, 0.00275, null), p(40, null, null, 700), p(7, 900, 0.0077778, 1500),
    p(null, 5000, null, 2500, null, null), p(64, 2000, 0.032, 480_000)],
]

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

# Content Quality (sejak scrapper 5cf0578).
import metrics_thresholds as mt
CQ_ER = json.loads(${JSON.stringify(JSON.stringify(CQ_ER))})
CQ_VIEWS = json.loads(${JSON.stringify(JSON.stringify(CQ_VIEWS))})
CQ_SD = json.loads(${JSON.stringify(JSON.stringify(CQ_SD))})
CQ_N = json.loads(${JSON.stringify(JSON.stringify(CQ_N))})
CQ_POSTS = json.loads(${JSON.stringify(JSON.stringify(CQ_POSTS))})
out["cq_stability"] = [wm._ordinal_ke_skor(mt.klasifikasi_stability(sd, n), wm.TINGKAT_STABILITAS)
                       for sd in CQ_SD for n in CQ_N]
out["content_quality"] = [wm.content_quality_score(e, POP_ER, v, POP_VIEWS, sd, n)
                          for e in CQ_ER for v in CQ_VIEWS for sd in CQ_SD for n in CQ_N]
ringkas = [wm.ringkas_post_content_quality(ps) for ps in CQ_POSTS]
out["cq_summary"] = [x for r in ringkas
                     for x in (r["er_pct"], r["median_views"], r["er_sd_pp"], r["er_posts"])]
out["cq_from_posts"] = [wm.content_quality_score(r["er_pct"], POP_ER, r["median_views"],
                                                 POP_VIEWS, r["er_sd_pp"], r["er_posts"])
                        for r in ringkas]

# Kriteria yang sengaja belum dihitung di Python.
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
    cq_stability: CQ_SD.flatMap(sd => CQ_N.map(n =>
      ordinalScore(stabilityLabel(sd, n), TINGKAT_STABILITAS))),
    content_quality: CQ_ER.flatMap(e => CQ_VIEWS.flatMap(v => CQ_SD.flatMap(sd =>
      CQ_N.map(n => contentQualityScore(e, POP_ER, v, POP_VIEWS, sd, n)))))
    ,
    cq_summary: CQ_POSTS.flatMap(ps => {
      const r = summarisePostQuality(ps)
      return [r.erPct, r.medianViews, r.erSdPp, r.erPosts]
    }),
    cq_from_posts: CQ_POSTS.map(ps => {
      const r = summarisePostQuality(ps)
      return contentQualityScore(r.erPct, POP_ER, r.medianViews, POP_VIEWS, r.erSdPp, r.erPosts)
    }),
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
