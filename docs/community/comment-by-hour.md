# Community › Section: Comment Activity by Hour of Day

Bar 24 jam (WIB) jumlah komentar, window jam puncak disorot + insight. Window current. Kode: `src/lib/dashboard/community.ts` → `commentByHour()` (UI: `HourBars`).

## Tabel sumber

`l2_gold.comment_activity_hourly`, `GROUP BY hour_of_day`.

| Elemen | Kolom | Rumus |
|---|---|---|
| **Bar per jam (0–23)** | `comment_count` | `SUM(comment_count)` per `hour_of_day` |
| **Jam puncak (disorot)** | — (turunan) | window 4-jam dengan total tertinggi (sliding sum) |
| **Skala Y** | — | `top` dihitung dari nilai maks (dibulatkan), bukan hardcoded |

## Insight (teks otomatis)

- `primeFrom..primeTo` = window 4-jam terpadat → *"Komentar memuncak `HH`:00–`HH`:00 WIB (`n`% dari total). Merespons di window ini memperdalam thread balasan."*

## Contoh SQL

```sql
SELECT c.hour_of_day h, SUM(c.comment_count) c
FROM l2_gold.comment_activity_hourly c
JOIN public.brands b ON b.id = c.brand_id
WHERE b.organization_id = $1 AND ($2 = 'all' OR c.platform = $2)
  AND c.metric_date BETWEEN $3 AND $4
  AND ($5::uuid IS NULL OR c.brand_id = $5)
GROUP BY c.hour_of_day;
```

## Catatan

- Hasil dipadatkan ke array 24 elemen (jam 0–23) di aplikasi; jam tanpa data = 0.
- `hour_of_day` sudah dalam zona lokal pipeline (ditampilkan sebagai WIB).
