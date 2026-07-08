# Stories › Section: Story Type Performance

Combo chart (bar = avg reach, garis = avg replies) per **story_type** + insight. Window current. Kode: `src/lib/dashboard/stories.ts` → `typePerf()`.

## Tabel sumber per elemen

Dari **`l2_gold.story_type_daily`**, `GROUP BY story_type`:

| Elemen UI | Kolom | Rumus |
|---|---|---|
| **Bar (Avg Reach)** | `reach_sum`, `story_count` | `SUM(reach_sum) / SUM(story_count)` |
| **Garis (Avg Replies)** | `replies_sum`, `story_count` | `SUM(replies_sum) / SUM(story_count)` |
| **Sumbu Y kiri/kanan** | — (turunan) | `niceMax(maks data)` dihitung di komponen, beri headroom ~15% |

## Mapping `story_type` → label

| `story_type` (DB) | Label UI |
|---|---|
| `IMAGE` | Static Image |
| `VIDEO` | Video |

## Insight (teks otomatis)

- Ambil tipe dengan **rasio reply-per-reach** tertinggi (`replies_sum / reach_sum`).
- Teks: *"`<tipe>` menghasilkan rasio reply-per-reach tertinggi — format story dengan interaksi paling kuat."*

## Contoh SQL

```sql
SELECT s.story_type,
       SUM(s.reach_sum)   AS reach,
       SUM(s.replies_sum) AS replies,
       SUM(s.story_count) AS cnt
FROM l2_gold.story_type_daily s
JOIN public.brands b ON b.id = s.brand_id
WHERE b.organization_id = $1 AND ($2 = 'all' OR s.platform = $2)
  AND s.metric_date BETWEEN $3 AND $4 AND ($5::uuid IS NULL OR s.brand_id = $5)
GROUP BY s.story_type ORDER BY reach DESC;
```

## Catatan

- Di seed hanya ada `IMAGE` & `VIDEO`. Tipe interaktif (Poll/Quiz/Countdown) belum ada di data → tidak muncul (bukan di-hardcode).
- `story_type_daily` hanya menyimpan `reach_sum` & `replies_sum` (tidak ada views/swipe per tipe), jadi metrik tipe terbatas pada dua itu.
