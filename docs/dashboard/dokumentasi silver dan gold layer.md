# Autometric — Referensi Layer & Dashboard (Detail)

Referensi lengkap struktur Silver & Gold beserta kolom penting, formula, stored procedure, dan pemetaan tiap visual dashboard. Scope platform: **Facebook, Instagram, TikTok**.

- [1. Arsitektur & Prinsip](#1-arsitektur--prinsip)
- [2. Layer Silver](#2-layer-silver-l1_silver)
- [3. Feature Layer (NLP)](#3-feature-layer-feature)
- [4. Layer Gold](#4-layer-gold-l2_gold)
- [5. Peta Dashboard → Gold (per visual)](#5-peta-dashboard--gold-per-visual)

---

## 1. Arsitektur & Prinsip

**Alur pipeline:**

```
l0_raw → l0_harmonization → l1_silver → feature (NLP) → l2_gold → (FastAPI/Redis) → dashboard
```

**Pembagian tanggung jawab:**
- **Dagster** — dependency ordering, scheduling (`daily_pipeline_job`, 02:00 WIB), freshness (25 jam), eksekusi NLP Python, invalidasi cache. Tiap asset hanya memanggil stored procedure + melaporkan row count.
- **Stored procedure** — transformasi data sesungguhnya. `sp_sync_*` mengisi Silver dari harmonization; `sp_build_*` mengisi Gold dari Silver/Feature.
- **Frontend (Model 1)** — query tabel Gold langsung via SQL.

**Prinsip inti:**

- **Hybrid ratio** — Gold menyimpan komponen additive (numerator + denominator) **dan** ratio harian jadi. Untuk rentang custom (7D/30D), hitung `SUM(numerator)/SUM(denominator)`; jangan rata-rata ratio harian (ratio tidak additive).
- **WIB** — seluruh tanggal dinormalisasi ke `Asia/Jakarta`.
- **Brand umbrella** — Silver memakai `brand_id = social_accounts.id` (per-akun). Mart Gold yang butuh level brand naik lewat `public.brand_social_accounts (social_account_id → brand_id)` dengan INNER JOIN (akun yang belum dipetakan tidak masuk — by design).
- **Idempoten** — SP memakai UPSERT (`ON CONFLICT DO UPDATE` dengan guard `IS DISTINCT FROM`) untuk time-series, atau `TRUNCATE + INSERT` untuk snapshot/leaderboard/agregat kecil. Re-run otomatis backfill.

**Timezone per tabel (penting, mudah keliru):**

| Tabel | Kolom | Timezone |
|---|---|---|
| `unified_post` | `post_date` | WIB (wall-clock) |
| `unified_comment` | `comment_time` | UTC |
| `unified_comment` | `comment_date` / `comment_hour` / `comment_weekday` | WIB (sudah +7) |

→ Untuk bucketing waktu komentar, pakai `comment_date`/`comment_hour` (WIB), bukan `comment_time`.

---

## 2. Layer Silver (`l1_silver`)

Data ternormalisasi per entitas. Dibangun asset Silver (`sp_sync_*`) dari `l0_harmonization`.

### `unified_post` — grain: 1 baris / post

Sumber metrik konten utama. `brand_id` = per-akun. `post_date` = WIB.

- **Identitas/metadata:** platform, brand_id, post_id, post_date, title, caption, link, cover_image, post_type, `duration_s`, slide_count, `content_pillar`, brand_offering, `format`, flag (is_campaign, is_boosted, is_collab, is_aon, is_activity, is_event, is_repost).
- **Metrik mentah:** views, reach, impressions, reactions, likes, comments, shares, saves, repost_count, link_click, follows, profile_visits, avg_watch_time, video_view_total_time.
- **Metrik terhitung:** engagement (owned), engagement_public, er_reach/er_views/er_impressions/er_followers, followers_on_post_day, `engagement_rate_base` (text: 'reach'/'views'), completion_rate, reels_skip_rate.

**Formula engagement per platform:**

| Kolom | FB | IG | TikTok |
|---|---|---|---|
| `likes` | = reactions | likes | likes |
| `engagement` (owned) | reactions+comments+shares | likes+comments+shares+saves+reposts | likes+comments+shares+saves |
| `engagement_public` | = owned | likes+comments | = owned |
| `engagement_rate_base` | reach | reach | views |

`followers_on_post_day` = carry-forward dari snapshot `unified_profile` terakhir dengan `profile_date ≤ post_date`.

### `unified_comment` — grain: 1 baris / komentar

platform, brand_id (per-akun), post_id, post_date, comment_id, `comment_time` (UTC), `comment_date`/`comment_hour`/`comment_weekday` (WIB), comment_text, comment_username, normalized_username, likes_count, replies_count. Linkage ke post via (`post_id`, `platform`).

### `unified_profile` — grain: 1 baris / (akun, tanggal)

Snapshot channel harian. `profile_date` = WIB. Kolom: follower_count, following_count, page_like_count, account_total_post_count, followers_growth, new_followers, lost_followers, net_growth, profile_reach, profile_visit, content_views, link_clicks, profile_link_taps, likes, comments, shares, saves, replies, repost, total_interactions, **accounts_engaged** (jumlah akun unik yang engage — IG Insights; FB/TikTok = 0).
⚠️ TikTok: follower/profile terbatas (banyak 0/NULL — batasan platform).

### `unified_audience` — grain: 1 baris / (akun, tanggal, tipe)

Demografi audience. IG-only. 2 `audience_type`: `follower_demographics` & `engaged_audience_demographics`.
- **Age (kolom flat numeric):** age_13_17, age_18_24, age_25_34, age_35_44, age_45_54, age_55_64, age_65_plus.
- **Gender (kolom flat numeric):** gender_female, gender_male, gender_unknown.
- **Geo (jsonb `{"key": count}`):** `city_breakdown` (key "Kota, Region"), `country_breakdown` (key ISO-2).

Nilai = count (bukan %). Age dan gender adalah breakdown independen (total bisa beda).

### `unified_story` — grain: 1 baris / story (IG)

reach, views, replies, taps_forward/back, exits, swipe_up, follows. IG-only.

### `unified_tagged_post` — grain: 1 baris / tagged post (IG)

Post yang men-tag brand (UGC). IG-only.

---

## 3. Feature Layer (`feature`)

Output NLP, di antara Silver & Gold.

| Tabel | Grain | Kolom | Fungsi |
|---|---|---|---|
| `comment_relevance_scores` | 1 / (comment_id, platform) | comment_id, platform, brand_id (per-akun), relevance_score (0–100), scored_at | Skor cosine similarity komentar vs caption post induk. Butuh caption post induk (join `post_id`, `platform`). |
| `word_frequencies` | brand × platform × word | brand_id, platform, word, frequency | Top-N kata per brand (stopword ID+EN dibuang). |

---

## 4. Layer Gold (`l2_gold`)

Agregat siap pakai. Tiap tabel dibangun 1 asset Dagster (`CALL sp_build_*`, kecuali `post_wordcloud` = Python).

### 4.1 `brand_metric_daily`

**Builder:** `sp_build_brand_metric_daily` · **Grain/PK:** (brand_id, account_id, platform, metric_date) · **brand_id = umbrella.**

Agregat harian channel & konten. Melayani mayoritas KPI Overview/Content/Audience.

- **Komponen additive:** post_count, engagement_sum, engagement_public_sum, reach_sum, views_sum, impressions_sum, likes_sum, comments_sum, shares_sum, saves_sum, reposts_sum, video_views_sum, new_followers_sum, lost_followers_sum, net_growth_sum.
- **Denominator ER:** reach_denom_sum, views_denom_sum, impressions_denom_sum, followers_denom_sum, er_denominator_sum.
- **Channel EOD/flow:** follower_count_eod (snapshot), profile_visit_sum, profile_reach_sum, `accounts_engaged_sum` (IG-only; KPI "IG Accounts Engaged" → FE filter `platform='instagram'`).
- **Ratio harian jadi (Hybrid):** er_reach_daily, er_views_daily, er_impressions_daily, er_followers_daily. Untuk rentang >1 hari, hitung dari komponen — jangan AVG kolom ini.

### 4.2 `post_metric`

**Builder:** `sp_build_post_metric` · **Grain/PK:** (platform, brand_id, post_id, post_date) · **brand_id = per-akun.**

Proyeksi 1:1 dari `unified_post`. Kolom: identitas, `content_pillar`, `format`, is_campaign/is_boosted, metrik mentah, engagement_owned, engagement_public, er_reach/views/impressions/followers, avg_watch_time, `duration_s`, completion_rate, reels_skip_rate. Melayani Top Posts, Post Type Performance, Reel Watch Time, TikTok scatter, Campaign Post Grid. (Untuk visual watch-time/scatter, FE filter `duration_s > 0`.)

### 4.3 `pillar_performance_daily`

**Builder:** `sp_build_pillar_performance` · **Grain:** brand(umbrella) × platform × metric_date × content_pillar.

post_count, engagement_sum, er_denominator_sum, reach_sum, views_sum, watch_time_sum. JOIN ke `dim_content_pillar` via (brand_id, content_pillar). Content Pillars → Comparison; TikTok Deep → Watch Time by Pillar.

### 4.4 `content_attribute_daily`

**Builder:** `sp_build_content_attribute_daily` · **Grain:** brand × content_tag × tanggal. post_count, er. Overview → Content Attribute Breakdown.

### 4.5 `comment_activity_daily` / `comment_activity_hourly`

**Builder:** `sp_build_comment_activity` · **Grain:** brand × hari (dan brand × jam). Jumlah komentar. Community → Comment Volume, Comment Activity by Hour.

### 4.6 `community_contributors`

**Builder:** `sp_build_community_contributors` · **Grain:** brand(umbrella) × platform × window_days × normalized_username.

comments_count, likes_received, replies_sum, avg_relevance, composite_score, tier (super_fan ≥70 / active ≥40 / casual), rank_in_window. composite = 50% volume-normalized + 50% avg_relevance. Melayani Community (leaderboard) & Audience (top contributors).

### 4.7 `comment_relevance_distribution`

**Builder:** `sp_build_comment_relevance_distribution` · **Grain/PK:** (brand_id, platform, tier) · **brand_id = umbrella.**

comment_count. Tier: High >75, Mid 40–75, Low <40 (skala relevance 0–100). Simpan count; FE hitung % = count/SUM(count). Audience → Comment Relevance distribution. (Sample komentar per tier: FE JOIN `unified_comment ↔ comment_relevance_scores`.)

### 4.8 `post_comment_timeline`

**Builder:** `sp_build_post_comment_timeline` · **Grain/PK:** (platform, post_id, bucket_date).

`bucket_date` (WIB, sumbu absolut), `days_since_post` (sumbu relatif = bucket_date − post_date), comment_count. Campaign Analysis → Comment timeline. Bucket pakai `comment_date` (WIB).

### 4.9 `post_wordcloud`

**Builder:** Python (`compute_wordcloud_per_post`, TRUNCATE+INSERT) · **Grain:** post_id × word. frequency (top-50 per post). Campaign Analysis → Word cloud.

### 4.10 `audience_demographics_daily`

**Builder:** `sp_build_audience_demographics_daily` · **Grain/PK:** (platform, brand_id, audience_date, audience_type).

age_13_17…age_65_plus, gender_female/male/unknown (count). Audience → Age Distribution, Gender Split. IG-only. FE hitung % dalam breakdown masing-masing.

### 4.11 `audience_geo_daily`

**Builder:** `sp_build_audience_geo_daily` · **Grain/PK:** (platform, brand_id, audience_date, audience_type, geo_level, geo_key).

geo_level ('city'/'country'), geo_key, audience_count. Hasil unnest jsonb. Audience → Top Audience Cities (+ Countries). IG-only.

### 4.12 `posting_time_heatmap`

**Builder:** `sp_build_posting_time_heatmap` (TRUNCATE+INSERT) · **Grain/PK:** (platform, brand_id, weekday, hour).

post_count, engagement_sum, reach_sum, views_sum, er_denominator_sum. weekday 0=Minggu..6=Sabtu (WIB). Overview → Best Posting Times. FE warnai pakai avg engagement atau ER dari komponen.

### 4.13 `dim_content_pillar`

**Builder:** `sp_build_dim_content_pillar` (seed dari `pillar_performance_daily`, `ON CONFLICT DO NOTHING`) · **Grain/PK:** (brand_id, content_pillar) · **brand_id = umbrella.**

color, display_order, description, is_active, created_at, updated_at. Dimensi konfig pillar. **Read-write untuk app** (FE CRUD warna via UI). Seed hanya menambah nama pillar baru, tidak menimpa edit user. Content Pillars → Define Pillars.

### 4.14 Story & TikTok

| Tabel | Builder | Grain | Fungsi |
|---|---|---|---|
| `story_metric_daily` | `sp_build_story_funnel` | brand × hari | Story KPI, Retention Funnel, Over Time. IG-only. |
| `story_type_daily` | `sp_build_story_funnel` | brand × story_type | Story Type Performance. |
| `tiktok_churn_daily` | `sp_build_tiktok_churn` | brand × hari | new/lost/net followers. TikTok-only. |

### 4.15 Lain

| Tabel | Builder | Grain | Fungsi |
|---|---|---|---|
| `ugc_tagged_posts` | `sp_build_ugc_tagged_posts` | 1 / tagged post | Tagged Posts (UGC). IG-only. |
| `v_campaign_posts` | VIEW | on-demand | Campaign Analysis. |

---

## 5. Peta Dashboard → Gold (per visual)

### Overview

| Visual | Sumber Gold | Catatan |
|---|---|---|
| Brand Header (Total followers) | `brand_metric_daily.follower_count_eod` | snapshot terbaru |
| 5 KPI Cards | `brand_metric_daily` | sum komponen per window; ER dari komponen |
| Engagement Over Time | `brand_metric_daily` | GROUP BY week |
| Platform Share (donut) | `brand_metric_daily.reach_sum` | GROUP BY platform |
| Brand Performance Matrix | `brand_metric_daily` | 1 baris / brand×platform |
| Content Attribute Breakdown | `content_attribute_daily` | grain brand × content_tag |
| Best Posting Times (heatmap) | `posting_time_heatmap` | weekday × hour, WIB |

### Content Overview

| Visual | Sumber Gold | Catatan |
|---|---|---|
| 4 KPI (Posts/Saves Rate/Completion/Link Clicks) | `brand_metric_daily` + `post_metric` | platform-specific |
| Post Type Performance | `post_metric` | GROUP BY format |
| Content Volume by Week | `brand_metric_daily.post_count` | GROUP BY week |
| Top Posts | `post_metric` | ranking by ER |
| TikTok Completion Distribution | `post_metric.completion_rate` | FE bucket |
| Reel Watch Time by Duration | `post_metric` (avg_watch_time + duration_s) | FE filter duration_s>0 |

### Audience Deep Dive

| Visual | Sumber Gold | Catatan |
|---|---|---|
| 4 KPI (Followers/IG Accounts Engaged/TK Profile Views/FB Visits) | `brand_metric_daily` (incl. `accounts_engaged_sum`) | IG Engaged filter platform=IG |
| Age Distribution | `audience_demographics_daily` | share dari komponen count |
| Gender Split by Platform | `audience_demographics_daily` | IG-only |
| Comment Relevance (distribusi) | `comment_relevance_distribution` | count per tier; FE hitung % |
| Comment Relevance (sample) | FE JOIN `unified_comment ↔ comment_relevance_scores` | per tier |
| Top Community Contributors | `community_contributors` | composite_score + tier |
| Top Audience Cities | `audience_geo_daily` | geo_level='city' |
| Follower Growth Trend | `brand_metric_daily.net_growth_sum` | GROUP BY week |
| UGC Tagged Posts | `ugc_tagged_posts` | — |

### Stories

| Visual | Sumber Gold |
|---|---|
| 4 KPI | `story_metric_daily` |
| Story Retention Funnel | `story_metric_daily` |
| Story Type Performance | `story_type_daily` |
| Story Performance Over Time | `story_metric_daily` |

### TikTok Deep

| Visual | Sumber Gold | Catatan |
|---|---|---|
| 5 KPI | `tiktok_churn_daily` + `brand_metric_daily` | — |
| Follower Churn (diverging bar) | `tiktok_churn_daily` | new/lost/net |
| Duration vs Completion (scatter) | `post_metric` (duration_s + completion_rate) | FE filter duration_s>0 |
| Avg Watch Time by Pillar | `pillar_performance_daily.watch_time_sum` | grain brand × pillar |

### Community

| Visual | Sumber Gold |
|---|---|
| 4 KPI | `comment_activity_daily` |
| Comment Volume by Platform | `comment_activity_daily` |
| Comment Activity by Hour | `comment_activity_hourly` |
| Top Commenters Leaderboard | `community_contributors` |

### Campaign Analysis

| Visual | Sumber Gold | Catatan |
|---|---|---|
| Post Selection Grid | `post_metric` (+ content_pillar) | filter by pillar/platform |
| Per-post contribution | `post_metric` | on-the-fly dari post terpilih |
| Comment timeline distribution | `post_comment_timeline` | sumbu absolut/relatif |
| Cleaned word cloud | `post_wordcloud` | post × word × frequency |

### Content Pillars

| Visual | Sumber Gold | Catatan |
|---|---|---|
| Define Pillars (form) | `dim_content_pillar` | user CRUD nama + warna |
| Comparison Output | `pillar_performance_daily` + `dim_content_pillar` | JOIN via (brand_id, content_pillar) |
