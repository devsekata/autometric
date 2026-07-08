# Content Overview › Section: Performance (KPI Cards)

4 kartu KPI di baris paling atas Content Overview. Campuran **gold** (posts + saves IG) dan **silver** (completion TK + link clicks FB), diagregasi pada **window current** (lihat scoping di [README](./README.md)).

Kode: `src/lib/dashboard/content.ts` → `goldKpiTotals()`, `goldKpiDaily()`, `silverKpiTotals()`, `silverKpiDaily()`, `buildKpis()`.

## Tabel sumber per metric

| KPI (label UI) | Tabel | Kolom | Rumus nilai |
|---|---|---|---|
| **Total Posts (Period)** | `l2_gold.brand_metric_daily` | `post_count` | `SUM(post_count)` |
| **Avg. Saves Rate (IG)** | `l2_gold.brand_metric_daily` | `saves_sum`, `er_denominator_sum`, `platform` | `SUM(saves_sum FILTER ig) / SUM(er_denominator_sum FILTER ig) × 100` |
| **Avg. Completion Rate (TK)** | `l1_silver.unified_post` | `completion_rate` (text), `platform` | `AVG(parse(completion_rate)) FILTER (tiktok)` |
| **Link Clicks (FB)** | `l1_silver.unified_post` | `link_click`, `platform` | `SUM(link_click) FILTER (facebook)` |

> `completion_rate` diparse dari teks `'79%'` → numeric `0..100`:
> `NULLIF(regexp_replace(completion_rate, '[^0-9.]', '', 'g'), '')::numeric`.

## Delta (badge naik/turun tiap kartu)

Dihitung dengan menjalankan rumus yang sama di **window previous**, lalu dibandingkan.

| KPI | Rumus delta |
|---|---|
| Total Posts, Link Clicks (FB) | `(current − previous) / previous × 100` (persen) |
| Saves Rate (IG), Completion Rate (TK) | selisih poin: `nilai_current − nilai_previous` (`pts`) |

## Spark (mini-tren di kartu)

Deret **harian** pada window current.

| KPI | Isi spark per hari | Grain |
|---|---|---|
| Total Posts | `SUM(post_count)` per `metric_date` | gold, `GROUP BY metric_date` |
| Saves Rate (IG) | `SUM(saves_sum)/SUM(er_denominator_sum)×100` (IG) per hari | gold |
| Completion Rate (TK) | `AVG(parse(completion_rate))` (TK) per `post_date::date` | silver |
| Link Clicks (FB) | `SUM(link_click)` (FB) per `post_date::date` | silver |

## Catatan platform

- KPI bersifat **spesifik-platform** lewat `FILTER (WHERE platform = …)`. Saat platform toggle = `All`, keempat kartu terisi. Saat dipilih satu platform tertentu, kartu platform-lain ikut ter-nol (perilaku konsisten dengan kartu "TK Video Views" di Overview).
- `saves_sum` di gold cocok dengan `SUM(saves)` silver (IG & TK punya saves; FB = 0).
- `link_click` **tidak** ada di gold (tak ada `link_click_sum`) → diambil per-post dari silver. FB satu-satunya platform dengan `link_click > 0`.

## Contoh SQL (Total Posts + Saves IG, gold)

```sql
SELECT
  COALESCE(SUM(bmd.post_count), 0)                                              AS posts,
  COALESCE(SUM(bmd.saves_sum)          FILTER (WHERE bmd.platform='instagram'), 0) AS ig_saves,
  COALESCE(SUM(bmd.er_denominator_sum) FILTER (WHERE bmd.platform='instagram'), 0) AS ig_erden
FROM l2_gold.brand_metric_daily bmd
JOIN public.brands b ON b.id = bmd.brand_id
WHERE b.organization_id = $1
  AND ($2 = 'all' OR bmd.platform = $2)
  AND bmd.metric_date BETWEEN $3 AND $4
  AND ($5::uuid IS NULL OR bmd.brand_id = $5);
```

## Contoh SQL (Completion TK + Link Clicks FB, silver)

```sql
SELECT
  AVG(NULLIF(regexp_replace(p.completion_rate, '[^0-9.]', '', 'g'), '')::numeric)
      FILTER (WHERE p.platform='tiktok')                       AS tk_completion,
  COALESCE(SUM(p.link_click) FILTER (WHERE p.platform='facebook'), 0) AS fb_clicks
FROM l1_silver.unified_post p
JOIN public.brand_social_accounts bsa ON bsa.social_account_id = p.brand_id
JOIN public.brands b ON b.id = bsa.brand_id
WHERE b.organization_id = $1
  AND ($2 = 'all' OR p.platform = $2)
  AND p.post_date::date BETWEEN $3 AND $4
  AND ($5::uuid IS NULL OR bsa.brand_id = $5);
```

## Catatan

- Jika org/brand tidak punya baris gold pada window → seluruh payload `empty: true`, UI tampil state kosong.
- Asal data: pipeline `L0 (seed) → CALL l1_silver.sp_sync_unified_*() → CALL l2_gold.sp_build_brand_metric_daily()`.
