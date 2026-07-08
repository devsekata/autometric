# Content Overview › Section: Content Volume by Week

Bar vertikal **jumlah post per minggu** + insight "Consistency Gap". Window current. Mengikuti platform toggle.

Kode: `src/lib/dashboard/content.ts` → `contentVolume()`.

## Tabel sumber per elemen

| Elemen UI | Tabel | Kolom | Rumus |
|---|---|---|---|
| **Bucket minggu** | `l2_gold.brand_metric_daily` | `metric_date` | `date_trunc('week', metric_date)` |
| **Nilai bar** | `l2_gold.brand_metric_daily` | `post_count` | `SUM(post_count)` per minggu |
| **Label** | — (turunan) | — | `W1, W2, …` urut kronologis |
| **Consistency Gap** | — (turunan) | — | penurunan WoW terbesar |

## Consistency Gap (teks otomatis)

- Hitung penurunan week-over-week tiap minggu: `(prev − cur) / prev`.
- Ambil penurunan terbesar; jika `≥ 15%` → teks: *"`Wk` mengalami penurunan volume posting `n%` dibanding minggu sebelumnya — audiens menghukum inkonsistensi, jaga ritme posting."*
- Jika tak ada penurunan signifikan → *"Volume posting relatif konsisten antar minggu pada periode ini."*
- Bila tak ada data → *"Belum ada data volume posting pada periode ini."*

## Contoh SQL

```sql
SELECT date_trunc('week', bmd.metric_date) AS wk,
       SUM(bmd.post_count)                 AS posts
FROM l2_gold.brand_metric_daily bmd
JOIN public.brands b ON b.id = bmd.brand_id
WHERE b.organization_id = $1
  AND ($2 = 'all' OR bmd.platform = $2)
  AND bmd.metric_date BETWEEN $3 AND $4
  AND ($5::uuid IS NULL OR bmd.brand_id = $5)
GROUP BY date_trunc('week', bmd.metric_date)
ORDER BY wk;
```

## Catatan

- Minggu ISO (`date_trunc('week', …)` mulai Senin). Minggu pertama/terakhir window bisa **parsial** (lebih sedikit hari) → wajar kalau bar ujung lebih pendek.
- Sumber gold (`post_count`), jadi konsisten dengan KPI "Total Posts": `SUM` semua minggu ≈ Total Posts (selisih kecil mungkin muncul bila window tidak pas batas minggu).
