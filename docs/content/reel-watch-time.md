# Content Overview › Section: Reel Watch Time by Duration

Bar vertikal **rata-rata completion (%) reel Instagram per bucket durasi** + insight "Sweet Spot". Window current. Spesifik **Instagram (reel/video)**.

Kode: `src/lib/dashboard/content.ts` → `reelWatch()`.

## Tabel sumber per elemen

| Elemen UI | Tabel | Kolom | Rumus |
|---|---|---|---|
| **Bucket durasi** | `l1_silver.unified_post` | `duration_s` | dipetakan ke 5 bucket (lihat bawah) |
| **Nilai bar (completion %)** | `l1_silver.unified_post` | `avg_watch_time`, `duration_s` | `AVG( LEAST(100, avg_watch_time / duration_s × 100) )` per bucket |
| **Sweet Spot** | — (turunan) | — | bucket dengan completion tertinggi vs terendah |

### Pemetaan durasi → bucket

| `duration_s` (detik) | Bucket |
|---|---|
| `< 15` | `0–15s` |
| `15 – < 30` | `15–30s` |
| `30 – < 45` | `30–45s` |
| `45 – < 60` | `45–60s` |
| `≥ 60` | `60s+` |

## Sweet Spot (teks otomatis)

- Ambil bucket dengan completion **tertinggi** (`best`) & **terendah** (`worst`) di antara bucket yang ada datanya.
- Teks: *"Reel `<best>` menahan rata-rata completion `x%`, sementara `<worst>` turun ke `y%` — durasi pendek mempertahankan penonton lebih baik."*
- Bila tak ada data → *"Belum ada data watch time reel pada periode ini."*

## Contoh SQL

```sql
SELECT
  CASE
    WHEN p.duration_s < 15 THEN '0–15s'
    WHEN p.duration_s < 30 THEN '15–30s'
    WHEN p.duration_s < 45 THEN '30–45s'
    WHEN p.duration_s < 60 THEN '45–60s'
    ELSE '60s+'
  END AS bucket,
  AVG(LEAST(100, p.avg_watch_time / p.duration_s * 100)) AS comp
FROM l1_silver.unified_post p
JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
JOIN public.brands b ON b.id = bsa.brand_id
WHERE b.organization_id = $1
  AND p.platform = 'instagram'
  AND p.post_date::date BETWEEN $2 AND $3
  AND p.duration_s > 0 AND p.avg_watch_time > 0    -- hanya konten video/reel
  AND ($4::uuid IS NULL OR bsa.brand_id = $4)
GROUP BY 1;
```

## Catatan

- **Completion per post** = `avg_watch_time / duration_s × 100`, di-`LEAST(100, …)` agar tidak melebihi 100% bila watch time > durasi (loop/replay).
- Filter `duration_s > 0 AND avg_watch_time > 0` otomatis menyeleksi konten video/reel (carousel/image punya `duration_s` null/0).
- Bucket tanpa post bernilai `0` (bar minimum). Grid akhir selalu 5 bucket berurutan.
- Warna bar: hijau `≥ 60%`, kuning `≥ 40%`, merah `< 40%` (di komponen).
