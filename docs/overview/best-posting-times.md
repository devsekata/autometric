# Overview › Section: Best Posting Times

Heatmap **hari × jam (WIB)** berdasarkan **rata-rata engagement per post** + insight "Top Window". Window current.

> Memakai **rata-rata** (bukan total) engagement supaya tidak bias ke slot yang sekadar sering diposting — heatmap mencerminkan **efektivitas** jam posting, bukan volume.

> Satu-satunya section yang sumbernya **silver** (`l1_silver.unified_post`) — gold tidak punya agregasi posting per hari×jam.

Kode: `src/lib/dashboard/overview.ts` → `postingHeatmap()`.

## Tabel sumber per elemen

| Elemen UI | Tabel | Kolom | Rumus |
|---|---|---|---|
| **Baris (hari)** | `l1_silver.unified_post` | `post_date` | `EXTRACT(ISODOW FROM post_date AT TIME ZONE 'Asia/Jakarta')` → 1=Senin … 7=Minggu |
| **Kolom (slot jam)** | `l1_silver.unified_post` | `post_date` | `EXTRACT(HOUR …)` dipetakan ke 6 slot: `08:00 / 12:00 / 15:00 / 18:00 / 20:00 / 22:00` |
| **Nilai sel** | `l1_silver.unified_post` | `engagement` | `SUM(engagement) / COUNT(*)` per (hari, slot) = **rata-rata engagement per post** |
| **Opacity sel** | — (turunan) | — | nilai sel **dinormalisasi 0–1** terhadap sel tertinggi |
| **Top Window** (insight) | — (turunan) | — | sel dengan **rata-rata engagement per post** tertinggi → "hari + jam" |

### Pemetaan jam → slot

| Jam (WIB) | Slot |
|---|---|
| ≤ 9 | `08:00` |
| 10–12 | `12:00` |
| 13–15 | `15:00` |
| 16–18 | `18:00` |
| 19–20 | `20:00` |
| 21–23 | `22:00` |

## Contoh SQL

```sql
SELECT EXTRACT(ISODOW FROM (p.post_date AT TIME ZONE 'Asia/Jakarta'))::int AS dow,
       EXTRACT(HOUR  FROM (p.post_date AT TIME ZONE 'Asia/Jakarta'))::int AS hr,
       SUM(p.engagement) AS eng,   -- total engagement
       COUNT(*)          AS cnt    -- jumlah post  → rata-rata = eng / cnt
FROM l1_silver.unified_post p
JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
JOIN public.brands b ON b.id = bsa.brand_id
WHERE b.organization_id = $1
  AND ($2 = 'all' OR p.platform = $2)
  AND (p.post_date AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $3 AND $4
  AND p.post_date IS NOT NULL
  AND ($5::uuid IS NULL OR bsa.brand_id = $5)      -- silver: scope brand via bsa
GROUP BY 1, 2;
```

> `eng` & `cnt` diakumulasi per slot di aplikasi (beberapa jam digabung ke 1 slot), lalu nilai sel = `eng_slot / cnt_slot`. Menghitung rata-rata di SQL langsung per `(dow, hr)` salah karena rata-rata tidak bisa dijumlahkan antar-jam.

## Catatan

- Scope brand di silver lewat `brand_social_accounts` (karena `unified_post.brand_id = social_accounts.id`).
- Grid akhir 7×6 (Senin–Minggu × 6 slot); sel tanpa post = 0 (opacity minimum).
- Memakai **rata-rata per post**, jadi slot dengan 1 post berperforma tinggi bisa "menang" atas slot dengan banyak post biasa-biasa saja — sesuai tujuan "kapan waktu paling efektif untuk posting".
