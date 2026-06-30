# Overview › Section: Brand Performance Matrix

Tabel benchmarking "Cross-brand, cross-platform". Satu baris = kombinasi **brand × platform** pada window current. Diurut menurun berdasarkan **Score**.

Kode: `src/lib/dashboard/overview.ts` → `brandMatrix()`.

## Tabel sumber per kolom

| Kolom UI | Tabel | Kolom | Rumus |
|---|---|---|---|
| **Brand** | `public.brands` | `name` | nama brand (join `bmd.brand_id = brands.id`) |
| **Platform** | `l2_gold.brand_metric_daily` | `platform` | grup per platform |
| **Followers** | `l1_silver.unified_profile` | `follower_count` | `follower_count` terakhir per akun (`DISTINCT ON (brand_id) ORDER BY profile_date DESC`), lalu `SUM` per brand × platform |
| **Reach** | `l2_gold.brand_metric_daily` | `reach_sum` | `SUM(reach_sum)` |
| **Engagement** | `l2_gold.brand_metric_daily` | `engagement_sum` | `SUM(engagement_sum)` |
| **ER** | `l2_gold.brand_metric_daily` | `engagement_sum`, `er_denominator_sum` | `SUM(engagement_sum) / SUM(er_denominator_sum) × 100` |
| **Posts** | `l2_gold.brand_metric_daily` | `post_count` | `SUM(post_count)` |
| **Trend** | `l2_gold.brand_metric_daily` | `engagement_sum`, `metric_date` | bandingkan paruh window (lihat bawah) |
| **Score** | — (turunan) | — | heuristik gabungan (lihat bawah) |

## Trend (ikon panah)

Bandingkan engagement **paruh-2 vs paruh-1** window (`mid = anchor − floor(days/2)`):

| Kondisi | Trend |
|---|---|
| `eng2 > eng1 × 1.05` | `up` (naik) |
| `eng2 < eng1 × 0.95` | `down` (turun) |
| selain itu | `flat` |

dengan `eng1 = SUM(engagement_sum) WHERE metric_date ≤ mid`, `eng2 = SUM(...) WHERE metric_date > mid`.

## Score (0–100)

Normalisasi **min-max** tiap metrik lintas baris matrix, lalu bobot:

```
score = round( (norm(ER)×0.5 + norm(Reach)×0.3 + norm(Posts)×0.2) × 100 )
        dibatasi 1..100
norm(x) = (x − min) / (max − min)   // 0.5 bila semua nilai sama
```

Warna score di UI: ≥85 hijau, ≥70 kuning, selain itu merah.

## Contoh SQL (metrik utama per brand × platform)

```sql
SELECT b.name AS brand, bmd.platform,
       SUM(bmd.reach_sum)            AS reach,
       SUM(bmd.engagement_sum)       AS eng,
       SUM(bmd.post_count)           AS posts,
       SUM(bmd.er_denominator_sum)   AS erden,
       SUM(bmd.engagement_sum) FILTER (WHERE bmd.metric_date <= $5) AS eng1,
       SUM(bmd.engagement_sum) FILTER (WHERE bmd.metric_date >  $5) AS eng2
FROM l2_gold.brand_metric_daily bmd
JOIN public.brands b ON b.id = bmd.brand_id
WHERE b.organization_id = $1
  AND ($2 = 'all' OR bmd.platform = $2)
  AND bmd.metric_date BETWEEN $3 AND $4
  AND ($6::uuid IS NULL OR bmd.brand_id = $6)
GROUP BY b.name, bmd.platform;   -- $5 = mid
```

## Catatan

- Followers diambil dari **silver** (gold tidak menyimpan follower absolut).
- Saat satu brand dipilih di switcher, matrix hanya menampilkan brand itu dipecah per platform.
