# Stories › Section: Story Retention Funnel

Bar horizontal 6 langkah navigasi story + insight. Window current. Kode: `src/lib/dashboard/stories.ts` → `funnel()`.

## Tabel sumber per langkah

Semua dari **`l2_gold.story_metric_daily`** (SUM pada window):

| Langkah | Kolom | Warna |
|---|---|---|
| **Views** | `views_sum` | `#6c4cd6` |
| **Taps Back** | `taps_back_sum` | `#3d7e96` |
| **Taps Fwd** | `taps_fwd_sum` | `#3d7eea` |
| **Exits** | `exits_sum` | `#d6556f` |
| **Replies** | `replies_sum` | `#d23f6f` |
| **Swipe-Up** | `swipe_up_sum` | `#5fa783` |

## Insight (teks otomatis)

- `fwdRate = taps_fwd_sum / views_sum × 100`.
- `≥ 40%` → *"`n`% tap-forward — story banyak dilewati; perkuat hook di frame pertama atau pendekkan sekuens."*; selain itu *"retensi sekuens sehat."*
- Tanpa data → *"Belum ada data story pada periode ini."*

## Contoh SQL

```sql
SELECT COALESCE(SUM(s.views_sum),0)     AS views,
       COALESCE(SUM(s.taps_back_sum),0) AS taps_back,
       COALESCE(SUM(s.taps_fwd_sum),0)  AS taps_fwd,
       COALESCE(SUM(s.exits_sum),0)     AS exits,
       COALESCE(SUM(s.replies_sum),0)   AS replies,
       COALESCE(SUM(s.swipe_up_sum),0)  AS swipe
FROM l2_gold.story_metric_daily s
JOIN public.brands b ON b.id = s.brand_id
WHERE b.organization_id = $1 AND ($2 = 'all' OR s.platform = $2)
  AND s.metric_date BETWEEN $3 AND $4 AND ($5::uuid IS NULL OR s.brand_id = $5);
```

## Catatan

- Bar dinormalisasi `HBars` terhadap nilai terbesar (Views), jadi langkah lain proporsional terhadapnya.
- Urutan langkah tetap (Views → … → Swipe-Up), bukan diurut nilai.
