# Selected KOL Audit Report -- 24 Requested Accounts

**Audit date:** 2026-09-04  
**Scope:** read-only. No code and no database record was modified.  
**Accounts audited:** exactly the 24 handles supplied. No substitutions were made.

---

## Phase 1 -- Where the data lives

### Databases

The project holds two Postgres connections, declared in `.env.local` and wrapped by two separate pools:

| Pool | Module | Host | Database | Holds the 24 accounts? |
| --- | --- | --- | --- | --- |
| Analytics warehouse | `src/lib/db.ts` | `roznf0z9he.*.tsdb.cloud.timescale.com` | `tsdb` | **No** |
| Commercial KOL platform | `src/lib/kolDb.ts` | `10.100.14.216` (private network) | `kol` | **Yes -- all of them** |

Both were reachable during the audit. Every one of the 24 handles was searched in the warehouse first -- `public.discover_creators`, `public.social_accounts` and `public.discover_creator_snapshots` -- and **all 24 returned zero rows there**. The warehouse's `l1_silver.unified_profile` carries no `username` column, so it cannot be searched by handle at all. Every finding below therefore comes from the `kol` database.

### Tables read

| Table | Grain | Role in this audit |
| --- | --- | --- |
| `public.kol_directory` | one row per handle **per platform** | roster identity, followers, ER, category, avatar, bio, scrape status |
| `public.kol_social_account` | link table | maps a roster row to its `social_account_id` |
| `public.social_account` | one row per account | account identity, `data_source`, connection state |
| `public.platforms`, `public.kol_categories`, `public.kol_tiers` | lookups | platform key, category name, tier band |
| `l0_harmonization.instagram_profile` / `tiktok_profile` | per account per scrape date | raw harmonised profile snapshots |
| `l0_harmonization.sync_log` | per pipeline run | synchronisation history |
| `l1_silver.unified_profile` | per account per date | conformed profile snapshot |
| `l1_silver.unified_post` | per post | post records |
| `l1_silver.unified_rate_card`, `unified_audience`, `unified_comment` | per account | **all three are empty table-wide (0 rows)** |
| `l2_gold.kol_profile_card` | one per account | the pipeline's own profile card |
| `l2_gold.post_metric` | per post | per-post likes / comments / views / ER |
| `l2_gold.kol_metric_daily` / `_monthly` | per account per day / month | rolled-up performance |
| `l2_gold.audience_demographics_daily` | per account per date per dimension | **gender only** |
| `l2_gold.audience_geo_daily`, `audience_interest_daily` | per account per key | country / city, interests |
| `l2_gold.content_format_daily` | per account per day per format | format breakdown |
| `public.add_kol_scrape_log`, `add_kol_pipeline_log` | per Add-KOL run | ingestion logs (0 rows for all 24) |

### Matching method

Exact, case-insensitive match on `kol_directory.username` **and** `kol_directory.username_normalized`, with any leading `@` stripped. Fuzzy matching was used only for the two handles that returned nothing on an exact match, and only to identify what they might have been -- they are still reported as NOT FOUND, because the requested string genuinely does not exist in the database.

### Account availability report

| No | Requested Username | Found Username | Platform(s) in DB | Status |
| --- | --- | --- | --- | --- |
| 1 | @instagram | instagram | instagram + tiktok | Found |
| 2 | @cristiano | cristiano | instagram | Found |
| 3 | @leomessi | leomessi | instagram | Found |
| 4 | @raffinagita1717 | raffinagita1717 | instagram | Found |
| 5 | @lunamaya | lunamaya | instagram | Found |
| 6 | @ibnuwardani | ibnuwardani | tiktok | 🟠 Found -- **TikTok only, no Instagram row** |
| 7 | @iben_ma | iben_ma | instagram + tiktok | Found |
| 8 | @inul.d | inul.d | instagram + tiktok | Found |
| 9 | @bbrightvc | bbrightvc | instagram | Found |
| 10 | @pevpearce | pevpearce | instagram | Found |
| 11 | @irwansyah_15 | irwansyah_15 | instagram | Found |
| 12 | @fadiljaidi | fadiljaidi | instagram | Found |
| 13 | @saalhaerid | saalhaerid | instagram + tiktok | Found |
| 14 | @jharnabhagwani | jharnabhagwani | tiktok | 🟠 Found -- **TikTok only, no Instagram row** |
| 15 | @sptrakori_ | sptrakori_ | tiktok | 🟠 Found -- **TikTok only, no Instagram row** |
| 16 | @lalitahutami | lalitahutami | tiktok | 🟠 Found -- **TikTok only, no Instagram row** |
| 17 | @isyanasarasvati | isyanasarasvati | instagram | Found |
| 18 | @lambe_turah | lambe_turah | instagram | Found |
| 19 | @ditanganu | ditanganu | tiktok | 🟠 Found -- **TikTok only, no Instagram row** |
| 20 | @hesfinatia | hesfinatia | tiktok | 🟠 Found -- **TikTok only, no Instagram row** |
| 21 | @erickapinedao9 | NOT FOUND | -- | 🔴 **NOT FOUND IN DATABASE** (near-match `erickapineda09` exists -- a different handle, not audited as a substitute) |
| 22 | @anyageraldine | anyageraldine | instagram | Found |
| 23 | @shabiraaluaadnan | NOT FOUND | -- | 🔴 **NOT FOUND IN DATABASE** (near-match `shabiraalulaadnan` exists -- a different handle, not audited as a substitute) |
| 24 | @pojoksatu.id | pojoksatu.id | tiktok | 🟠 Found -- **TikTok only, no Instagram row** |

**22 of 24 found. 2 not found.** Of the 22 found, **15 carry an Instagram row** and **7 exist only as TikTok** (`@ibnuwardani`, `@jharnabhagwani`, `@sptrakori_`, `@lalitahutami`, `@ditanganu`, `@hesfinatia`, `@pojoksatu.id`). Four handles -- `@instagram`, `@iben_ma`, `@inul.d`, `@saalhaerid` -- hold **two** roster rows, one Instagram and one TikTok. That is the table's design (`kol_directory` is keyed per handle *per platform*), not duplication.

### The two handles that were not found

| Requested | Exists in DB? | Closest handle present | Difference |
| --- | --- | --- | --- |
| `@erickapinedao9` | No | `erickapineda09` (TikTok) | the requested string transposes the final two characters: `...pinedao9` vs `...pineda09` |
| `@shabiraaluaadnan` | No | `shabiraalulaadnan` (TikTok) | the requested string is missing one `l`: `alua` vs `alula` |

Per the audit rules these are reported as **NOT FOUND IN DATABASE** and no substitute was audited. The near-matches are described in an annex at the end so the discrepancy can be settled, but they are excluded from every count and every score in this report.

---

## Phase 2-4 -- Account-by-account records

### Reading these records

* `NULL` -- the column exists and is null in the database.
* `0` -- a real, measured zero.
* `NOT FOUND` -- no row exists for this account.
* `UNAVAILABLE` -- the table exists but holds no row for this account.
* `INSUFFICIENT DATA` -- some rows exist, but not enough to state the figure honestly.

**Engagement-rate units.** `kol_directory.engagement_rate` is a percentage (`2.21` means 2.21%). `l2_gold.post_metric.er_followers` is a fraction (`0.018060` means 1.81%). Both are reported below in raw form and labelled, and neither was rescaled.

**No metric was computed that the database does not already carry.** The averages shown are plain arithmetic means over the rows in `l2_gold.post_metric`. Where the sample is polluted (see the `likes = -1` issue) both the stored figure and a sentinel-excluded figure are given, and the second is explicitly marked as a correction.

**Freshness classification.** Measured against the audit date 2026-09-04, using the newest of `l2_gold.kol_profile_card.profile_snapshot_date` and `l1_silver.unified_profile.date`. The 7-day boundary is not invented here -- it is the repository's own threshold for calling a roster row "Live" (`src/lib/discover/kolDirectory.ts:186`: `WHEN kd.last_refreshed_at >= now() - interval '7 days' THEN 'Live'`). The upper band follows the roster's monthly refresh cadence.

| Band | Rule |
| --- | --- |
| Fresh | data as of 7 days ago or less |
| Aging | 8-30 days |
| Stale | more than 30 days |
| Unknown | no timestamp on any layer |

**Completeness score.** 100 points across six blocks, awarded only for fields that actually hold a value: profile identity 20 (username 3, display name 3, avatar 3, profile URL 3, bio 4, category 4); account metrics 20 (followers 8, following 6, total posts 6); engagement 25 (avg likes 6, avg comments 6, avg views 5, ER 8); content 15 (post records 6, content newer than 30 days 5, content types 4); audience 12 (gender 6, age 3, geo 2, interests 1); freshness 8 (snapshot date 4, directory refreshed within 30 days 2, sync-log entries 2).

---

## 1. @instagram

### Account Status

**Found** -- `public.kol_directory` row `d0d4c520-8644-4cda-a9a7-8dae25e936f8` (platform `instagram`), linked to `social_account` `26b47c8f-cb11-4929-9372-2aaea28704f8`.

This handle also holds a second roster row on another platform: `66955777-84f8-4146-9d69-a5d2a4f14031` (tiktok). The record below audits the **instagram** row, which is the platform requested; the other platform's figures are summarised at the end of this record.

### Profile Information

| Field | Value |
| --- | --- |
| Username | instagram |
| Display Name | Instagram |
| Platform | instagram |
| Category | Lifestyle |
| Profile URL | https://www.instagram.com/instagram |
| Avatar | present |
| Bio | `Discover what's new on Instagram 🔎✨` |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | verified |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | NULL |
| Source | excel_import |
| Platform User ID | 25025320 |
| Roster row created | 2025-09-25 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 685,896,635 | `kol_directory.followers_count` |
| Followers (measured) | 685,896,635 | `l1_silver.unified_profile.followers_count` |
| Following | 274 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 8,556 | `l1_silver.unified_profile.media_count` |
| Average Likes | NULL | `l2_gold.post_metric.likes` |
| Average Comments | NULL | `l2_gold.post_metric.comments` |
| Average Views | UNAVAILABLE | `l2_gold.post_metric.views` NULL on all sampled posts |
| Average Shares | NULL | `l2_gold.post_metric.shares` |
| Average Saves | NULL | `l2_gold.post_metric.saves` |
| Total Likes (sample) | NULL | sum over `post_metric` |
| Total Comments (sample) | NULL | sum over `post_metric` |
| Total Views (sample) | NULL | sum over `post_metric` |
| Total Interactions (sample) | NULL | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | 0.07% | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | UNAVAILABLE / INSUFFICIENT DATA -- `er_followers` NULL on all 0 sampled posts | `l2_gold.post_metric.er_followers` |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | NULL | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 0 |
| Posts Analyzed (`l2_gold.post_metric`) | 0 |
| Latest Content | UNAVAILABLE |
| Oldest Content | UNAVAILABLE |
| Content Types | NULL |
| Daily rollup rows (`kol_metric_daily`) | 0 (latest --) |
| Monthly rollup rows | 0 |
| Format breakdown rows | 0 |
| Content Analytics Status | **No content history.** Zero post records, so no content analytics of any kind are possible. |
| Recent content exists | No |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | **No -- NO AUDIENCE DATA** |
| Female | NO DATA |
| Male | NO DATA |
| Unknown | NO DATA |
| Main Age Group | NO DATA |
| Countries | NO DATA |
| Cities | NO DATA |
| Languages | NO DATA |
| Interests | NO DATA |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-14 (21 days ago) |
| Profile date (silver) | 2026-08-14 |
| Directory `last_refreshed_at` | 2026-08-14 (21 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | UNAVAILABLE |
| Analytics last updated | UNAVAILABLE |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-14, 21 days before the audit date |

### Issues Found

* 🔴 No post records at all (`l1_silver.unified_post` = 0 rows), so every engagement figure is UNAVAILABLE.
* 🟠 `kol_directory.scrape_status` is NULL and no posts were harvested. The Discover directory renders this as provenance **Estimated** (`src/lib/discover/kolDirectory.ts:186`) even though a real profile snapshot exists in `l2_gold.kol_profile_card`.
* 🟠 Verification conflict: `kol_directory.verified_status = 'verified'` but `l1_silver.unified_profile.is_verified = false`. `is_verified` is false for every account in this audit -- including @instagram and @cristiano -- so the medallion flag is not being populated at all.
* 🟠 No audience demographics of any kind -- `l2_gold.audience_demographics_daily` holds 0 rows for this account.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**54 / 100**

Missing: avg likes (-6); avg comments (-6); avg views (-5); post records (-6); recent content (<=30d) (-5); content types (-4); gender split (-6); age groups (-3); geo (-2); interests (-1); sync log entries (-2).

#### Companion tiktok row for the same handle

| Field | Value |
| --- | --- |
| Roster followers | 531,100 |
| Measured followers | 958,400 |
| Display name | instagram |
| Post records | 0 |
| Avg likes / comments / views | NULL / NULL / NULL |
| Gender split F / M / Unknown | NO DATA |
| Directory `last_refreshed_at` | 2025-09-25 |

---

## 2. @cristiano

### Account Status

**Found** -- `public.kol_directory` row `7dd5bd80-1329-48b7-9330-df04cf57036a` (platform `instagram`), linked to `social_account` `8394aacf-5524-42d8-a1fa-7a7454fea2d2`.

### Profile Information

| Field | Value |
| --- | --- |
| Username | cristiano |
| Display Name | Cristiano Ronaldo |
| Platform | instagram |
| Category | Fitness |
| Profile URL | https://www.instagram.com/cristiano |
| Avatar | present |
| Bio | NULL |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | verified |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | 173560420 |
| Roster row created | 2023-03-07 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 679,264,838 | `kol_directory.followers_count` |
| Followers (measured) | 679,697,682 | `l1_silver.unified_profile.followers_count` |
| Following | 634 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 4,122 | `l1_silver.unified_profile.media_count` |
| Average Likes | 13,766,592 | `l2_gold.post_metric.likes` |
| Average Comments | 225,625 | `l2_gold.post_metric.comments` |
| Average Views | 78,091,457 (over 2 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | NULL | `l2_gold.post_metric.shares` |
| Average Saves | NULL | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 137,665,920 | sum over `post_metric` |
| Total Comments (sample) | 2,256,253 | sum over `post_metric` |
| Total Views (sample) | 156,182,914 | sum over `post_metric` |
| Total Interactions (sample) | 139,922,173 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | 2.21% | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | 0.01806 (= 1.8060%), over 1 of 10 posts | `l2_gold.post_metric.er_followers`, a fraction |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | 0.0637 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-16 |
| Oldest Content | 2026-07-20 |
| Content Types | carousel_container, clips, feed |
| Daily rollup rows (`kol_metric_daily`) | 10 (latest 2026-08-16) |
| Monthly rollup rows | 2 |
| Format breakdown rows | 10 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 4,122). |
| Recent content exists | Yes -- newest post is 19 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 4 of 100 sampled (4%) |
| Male | 18 of 100 sampled (18%) |
| Unknown | 78 of 100 sampled (78%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 7 geo rows; top resolved: FR=1; TN=1; BR=1 |
| Audience cities | included in the 7 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 9 rows; top: unknown=85; religion=5; sports=5 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2026-08-14 (21 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-16 |
| Analytics last updated | 2026-08-16 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🟠 Verification conflict: `kol_directory.verified_status = 'verified'` but `l1_silver.unified_profile.is_verified = false`. `is_verified` is false for every account in this audit -- including @instagram and @cristiano -- so the medallion flag is not being populated at all.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (78 of 100 sampled units). Only 22% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟡 Views are present on only 2 of 10 sampled posts, so the average-views figure is a mean over a partial sub-sample rather than over the post set.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**91 / 100**

Missing: bio (-4); age groups (-3); sync log entries (-2).

---

## 3. @leomessi

### Account Status

**Found** -- `public.kol_directory` row `2fd2276d-25d9-446a-8a48-07636c358926` (platform `instagram`), linked to `social_account` `abd72737-8399-4507-a333-c5ed876331c2`.

### Profile Information

| Field | Value |
| --- | --- |
| Username | leomessi |
| Display Name | Leo Messi |
| Platform | instagram |
| Category | Animal Lovers |
| Profile URL | https://www.instagram.com/leomessi |
| Avatar | present |
| Bio | `Bienvenidos a la cuenta oficial de Instagram de Leo Messi / Welcome to the official Leo Me...` |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | verified |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | 427553890 |
| Roster row created | 2023-06-26 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 516,185,245 | `kol_directory.followers_count` |
| Followers (measured) | 516,283,723 | `l1_silver.unified_profile.followers_count` |
| Following | 369 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 1,534 | `l1_silver.unified_profile.media_count` |
| Average Likes | 14,487,096 | `l2_gold.post_metric.likes` |
| Average Comments | 511,404 | `l2_gold.post_metric.comments` |
| Average Views | 43,222,221 (over 2 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | NULL | `l2_gold.post_metric.shares` |
| Average Saves | NULL | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 144,870,960 | sum over `post_metric` |
| Total Comments (sample) | 5,114,038 | sum over `post_metric` |
| Total Views (sample) | 86,444,442 | sum over `post_metric` |
| Total Interactions (sample) | 149,984,998 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | 2.66% | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | UNAVAILABLE / INSUFFICIENT DATA -- `er_followers` NULL on all 10 sampled posts | `l2_gold.post_metric.er_followers` |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | 0.0191 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-12 |
| Oldest Content | 2025-11-10 |
| Content Types | carousel_container, clips, feed |
| Daily rollup rows (`kol_metric_daily`) | 10 (latest 2026-08-12) |
| Monthly rollup rows | 5 |
| Format breakdown rows | 10 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 1,534). |
| Recent content exists | Yes -- newest post is 23 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 5 of 100 sampled (5%) |
| Male | 20 of 100 sampled (20%) |
| Unknown | 75 of 100 sampled (75%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 4 geo rows; top resolved: TH=1; BR=1; EH=1 |
| Audience cities | included in the 4 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 11 rows; top: unknown=85; religion=4; sports=3 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2026-08-14 (21 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-12 |
| Analytics last updated | 2026-08-12 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🟠 Verification conflict: `kol_directory.verified_status = 'verified'` but `l1_silver.unified_profile.is_verified = false`. `is_verified` is false for every account in this audit -- including @instagram and @cristiano -- so the medallion flag is not being populated at all.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (75 of 100 sampled units). Only 25% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟡 Views are present on only 2 of 10 sampled posts, so the average-views figure is a mean over a partial sub-sample rather than over the post set.
* 🟠 `er_followers` is NULL on all 10 sampled posts -- no per-post engagement rate can be derived because no follower snapshot lines up with the post dates.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**95 / 100**

Missing: age groups (-3); sync log entries (-2).

---

## 4. @raffinagita1717

### Account Status

**Found** -- `public.kol_directory` row `606c41ef-8944-4c37-8615-49db65400931` (platform `instagram`), linked to `social_account` `d3a87642-e5c3-4e41-a359-b0d708b8a058`.

### Profile Information

| Field | Value |
| --- | --- |
| Username | raffinagita1717 |
| Display Name | Raffi Ahmad and Nagita Slavina |
| Platform | instagram |
| Category | NULL |
| Profile URL | https://www.instagram.com/raffinagita1717 |
| Avatar | present |
| Bio | `Single terbaru "Bersyukurlah"  ⬇️⬇️` |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | verified |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | 1918078581 |
| Roster row created | 2023-11-08 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 75,052,814 | `kol_directory.followers_count` |
| Followers (measured) | 75,033,211 | `l1_silver.unified_profile.followers_count` |
| Following | 7,625 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 30,422 | `l1_silver.unified_profile.media_count` |
| Average Likes | 465,860 | `l2_gold.post_metric.likes` |
| Average Comments | 8,730 | `l2_gold.post_metric.comments` |
| Average Views | 474,870 (over 3 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | NULL | `l2_gold.post_metric.shares` |
| Average Saves | NULL | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 4,658,603 | sum over `post_metric` |
| Total Comments (sample) | 87,297 | sum over `post_metric` |
| Total Views (sample) | 1,424,611 | sum over `post_metric` |
| Total Interactions (sample) | 4,745,900 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | 0.52% | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | 0.000109 (= 0.0109%), over 2 of 10 posts | `l2_gold.post_metric.er_followers`, a fraction |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | -0.0261 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-20 |
| Oldest Content | 2024-10-22 |
| Content Types | carousel_container, clips, feed |
| Daily rollup rows (`kol_metric_daily`) | 4 (latest 2026-08-20) |
| Monthly rollup rows | 3 |
| Format breakdown rows | 6 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 30,422). |
| Recent content exists | Yes -- newest post is 15 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 15 of 100 sampled (15%) |
| Male | 15 of 100 sampled (15%) |
| Unknown | 70 of 100 sampled (70%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 4 geo rows; top resolved: ID=3; BR=1; LA=1 |
| Audience cities | included in the 4 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 8 rows; top: unknown=94; business=2; education=2 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2026-08-14 (21 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-20 |
| Analytics last updated | 2026-08-20 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🟠 Verification conflict: `kol_directory.verified_status = 'verified'` but `l1_silver.unified_profile.is_verified = false`. `is_verified` is false for every account in this audit -- including @instagram and @cristiano -- so the medallion flag is not being populated at all.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (70 of 100 sampled units). Only 30% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟡 Views are present on only 3 of 10 sampled posts, so the average-views figure is a mean over a partial sub-sample rather than over the post set.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**91 / 100**

Missing: category (-4); age groups (-3); sync log entries (-2).

---

## 5. @lunamaya

### Account Status

**Found** -- `public.kol_directory` row `3491cdd5-0db0-4c33-a75e-a88ff2064a08` (platform `instagram`), linked to `social_account` `8cc9c6d6-d7f9-4824-9be3-9868e9fef93f`.

### Profile Information

| Field | Value |
| --- | --- |
| Username | lunamaya |
| Display Name | Luna Maya |
| Platform | instagram |
| Category | Beauty |
| Profile URL | https://www.instagram.com/lunamaya |
| Avatar | present |
| Bio | `@namabeauty.co @tsmediaid @roleentertainment @yayasan_lunamayanawasena  lunamaya@role-ente...` |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | verified |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | 1948416 |
| Roster row created | 2025-06-26 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 37,961,844 | `kol_directory.followers_count` |
| Followers (measured) | 37,950,413 | `l1_silver.unified_profile.followers_count` |
| Following | 2,668 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 6,102 | `l1_silver.unified_profile.media_count` |
| Average Likes | 20,779 | `l2_gold.post_metric.likes` |
| Average Comments | 408 | `l2_gold.post_metric.comments` |
| Average Views | 317,720 (over 4 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | NULL | `l2_gold.post_metric.shares` |
| Average Saves | NULL | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 207,793 | sum over `post_metric` |
| Total Comments (sample) | 4,084 | sum over `post_metric` |
| Total Views (sample) | 1,270,881 | sum over `post_metric` |
| Total Interactions (sample) | 211,877 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | 0.03% | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | 0.00076 (= 0.0760%), over 6 of 10 posts | `l2_gold.post_metric.er_followers`, a fraction |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | -0.0301 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-20 |
| Oldest Content | 2026-06-05 |
| Content Types | carousel_container, clips, feed |
| Daily rollup rows (`kol_metric_daily`) | 8 (latest 2026-08-20) |
| Monthly rollup rows | 2 |
| Format breakdown rows | 10 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 6,102). |
| Recent content exists | Yes -- newest post is 15 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 17 of 100 sampled (17%) |
| Male | 16 of 100 sampled (16%) |
| Unknown | 67 of 100 sampled (67%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 12 geo rows; top resolved: ID=17; JP=1; PS=1 |
| Audience cities | included in the 12 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 14 rows; top: unknown=83; business=8; fashion=3 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2026-08-14 (21 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-20 |
| Analytics last updated | 2026-08-20 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🟠 Verification conflict: `kol_directory.verified_status = 'verified'` but `l1_silver.unified_profile.is_verified = false`. `is_verified` is false for every account in this audit -- including @instagram and @cristiano -- so the medallion flag is not being populated at all.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (67 of 100 sampled units). Only 33% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟡 Views are present on only 4 of 10 sampled posts, so the average-views figure is a mean over a partial sub-sample rather than over the post set.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**95 / 100**

Missing: age groups (-3); sync log entries (-2).

---

## 6. @ibnuwardani

### Account Status

**Found** -- `public.kol_directory` row `5f336f2d-8ae2-4002-b456-1c956a274b15` (platform `tiktok`), linked to `social_account` `4acdd7f4-3c7d-43bf-9a50-1dae453c8247`.

### Profile Information

| Field | Value |
| --- | --- |
| Username | ibnuwardani |
| Display Name | Ibnu Wardani |
| Platform | tiktok |
| Category | NULL |
| Profile URL | https://tiktok.com/@ibnuwardani |
| Avatar | NULL |
| Bio | NULL |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | NULL |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | NULL |
| Roster row created | 2023-02-26 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 26,200,000 | `kol_directory.followers_count` |
| Followers (measured) | 35,000,000 | `l1_silver.unified_profile.followers_count` |
| Following | 505 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 2,483 | `l1_silver.unified_profile.media_count` |
| Average Likes | 154,211 | `l2_gold.post_metric.likes` |
| Average Comments | 24,609 | `l2_gold.post_metric.comments` |
| Average Views | 2,762,680 (over 10 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | 4,144 | `l2_gold.post_metric.shares` |
| Average Saves | 6,273 | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 1,542,112 | sum over `post_metric` |
| Total Comments (sample) | 246,086 | sum over `post_metric` |
| Total Views (sample) | 27,626,800 | sum over `post_metric` |
| Total Interactions (sample) | 1,829,641 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | NULL | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | 0.003257 (= 0.3257%), over 7 of 10 posts | `l2_gold.post_metric.er_followers`, a fraction |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | 0.2865 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-20 |
| Oldest Content | 2026-02-19 |
| Content Types | VIDEO |
| Daily rollup rows (`kol_metric_daily`) | 8 (latest 2026-08-20) |
| Monthly rollup rows | 2 |
| Format breakdown rows | 8 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 2,483). |
| Recent content exists | Yes -- newest post is 15 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 15 of 100 sampled (15%) |
| Male | 14 of 100 sampled (14%) |
| Unknown | 71 of 100 sampled (71%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 5 geo rows; top resolved: ID=6; AL=1; AR=1 |
| Audience cities | included in the 5 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 9 rows; top: unknown=90; parenting=2; business=2 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2024-05-09 (848 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-20 |
| Analytics last updated | 2026-08-20 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🔴 Requested as an Instagram account, but the roster holds only a **tiktok** row for this handle. No Instagram record exists in `public.kol_directory`. Every figure in this record is tiktok data.
* 🟠 Follower count disagrees between layers: `kol_directory.followers_count` = 26,200,000 vs `l1_silver.unified_profile.followers_count` = 35,000,000 (34% apart). The directory value is the one the roster list, the filters and the tier band all read.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (71 of 100 sampled units). Only 29% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟠 `kol_directory.last_refreshed_at` is 2024-05-09 (848 days old) while the medallion layers hold data from 2026-08-24. The directory timestamp does not track the pipeline, so the roster list reports this creator as far more stale than it actually is.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**82 / 100**

Missing: avatar_url (-3); bio (-4); category (-4); age groups (-3); directory refresh within 30d (-2); sync log entries (-2).

---

## 7. @iben_ma

### Account Status

**Found** -- `public.kol_directory` row `de7b3261-7d29-45c2-bd45-afb68a980420` (platform `instagram`), linked to `social_account` `bceae6f4-8346-4bf4-8cd3-5ecd4c7a3278`.

This handle also holds a second roster row on another platform: `3f8232fc-ac7f-447f-b0ec-5cee130ee3c6` (tiktok). The record below audits the **instagram** row, which is the platform requested; the other platform's figures are summarised at the end of this record.

### Profile Information

| Field | Value |
| --- | --- |
| Username | iben_ma |
| Display Name | Benjamin Master Adhisurya |
| Platform | instagram |
| Category | Entertainment |
| Profile URL | https://www.instagram.com/iben_ma |
| Avatar | present |
| Bio | `living life to the fullest of capacity 💯🚀  #LLTTFOC  @sambalbakar 🔥 @jualemasidn 🥇 @fuelwo...` |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | verified |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | 9236705215 |
| Roster row created | 2023-02-26 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 3,997,609 | `kol_directory.followers_count` |
| Followers (measured) | 4,007,007 | `l1_silver.unified_profile.followers_count` |
| Following | 3,927 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 1,597 | `l1_silver.unified_profile.media_count` |
| Average Likes | 60,427 | `l2_gold.post_metric.likes` |
| Average Comments | 599 | `l2_gold.post_metric.comments` |
| Average Views | 1,441,758 (over 9 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | NULL | `l2_gold.post_metric.shares` |
| Average Saves | NULL | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 604,273 | sum over `post_metric` |
| Total Comments (sample) | 5,989 | sum over `post_metric` |
| Total Views (sample) | 12,975,818 | sum over `post_metric` |
| Total Interactions (sample) | 610,262 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | 1.46% | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | 0.020112 (= 2.0112%), over 5 of 10 posts | `l2_gold.post_metric.er_followers`, a fraction |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | 0.2351 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-19 |
| Oldest Content | 2026-08-12 |
| Content Types | carousel_container, clips |
| Daily rollup rows (`kol_metric_daily`) | 6 (latest 2026-08-19) |
| Monthly rollup rows | 1 |
| Format breakdown rows | 7 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 1,597). |
| Recent content exists | Yes -- newest post is 16 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 15 of 100 sampled (15%) |
| Male | 23 of 100 sampled (23%) |
| Unknown | 62 of 100 sampled (62%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 9 geo rows; top resolved: ID=12; IT=1; PS=1 |
| Audience cities | included in the 9 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 11 rows; top: unknown=89; religion=3; sports=2 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2026-08-14 (21 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-19 |
| Analytics last updated | 2026-08-19 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🟠 Verification conflict: `kol_directory.verified_status = 'verified'` but `l1_silver.unified_profile.is_verified = false`. `is_verified` is false for every account in this audit -- including @instagram and @cristiano -- so the medallion flag is not being populated at all.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (62 of 100 sampled units). Only 38% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟡 Views are present on only 9 of 10 sampled posts, so the average-views figure is a mean over a partial sub-sample rather than over the post set.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**95 / 100**

Missing: age groups (-3); sync log entries (-2).

#### Companion tiktok row for the same handle

| Field | Value |
| --- | --- |
| Roster followers | 24,400,000 |
| Measured followers | 27,200,000 |
| Display name | Iben M.A. |
| Post records | 10 |
| Avg likes / comments / views | 252,890 / 908 / 2,898,460 |
| Gender split F / M / Unknown | 14 / 15 / 71 |
| Directory `last_refreshed_at` | 2024-12-20 |

---

## 8. @inul.d

### Account Status

**Found** -- `public.kol_directory` row `e8658a17-1a19-47cc-af37-cd77b51a5683` (platform `instagram`), linked to `social_account` `71775fff-a9ec-4b73-904c-15d09a7bd717`.

This handle also holds a second roster row on another platform: `740a0e98-6283-4053-81ab-484173df7bd6` (tiktok). The record below audits the **instagram** row, which is the platform requested; the other platform's figures are summarised at the end of this record.

### Profile Information

| Field | Value |
| --- | --- |
| Username | inul.d |
| Display Name | Inul Daratista |
| Platform | instagram |
| Category | NULL |
| Profile URL | https://www.instagram.com/inul.d |
| Avatar | present |
| Bio | `✨BA @sunco_id @brightgas @miburungdara @purinaindonesia  INUL INFO 👇` |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | verified |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | 606119027 |
| Roster row created | 2023-01-17 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 20,046,665 | `kol_directory.followers_count` |
| Followers (measured) | 20,042,625 | `l1_silver.unified_profile.followers_count` |
| Following | 3,222 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 16,571 | `l1_silver.unified_profile.media_count` |
| Average Likes | 3,672 | `l2_gold.post_metric.likes` |
| Average Comments | 84 | `l2_gold.post_metric.comments` |
| Average Views | 145,224 (over 5 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | NULL | `l2_gold.post_metric.shares` |
| Average Saves | NULL | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 36,715 | sum over `post_metric` |
| Total Comments (sample) | 844 | sum over `post_metric` |
| Total Views (sample) | 726,118 | sum over `post_metric` |
| Total Interactions (sample) | 37,559 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | 0.01% | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | 0.000262 (= 0.0262%), over 7 of 10 posts | `l2_gold.post_metric.er_followers`, a fraction |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | -0.0202 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-19 |
| Oldest Content | 2026-08-17 |
| Content Types | carousel_container, clips, feed |
| Daily rollup rows (`kol_metric_daily`) | 4 (latest 2026-08-20) |
| Monthly rollup rows | 1 |
| Format breakdown rows | 8 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 16,571). |
| Recent content exists | Yes -- newest post is 16 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 23 of 100 sampled (23%) |
| Male | 17 of 100 sampled (17%) |
| Unknown | 60 of 100 sampled (60%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 14 geo rows; top resolved: ID=13; PS=1; SG=1 |
| Audience cities | included in the 14 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 9 rows; top: unknown=87; business=5; parenting=4 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2026-08-14 (21 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-19 |
| Analytics last updated | 2026-08-20 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🟠 Verification conflict: `kol_directory.verified_status = 'verified'` but `l1_silver.unified_profile.is_verified = false`. `is_verified` is false for every account in this audit -- including @instagram and @cristiano -- so the medallion flag is not being populated at all.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (60 of 100 sampled units). Only 40% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟡 Views are present on only 5 of 10 sampled posts, so the average-views figure is a mean over a partial sub-sample rather than over the post set.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**91 / 100**

Missing: category (-4); age groups (-3); sync log entries (-2).

#### Companion tiktok row for the same handle

| Field | Value |
| --- | --- |
| Roster followers | 1,256 |
| Measured followers | 1,201 |
| Display name | user34976328345 |
| Post records | 1 |
| Avg likes / comments / views | 22 / 1 / 679 |
| Gender split F / M / Unknown | 12 / 15 / 73 |
| Directory `last_refreshed_at` | 2024-05-09 |

---

## 9. @bbrightvc

### Account Status

**Found** -- `public.kol_directory` row `de2ea37e-11c1-4da3-8fd9-181196c41fba` (platform `instagram`), linked to `social_account` `b6bebf9d-dd66-4742-b78f-19977148487a`.

### Profile Information

| Field | Value |
| --- | --- |
| Username | bbrightvc |
| Display Name | NULL |
| Platform | instagram |
| Category | Fashion |
| Profile URL | https://instagram.com/bbrightvc |
| Avatar | NULL |
| Bio | NULL |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | NULL |
| Verified (`unified_profile.is_verified`) | NULL |
| Private | NULL |
| Directory Status | active |
| Scrape Status | failed |
| Source | excel_import |
| Platform User ID | NULL |
| Roster row created | 2024-09-26 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 18,018,065 | `kol_directory.followers_count` |
| Followers (measured) | NULL | `l1_silver.unified_profile.followers_count` |
| Following | NULL | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | NULL | `l1_silver.unified_profile.media_count` |
| Average Likes | NULL | `l2_gold.post_metric.likes` |
| Average Comments | NULL | `l2_gold.post_metric.comments` |
| Average Views | UNAVAILABLE | `l2_gold.post_metric.views` NULL on all sampled posts |
| Average Shares | NULL | `l2_gold.post_metric.shares` |
| Average Saves | NULL | `l2_gold.post_metric.saves` |
| Total Likes (sample) | NULL | sum over `post_metric` |
| Total Comments (sample) | NULL | sum over `post_metric` |
| Total Views (sample) | NULL | sum over `post_metric` |
| Total Interactions (sample) | NULL | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | NULL | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | UNAVAILABLE / INSUFFICIENT DATA -- `er_followers` NULL on all 0 sampled posts | `l2_gold.post_metric.er_followers` |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | NULL | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 0 |
| Posts Analyzed (`l2_gold.post_metric`) | 0 |
| Latest Content | UNAVAILABLE |
| Oldest Content | UNAVAILABLE |
| Content Types | NULL |
| Daily rollup rows (`kol_metric_daily`) | 0 (latest --) |
| Monthly rollup rows | 0 |
| Format breakdown rows | 0 |
| Content Analytics Status | **No content history.** Zero post records, so no content analytics of any kind are possible. |
| Recent content exists | No |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | **No -- NO AUDIENCE DATA** |
| Female | NO DATA |
| Male | NO DATA |
| Unknown | NO DATA |
| Main Age Group | NO DATA |
| Countries | NO DATA |
| Cities | NO DATA |
| Languages | NO DATA |
| Interests | NO DATA |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | UNAVAILABLE |
| Profile date (silver) | UNAVAILABLE |
| Directory `last_refreshed_at` | 2026-08-14 (21 days ago) |
| Gold card `updated_at` | UNAVAILABLE |
| Content last updated | UNAVAILABLE |
| Analytics last updated | UNAVAILABLE |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Unknown** |

### Issues Found

* 🔴 No post records at all (`l1_silver.unified_post` = 0 rows), so every engagement figure is UNAVAILABLE.
* 🔴 `kol_directory.scrape_status = 'failed'` -- the harvest never completed, so no medallion row was ever written for this account.
* 🟠 No audience demographics of any kind -- `l2_gold.audience_demographics_daily` holds 0 rows for this account.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**20 / 100**

Missing: display name (-3); avatar_url (-3); bio (-4); following (-6); total posts (media_count) (-6); avg likes (-6); avg comments (-6); avg views (-5); engagement rate (-8); post records (-6); recent content (<=30d) (-5); content types (-4); gender split (-6); age groups (-3); geo (-2); interests (-1); profile snapshot date (-4); sync log entries (-2).

---

## 10. @pevpearce

### Account Status

**Found** -- `public.kol_directory` row `2a16a2e3-5b27-4a0e-b57b-336cacfc995e` (platform `instagram`), linked to `social_account` `34d4195e-6542-43be-a464-46c0c1301512`.

### Profile Information

| Field | Value |
| --- | --- |
| Username | pevpearce |
| Display Name | Pevita Pearce |
| Platform | instagram |
| Category | Lifestyle |
| Profile URL | https://www.instagram.com/pevpearce |
| Avatar | present |
| Bio | NULL |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | verified |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | 4310360 |
| Roster row created | 2023-04-29 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 17,452,714 | `kol_directory.followers_count` |
| Followers (measured) | 17,448,881 | `l1_silver.unified_profile.followers_count` |
| Following | 523 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 1,615 | `l1_silver.unified_profile.media_count` |
| Average Likes | 68,276 | `l2_gold.post_metric.likes` |
| Average Comments | 501 | `l2_gold.post_metric.comments` |
| Average Views | 577,656 (over 3 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | NULL | `l2_gold.post_metric.shares` |
| Average Saves | NULL | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 682,759 | sum over `post_metric` |
| Total Comments (sample) | 5,014 | sum over `post_metric` |
| Total Views (sample) | 1,732,967 | sum over `post_metric` |
| Total Interactions (sample) | 687,773 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | 0.28% | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | 0.004577 (= 0.4577%), over 2 of 10 posts | `l2_gold.post_metric.er_followers`, a fraction |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | -0.022 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-20 |
| Oldest Content | 2026-07-04 |
| Content Types | carousel_container, clips |
| Daily rollup rows (`kol_metric_daily`) | 9 (latest 2026-08-20) |
| Monthly rollup rows | 2 |
| Format breakdown rows | 10 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 1,615). |
| Recent content exists | Yes -- newest post is 15 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 11 of 100 sampled (11%) |
| Male | 28 of 100 sampled (28%) |
| Unknown | 61 of 100 sampled (61%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 14 geo rows; top resolved: ID=9; JP=3; IL=1 |
| Audience cities | included in the 14 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 13 rows; top: unknown=84; religion=5; business=4 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2026-08-14 (21 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-20 |
| Analytics last updated | 2026-08-20 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🟠 Verification conflict: `kol_directory.verified_status = 'verified'` but `l1_silver.unified_profile.is_verified = false`. `is_verified` is false for every account in this audit -- including @instagram and @cristiano -- so the medallion flag is not being populated at all.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (61 of 100 sampled units). Only 39% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟡 Views are present on only 3 of 10 sampled posts, so the average-views figure is a mean over a partial sub-sample rather than over the post set.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**91 / 100**

Missing: bio (-4); age groups (-3); sync log entries (-2).

---

## 11. @irwansyah_15

### Account Status

**Found** -- `public.kol_directory` row `24ddf147-0f3c-4591-8c2d-36ac6c0d991c` (platform `instagram`), linked to `social_account` `5a945734-8959-46ae-a58c-980718071756`.

### Profile Information

| Field | Value |
| --- | --- |
| Username | irwansyah_15 |
| Display Name | Irwansyah |
| Platform | instagram |
| Category | NULL |
| Profile URL | https://www.instagram.com/irwansyah_15 |
| Avatar | present |
| Bio | `Indonesian • @15interior_official  • @jannahtravel  • @umroqutravel  • @swizgroup  Cp +628...` |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | verified |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | 207462511 |
| Roster row created | 2024-04-06 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 14,916,540 | `kol_directory.followers_count` |
| Followers (measured) | 14,912,349 | `l1_silver.unified_profile.followers_count` |
| Following | 701 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 4,244 | `l1_silver.unified_profile.media_count` |
| Average Likes | 41,746 **(corrupted -- see Issues)**; 139,157 excluding `likes = -1` rows | `l2_gold.post_metric.likes` |
| Average Comments | 275 | `l2_gold.post_metric.comments` |
| Average Views | 1,428,480 (over 8 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | NULL | `l2_gold.post_metric.shares` |
| Average Saves | NULL | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 417,463 | sum over `post_metric` |
| Total Comments (sample) | 2,747 | sum over `post_metric` |
| Total Views (sample) | 11,427,838 | sum over `post_metric` |
| Total Interactions (sample) | 420,210 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | 0.25% | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | UNAVAILABLE / INSUFFICIENT DATA -- `er_followers` NULL on all 10 sampled posts | `l2_gold.post_metric.er_followers` |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | -0.0281 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-17 |
| Oldest Content | 2022-12-17 |
| Content Types | clips, feed |
| Daily rollup rows (`kol_metric_daily`) | 10 (latest 2026-08-17) |
| Monthly rollup rows | 4 |
| Format breakdown rows | 10 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 4,244). |
| Recent content exists | Yes -- newest post is 18 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 28 of 100 sampled (28%) |
| Male | 11 of 100 sampled (11%) |
| Unknown | 61 of 100 sampled (61%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 11 geo rows; top resolved: ID=7; PS=1; TR=1 |
| Audience cities | included in the 11 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 15 rows; top: unknown=83; business=5; religion=4 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2026-08-14 (21 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-17 |
| Analytics last updated | 2026-08-17 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🔴 7 of 10 sampled posts carry `likes = -1` in `l2_gold.post_metric` -- the *likes hidden* sentinel. The sentinel is summed arithmetically into `engagement_owned`, so both the average-likes figure (41,746 as stored) and the interaction total are wrong. Excluding the sentinel rows the average is 139,157 over 3 post(s).
* 🟠 Verification conflict: `kol_directory.verified_status = 'verified'` but `l1_silver.unified_profile.is_verified = false`. `is_verified` is false for every account in this audit -- including @instagram and @cristiano -- so the medallion flag is not being populated at all.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (61 of 100 sampled units). Only 39% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟡 Views are present on only 8 of 10 sampled posts, so the average-views figure is a mean over a partial sub-sample rather than over the post set.
* 🟠 `er_followers` is NULL on all 10 sampled posts -- no per-post engagement rate can be derived because no follower snapshot lines up with the post dates.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**91 / 100**

Missing: category (-4); age groups (-3); sync log entries (-2).

---

## 12. @fadiljaidi

### Account Status

**Found** -- `public.kol_directory` row `6cdc37ba-be56-4b56-b1ea-41cc54187587` (platform `instagram`), linked to `social_account` `9a9477fd-ed5e-4fb1-ba0e-1d3debece65c`.

### Profile Information

| Field | Value |
| --- | --- |
| Username | fadiljaidi |
| Display Name | Fadil Jaidi |
| Platform | instagram |
| Category | NULL |
| Profile URL | https://www.instagram.com/fadiljaidi |
| Avatar | present |
| Bio | `BA @maricafe.id  Endorsement  WA : 081295223083(Admin 1)          085282606565(Admin 2)` |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | verified |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | 846852257 |
| Roster row created | 2023-02-26 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 14,398,391 | `kol_directory.followers_count` |
| Followers (measured) | 14,398,933 | `l1_silver.unified_profile.followers_count` |
| Following | 1,483 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 1,512 | `l1_silver.unified_profile.media_count` |
| Average Likes | 485,532 | `l2_gold.post_metric.likes` |
| Average Comments | 1,659 | `l2_gold.post_metric.comments` |
| Average Views | 8,239,791 (over 9 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | NULL | `l2_gold.post_metric.shares` |
| Average Saves | NULL | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 4,855,319 | sum over `post_metric` |
| Total Comments (sample) | 16,589 | sum over `post_metric` |
| Total Views (sample) | 74,158,123 | sum over `post_metric` |
| Total Interactions (sample) | 4,871,908 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | 3.07% | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | UNAVAILABLE / INSUFFICIENT DATA -- `er_followers` NULL on all 10 sampled posts | `l2_gold.post_metric.er_followers` |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | 0.0038 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-18 |
| Oldest Content | 2026-06-24 |
| Content Types | clips, feed |
| Daily rollup rows (`kol_metric_daily`) | 10 (latest 2026-08-18) |
| Monthly rollup rows | 3 |
| Format breakdown rows | 10 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 1,512). |
| Recent content exists | Yes -- newest post is 17 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 15 of 100 sampled (15%) |
| Male | 6 of 100 sampled (6%) |
| Unknown | 79 of 100 sampled (79%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 5 geo rows; top resolved: ID=4; SG=1 |
| Audience cities | included in the 5 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 8 rows; top: unknown=91; religion=2; business=2 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2026-08-14 (21 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-18 |
| Analytics last updated | 2026-08-18 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🟠 Verification conflict: `kol_directory.verified_status = 'verified'` but `l1_silver.unified_profile.is_verified = false`. `is_verified` is false for every account in this audit -- including @instagram and @cristiano -- so the medallion flag is not being populated at all.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (79 of 100 sampled units). Only 21% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟡 Views are present on only 9 of 10 sampled posts, so the average-views figure is a mean over a partial sub-sample rather than over the post set.
* 🟠 `er_followers` is NULL on all 10 sampled posts -- no per-post engagement rate can be derived because no follower snapshot lines up with the post dates.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**91 / 100**

Missing: category (-4); age groups (-3); sync log entries (-2).

---

## 13. @saalhaerid

### Account Status

**Found** -- `public.kol_directory` row `6ce42ec0-2a7c-4642-8a3d-f445d1fe7e2b` (platform `instagram`), linked to `social_account` `c8699f2e-bd28-4cd6-8053-9ee54a68e0f1`.

This handle also holds a second roster row on another platform: `9af7e5b8-8967-46ea-9ace-7f84b7e879ca` (tiktok). The record below audits the **instagram** row, which is the platform requested; the other platform's figures are summarised at the end of this record.

### Profile Information

| Field | Value |
| --- | --- |
| Username | saalhaerid |
| Display Name | SAID UDAY AL HAERID |
| Platform | instagram |
| Category | NULL |
| Profile URL | https://www.instagram.com/saalhaerid |
| Avatar | present |
| Bio | `PP/ENDORSE @prabmanagement Campaign/Kerjasama DM @adminabadi @pentolplatkt  @tofu_brutal  ...` |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | verified |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | 3561211398 |
| Roster row created | 2023-02-22 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 2,249,679 | `kol_directory.followers_count` |
| Followers (measured) | 2,249,680 | `l1_silver.unified_profile.followers_count` |
| Following | 707 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 207 | `l1_silver.unified_profile.media_count` |
| Average Likes | 19,563 | `l2_gold.post_metric.likes` |
| Average Comments | 62 | `l2_gold.post_metric.comments` |
| Average Views | 399,921 (over 6 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | NULL | `l2_gold.post_metric.shares` |
| Average Saves | NULL | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 195,631 | sum over `post_metric` |
| Total Comments (sample) | 622 | sum over `post_metric` |
| Total Views (sample) | 2,399,524 | sum over `post_metric` |
| Total Interactions (sample) | 196,253 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | 0.72% | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | 0.00553 (= 0.5530%), over 1 of 10 posts | `l2_gold.post_metric.er_followers`, a fraction |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | 0.0 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-17 |
| Oldest Content | 2025-12-26 |
| Content Types | carousel_container, clips |
| Daily rollup rows (`kol_metric_daily`) | 10 (latest 2026-08-17) |
| Monthly rollup rows | 3 |
| Format breakdown rows | 10 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 207). |
| Recent content exists | Yes -- newest post is 18 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 6 of 100 sampled (6%) |
| Male | 24 of 100 sampled (24%) |
| Unknown | 70 of 100 sampled (70%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 6 geo rows; top resolved: ID=5; KR=1; PA=1 |
| Audience cities | included in the 6 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 6 rows; top: unknown=93; religion=3; sports=1 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2026-08-14 (21 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-17 |
| Analytics last updated | 2026-08-17 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🟠 Verification conflict: `kol_directory.verified_status = 'verified'` but `l1_silver.unified_profile.is_verified = false`. `is_verified` is false for every account in this audit -- including @instagram and @cristiano -- so the medallion flag is not being populated at all.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (70 of 100 sampled units). Only 30% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟡 Views are present on only 6 of 10 sampled posts, so the average-views figure is a mean over a partial sub-sample rather than over the post set.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**91 / 100**

Missing: category (-4); age groups (-3); sync log entries (-2).

#### Companion tiktok row for the same handle

| Field | Value |
| --- | --- |
| Roster followers | 14,000,000 |
| Measured followers | 13,900,000 |
| Display name | Saal |
| Post records | 10 |
| Avg likes / comments / views | 207,439 / 767 / 2,531,250 |
| Gender split F / M / Unknown | 14 / 14 / 72 |
| Directory `last_refreshed_at` | 2024-05-09 |

---

## 14. @jharnabhagwani

### Account Status

**Found** -- `public.kol_directory` row `5ab1c10c-e701-4631-a37a-7e4272956e4c` (platform `tiktok`), linked to `social_account` `1d360305-5835-451d-8928-163337860ecb`.

### Profile Information

| Field | Value |
| --- | --- |
| Username | jharnabhagwani |
| Display Name | jharna bhagwani |
| Platform | tiktok |
| Category | NULL |
| Profile URL | https://tiktok.com/@jharnabhagwani |
| Avatar | NULL |
| Bio | NULL |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | NULL |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | NULL |
| Roster row created | 2023-02-26 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 13,200,000 | `kol_directory.followers_count` |
| Followers (measured) | 13,200,000 | `l1_silver.unified_profile.followers_count` |
| Following | 105 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 679 | `l1_silver.unified_profile.media_count` |
| Average Likes | 3,908,147 | `l2_gold.post_metric.likes` |
| Average Comments | 22,380 | `l2_gold.post_metric.comments` |
| Average Views | 47,997,390 (over 10 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | 84,069 | `l2_gold.post_metric.shares` |
| Average Saves | 233,978 | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 39,081,473 | sum over `post_metric` |
| Total Comments (sample) | 223,798 | sum over `post_metric` |
| Total Views (sample) | 479,973,900 | sum over `post_metric` |
| Total Interactions (sample) | 40,145,960 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | NULL | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | 0.001872 (= 0.1872%), over 5 of 10 posts | `l2_gold.post_metric.er_followers`, a fraction |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | 0.0 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-18 |
| Oldest Content | 2024-04-19 |
| Content Types | CAROUSEL, VIDEO |
| Daily rollup rows (`kol_metric_daily`) | 9 (latest 2026-08-18) |
| Monthly rollup rows | 4 |
| Format breakdown rows | 10 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 679). |
| Recent content exists | Yes -- newest post is 17 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 18 of 100 sampled (18%) |
| Male | 8 of 100 sampled (8%) |
| Unknown | 74 of 100 sampled (74%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 7 geo rows; top resolved: ID=4; MX=2; BD=2 |
| Audience cities | included in the 7 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 10 rows; top: unknown=85; beauty=4; gaming=3 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2024-05-09 (848 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-18 |
| Analytics last updated | 2026-08-18 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🔴 Requested as an Instagram account, but the roster holds only a **tiktok** row for this handle. No Instagram record exists in `public.kol_directory`. Every figure in this record is tiktok data.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (74 of 100 sampled units). Only 26% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟠 `kol_directory.last_refreshed_at` is 2024-05-09 (848 days old) while the medallion layers hold data from 2026-08-24. The directory timestamp does not track the pipeline, so the roster list reports this creator as far more stale than it actually is.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**82 / 100**

Missing: avatar_url (-3); bio (-4); category (-4); age groups (-3); directory refresh within 30d (-2); sync log entries (-2).

---

## 15. @sptrakori_

### Account Status

**Found** -- `public.kol_directory` row `6b54df83-8c12-4176-95c3-857de80da254` (platform `tiktok`), linked to `social_account` `81870f7b-fb28-4cbd-a577-d5d7ad94eb1d`.

### Profile Information

| Field | Value |
| --- | --- |
| Username | sptrakori_ |
| Display Name | sptrakori_ |
| Platform | tiktok |
| Category | Entertainment |
| Profile URL | https://tiktok.com/@sptrakori_ |
| Avatar | NULL |
| Bio | NULL |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | NULL |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | NULL |
| Roster row created | 2023-02-26 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 13,100,000 | `kol_directory.followers_count` |
| Followers (measured) | 20,200,000 | `l1_silver.unified_profile.followers_count` |
| Following | 1,069 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 3,489 | `l1_silver.unified_profile.media_count` |
| Average Likes | 117,007 | `l2_gold.post_metric.likes` |
| Average Comments | 1,438 | `l2_gold.post_metric.comments` |
| Average Views | 843,860 (over 10 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | 3,178 | `l2_gold.post_metric.shares` |
| Average Saves | 6,039 | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 1,170,071 | sum over `post_metric` |
| Total Comments (sample) | 14,383 | sum over `post_metric` |
| Total Views (sample) | 8,438,600 | sum over `post_metric` |
| Total Interactions (sample) | 1,216,232 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | NULL | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | 0.006021 (= 0.6021%), over 10 of 10 posts | `l2_gold.post_metric.er_followers`, a fraction |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | 0.0 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-20 |
| Oldest Content | 2026-08-14 |
| Content Types | VIDEO |
| Daily rollup rows (`kol_metric_daily`) | 7 (latest 2026-08-20) |
| Monthly rollup rows | 1 |
| Format breakdown rows | 7 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 3,489). |
| Recent content exists | Yes -- newest post is 15 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 25 of 100 sampled (25%) |
| Male | 6 of 100 sampled (6%) |
| Unknown | 69 of 100 sampled (69%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 7 geo rows; top resolved: ID=13; IL=2; IN=1 |
| Audience cities | included in the 7 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 8 rows; top: unknown=87; parenting=3; business=2 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2024-05-11 (846 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-20 |
| Analytics last updated | 2026-08-20 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🔴 Requested as an Instagram account, but the roster holds only a **tiktok** row for this handle. No Instagram record exists in `public.kol_directory`. Every figure in this record is tiktok data.
* 🟠 Follower count disagrees between layers: `kol_directory.followers_count` = 13,100,000 vs `l1_silver.unified_profile.followers_count` = 20,200,000 (54% apart). The directory value is the one the roster list, the filters and the tier band all read.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (69 of 100 sampled units). Only 31% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟠 `kol_directory.last_refreshed_at` is 2024-05-11 (846 days old) while the medallion layers hold data from 2026-08-24. The directory timestamp does not track the pipeline, so the roster list reports this creator as far more stale than it actually is.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**86 / 100**

Missing: avatar_url (-3); bio (-4); age groups (-3); directory refresh within 30d (-2); sync log entries (-2).

---

## 16. @lalitahutami

### Account Status

**Found** -- `public.kol_directory` row `4815a3e8-234e-4a76-8112-4e7b01c5f1fa` (platform `tiktok`), linked to `social_account` `ac234201-572f-459b-ab1d-da38e0c9f8c1`.

### Profile Information

| Field | Value |
| --- | --- |
| Username | lalitahutami |
| Display Name | Lita🐣 |
| Platform | tiktok |
| Category | NULL |
| Profile URL | https://tiktok.com/@lalitahutami |
| Avatar | NULL |
| Bio | NULL |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | NULL |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | NULL |
| Roster row created | 2023-02-26 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 12,700,000 | `kol_directory.followers_count` |
| Followers (measured) | 13,100,000 | `l1_silver.unified_profile.followers_count` |
| Following | 433 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 1,147 | `l1_silver.unified_profile.media_count` |
| Average Likes | 16,080 | `l2_gold.post_metric.likes` |
| Average Comments | 94 | `l2_gold.post_metric.comments` |
| Average Views | 392,440 (over 10 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | 147 | `l2_gold.post_metric.shares` |
| Average Saves | 476 | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 160,801 | sum over `post_metric` |
| Total Comments (sample) | 941 | sum over `post_metric` |
| Total Views (sample) | 3,924,400 | sum over `post_metric` |
| Total Interactions (sample) | 163,216 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | NULL | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | 0.000637 (= 0.0637%), over 1 of 10 posts | `l2_gold.post_metric.er_followers`, a fraction |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | 0.0 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-14 |
| Oldest Content | 2026-06-19 |
| Content Types | VIDEO |
| Daily rollup rows (`kol_metric_daily`) | 10 (latest 2026-08-14) |
| Monthly rollup rows | 3 |
| Format breakdown rows | 10 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 1,147). |
| Recent content exists | Yes -- newest post is 21 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 14 of 100 sampled (14%) |
| Male | 7 of 100 sampled (7%) |
| Unknown | 79 of 100 sampled (79%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 7 geo rows; top resolved: ID=7; KH=1; JP=1 |
| Audience cities | included in the 7 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 9 rows; top: unknown=89; religion=3; parenting=3 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2024-05-09 (848 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-14 |
| Analytics last updated | 2026-08-14 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🔴 Requested as an Instagram account, but the roster holds only a **tiktok** row for this handle. No Instagram record exists in `public.kol_directory`. Every figure in this record is tiktok data.
* 🟠 Follower count disagrees between layers: `kol_directory.followers_count` = 12,700,000 vs `l1_silver.unified_profile.followers_count` = 13,100,000 (3% apart). The directory value is the one the roster list, the filters and the tier band all read.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (79 of 100 sampled units). Only 21% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟠 `kol_directory.last_refreshed_at` is 2024-05-09 (848 days old) while the medallion layers hold data from 2026-08-24. The directory timestamp does not track the pipeline, so the roster list reports this creator as far more stale than it actually is.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**82 / 100**

Missing: avatar_url (-3); bio (-4); category (-4); age groups (-3); directory refresh within 30d (-2); sync log entries (-2).

---

## 17. @isyanasarasvati

### Account Status

**Found** -- `public.kol_directory` row `6f5d6884-363a-4913-80c6-8caef8ea3e28` (platform `instagram`), linked to `social_account` `46769c57-3dd9-4bee-a611-747686cf0a10`.

### Profile Information

| Field | Value |
| --- | --- |
| Username | isyanasarasvati |
| Display Name | Isyana Sarasvati |
| Platform | instagram |
| Category | Fashion |
| Profile URL | https://www.instagram.com/isyanasarasvati |
| Avatar | present |
| Bio | `@sarasvatistage @redrose.records` |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | verified |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | 5688704 |
| Roster row created | 2024-06-20 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 12,292,815 | `kol_directory.followers_count` |
| Followers (measured) | 12,286,540 | `l1_silver.unified_profile.followers_count` |
| Following | 549 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 2,177 | `l1_silver.unified_profile.media_count` |
| Average Likes | 997 **(corrupted -- see Issues)**; 4,987 excluding `likes = -1` rows | `l2_gold.post_metric.likes` |
| Average Comments | 206 | `l2_gold.post_metric.comments` |
| Average Views | 46,489 (over 1 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | NULL | `l2_gold.post_metric.shares` |
| Average Saves | NULL | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 9,965 | sum over `post_metric` |
| Total Comments (sample) | 2,064 | sum over `post_metric` |
| Total Views (sample) | 46,489 | sum over `post_metric` |
| Total Interactions (sample) | 12,029 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | 0.12% | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | UNAVAILABLE / INSUFFICIENT DATA -- `er_followers` NULL on all 10 sampled posts | `l2_gold.post_metric.er_followers` |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | -0.051 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-19 |
| Oldest Content | 2026-05-20 |
| Content Types | carousel_container, clips, feed |
| Daily rollup rows (`kol_metric_daily`) | 8 (latest 2026-08-19) |
| Monthly rollup rows | 3 |
| Format breakdown rows | 10 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 2,177). |
| Recent content exists | Yes -- newest post is 16 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 10 of 100 sampled (10%) |
| Male | 16 of 100 sampled (16%) |
| Unknown | 74 of 100 sampled (74%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 7 geo rows; top resolved: KR=1; JP=1; PS=1 |
| Audience cities | included in the 7 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 13 rows; top: unknown=87; technology=2; pets=2 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2026-08-14 (21 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-19 |
| Analytics last updated | 2026-08-19 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🔴 8 of 10 sampled posts carry `likes = -1` in `l2_gold.post_metric` -- the *likes hidden* sentinel. The sentinel is summed arithmetically into `engagement_owned`, so both the average-likes figure (997 as stored) and the interaction total are wrong. Excluding the sentinel rows the average is 4,987 over 2 post(s).
* 🟠 Verification conflict: `kol_directory.verified_status = 'verified'` but `l1_silver.unified_profile.is_verified = false`. `is_verified` is false for every account in this audit -- including @instagram and @cristiano -- so the medallion flag is not being populated at all.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (74 of 100 sampled units). Only 26% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟡 Views are present on only 1 of 10 sampled posts, so the average-views figure is a mean over a partial sub-sample rather than over the post set.
* 🟠 `er_followers` is NULL on all 10 sampled posts -- no per-post engagement rate can be derived because no follower snapshot lines up with the post dates.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**95 / 100**

Missing: age groups (-3); sync log entries (-2).

---

## 18. @lambe_turah

### Account Status

**Found** -- `public.kol_directory` row `5dc465b4-bf50-4db8-a0dd-0492f250c66b` (platform `instagram`), linked to `social_account` `89c0a941-20f5-4fad-9045-a5ad10f92f2f`.

### Profile Information

| Field | Value |
| --- | --- |
| Username | lambe_turah |
| Display Name | OFFICIAL LAMBE TURAH ENTRNT |
| Platform | instagram |
| Category | Entertainment |
| Profile URL | https://www.instagram.com/lambe_turah |
| Avatar | present |
| Bio | `GOSIP ADALAH FAKTA YANG TERTUNDA DM NO PICT = HOAX SPAM = BLOCK` |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | verified |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | 2007497503 |
| Roster row created | 2023-04-05 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 12,163,586 | `kol_directory.followers_count` |
| Followers (measured) | 12,167,763 | `l1_silver.unified_profile.followers_count` |
| Following | 1 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 24,089 | `l1_silver.unified_profile.media_count` |
| Average Likes | 9,954 | `l2_gold.post_metric.likes` |
| Average Comments | 1,940 | `l2_gold.post_metric.comments` |
| Average Views | UNAVAILABLE | `l2_gold.post_metric.views` NULL on all sampled posts |
| Average Shares | NULL | `l2_gold.post_metric.shares` |
| Average Saves | NULL | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 99,539 | sum over `post_metric` |
| Total Comments (sample) | 19,404 | sum over `post_metric` |
| Total Views (sample) | NULL | sum over `post_metric` |
| Total Interactions (sample) | 118,943 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | 0.08% | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | 0.000978 (= 0.0978%), over 10 of 10 posts | `l2_gold.post_metric.er_followers`, a fraction |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | 0.0343 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-20 |
| Oldest Content | 2026-08-19 |
| Content Types | carousel_container |
| Daily rollup rows (`kol_metric_daily`) | 2 (latest 2026-08-20) |
| Monthly rollup rows | 1 |
| Format breakdown rows | 2 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 24,089). |
| Recent content exists | Yes -- newest post is 15 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 9 of 100 sampled (9%) |
| Male | 11 of 100 sampled (11%) |
| Unknown | 80 of 100 sampled (80%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 6 geo rows; top resolved: ID=9; JP=1 |
| Audience cities | included in the 6 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 11 rows; top: unknown=87; business=5; religion=2 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2026-08-14 (21 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-20 |
| Analytics last updated | 2026-08-20 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🟠 Verification conflict: `kol_directory.verified_status = 'verified'` but `l1_silver.unified_profile.is_verified = false`. `is_verified` is false for every account in this audit -- including @instagram and @cristiano -- so the medallion flag is not being populated at all.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (80 of 100 sampled units). Only 20% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**90 / 100**

Missing: avg views (-5); age groups (-3); sync log entries (-2).

---

## 19. @ditanganu

### Account Status

**Found** -- `public.kol_directory` row `934b0de4-d57a-4798-a36f-79dc15bc07b0` (platform `tiktok`), linked to `social_account` `7f24a513-b477-4c39-a8f8-1147f944ba76`.

### Profile Information

| Field | Value |
| --- | --- |
| Username | ditanganu |
| Display Name | DitaKerang🌊 |
| Platform | tiktok |
| Category | NULL |
| Profile URL | https://tiktok.com/@ditanganu |
| Avatar | NULL |
| Bio | NULL |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | NULL |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | NULL |
| Roster row created | 2023-02-26 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 12,100,000 | `kol_directory.followers_count` |
| Followers (measured) | 14,900,000 | `l1_silver.unified_profile.followers_count` |
| Following | 237 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 5,579 | `l1_silver.unified_profile.media_count` |
| Average Likes | 8,170 | `l2_gold.post_metric.likes` |
| Average Comments | 133 | `l2_gold.post_metric.comments` |
| Average Views | 96,298 (over 10 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | 301 | `l2_gold.post_metric.shares` |
| Average Saves | 289 | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 81,703 | sum over `post_metric` |
| Total Comments (sample) | 1,334 | sum over `post_metric` |
| Total Views (sample) | 962,984 | sum over `post_metric` |
| Total Interactions (sample) | 86,044 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | NULL | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | 0.000577 (= 0.0577%), over 10 of 10 posts | `l2_gold.post_metric.er_followers`, a fraction |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | 0.0 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-20 |
| Oldest Content | 2026-08-18 |
| Content Types | VIDEO |
| Daily rollup rows (`kol_metric_daily`) | 3 (latest 2026-08-20) |
| Monthly rollup rows | 1 |
| Format breakdown rows | 3 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 5,579). |
| Recent content exists | Yes -- newest post is 15 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 21 of 100 sampled (21%) |
| Male | 11 of 100 sampled (11%) |
| Unknown | 68 of 100 sampled (68%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 7 geo rows; top resolved: ID=7; MC=1; AR=1 |
| Audience cities | included in the 7 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 5 rows; top: unknown=93; religion=3; food=2 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2024-05-09 (848 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-20 |
| Analytics last updated | 2026-08-20 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🔴 Requested as an Instagram account, but the roster holds only a **tiktok** row for this handle. No Instagram record exists in `public.kol_directory`. Every figure in this record is tiktok data.
* 🟠 Follower count disagrees between layers: `kol_directory.followers_count` = 12,100,000 vs `l1_silver.unified_profile.followers_count` = 14,900,000 (23% apart). The directory value is the one the roster list, the filters and the tier band all read.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (68 of 100 sampled units). Only 32% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟠 `kol_directory.last_refreshed_at` is 2024-05-09 (848 days old) while the medallion layers hold data from 2026-08-24. The directory timestamp does not track the pipeline, so the roster list reports this creator as far more stale than it actually is.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**82 / 100**

Missing: avatar_url (-3); bio (-4); category (-4); age groups (-3); directory refresh within 30d (-2); sync log entries (-2).

---

## 20. @hesfinatia

### Account Status

**Found** -- `public.kol_directory` row `8e0cdd34-85b3-446c-ad96-d1d19a9d32db` (platform `tiktok`), linked to `social_account` `305b9b0d-11f3-4cd9-9fc5-c7aee90fc609`.

### Profile Information

| Field | Value |
| --- | --- |
| Username | hesfinatia |
| Display Name | PINAT🍅 |
| Platform | tiktok |
| Category | Entertainment |
| Profile URL | https://tiktok.com/@hesfinatia |
| Avatar | NULL |
| Bio | NULL |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | NULL |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | NULL |
| Roster row created | 2023-02-26 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 12,000,000 | `kol_directory.followers_count` |
| Followers (measured) | 15,000,000 | `l1_silver.unified_profile.followers_count` |
| Following | 476 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 2,606 | `l1_silver.unified_profile.media_count` |
| Average Likes | 264,020 | `l2_gold.post_metric.likes` |
| Average Comments | 714 | `l2_gold.post_metric.comments` |
| Average Views | 2,383,810 (over 10 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | 4,716 | `l2_gold.post_metric.shares` |
| Average Saves | 5,533 | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 2,640,200 | sum over `post_metric` |
| Total Comments (sample) | 7,143 | sum over `post_metric` |
| Total Views (sample) | 23,838,100 | sum over `post_metric` |
| Total Interactions (sample) | 2,694,506 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | NULL | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | 0.018093 (= 1.8093%), over 6 of 10 posts | `l2_gold.post_metric.er_followers`, a fraction |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | 0.6711 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-17 |
| Oldest Content | 2026-08-10 |
| Content Types | VIDEO |
| Daily rollup rows (`kol_metric_daily`) | 8 (latest 2026-08-17) |
| Monthly rollup rows | 1 |
| Format breakdown rows | 8 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 2,606). |
| Recent content exists | Yes -- newest post is 18 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 18 of 100 sampled (18%) |
| Male | 2 of 100 sampled (2%) |
| Unknown | 80 of 100 sampled (80%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 6 geo rows; top resolved: ID=5; JP=1; AL=1 |
| Audience cities | included in the 6 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 8 rows; top: unknown=89; parenting=3; music=2 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2024-05-11 (846 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-17 |
| Analytics last updated | 2026-08-17 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🔴 Requested as an Instagram account, but the roster holds only a **tiktok** row for this handle. No Instagram record exists in `public.kol_directory`. Every figure in this record is tiktok data.
* 🟠 Follower count disagrees between layers: `kol_directory.followers_count` = 12,000,000 vs `l1_silver.unified_profile.followers_count` = 15,000,000 (25% apart). The directory value is the one the roster list, the filters and the tier band all read.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (80 of 100 sampled units). Only 20% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟠 `kol_directory.last_refreshed_at` is 2024-05-11 (846 days old) while the medallion layers hold data from 2026-08-24. The directory timestamp does not track the pipeline, so the roster list reports this creator as far more stale than it actually is.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**86 / 100**

Missing: avatar_url (-3); bio (-4); age groups (-3); directory refresh within 30d (-2); sync log entries (-2).

---

## 21. @erickapinedao9

### Account Status

**NOT FOUND IN DATABASE**

Searched exactly (case-insensitive, `@` stripped) against `public.kol_directory.username`, `kol_directory.username_normalized` and `public.social_account.username` in the `kol` database, and against `public.discover_creators` and `public.social_accounts` in the `tsdb` warehouse. Zero rows in all five.

### Profile Information

| Field | Value |
| --- | --- |
| Username | NOT FOUND |
| Display Name | NOT FOUND |
| Platform | NOT FOUND |
| Category | NOT FOUND |
| Profile URL | NOT FOUND |
| Account Status | NOT FOUND |

### Core Metrics

| Metric | Value |
| --- | --- |
| Followers | NOT FOUND |
| Following | NOT FOUND |
| Total Posts | NOT FOUND |
| Average Likes | NOT FOUND |
| Average Comments | NOT FOUND |
| Average Views | NOT FOUND |
| Engagement Rate | NOT FOUND |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records | NOT FOUND |
| Posts Analyzed | NOT FOUND |
| Latest Content | NOT FOUND |
| Content Analytics Status | NOT FOUND |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | No |
| Female | NOT FOUND |
| Male | NOT FOUND |
| Unknown | NOT FOUND |
| Main Age Group | NOT FOUND |

### Freshness

| Metric | Value |
| --- | --- |
| Last Updated | NOT FOUND |
| Profile Date | NOT FOUND |
| Sync Status | NOT FOUND |
| Freshness Status | Unknown |

### Issues Found

* 🔴 **Account not present in the database.** The exact handle `erickapinedao9` returns no row in either database.
* 🟠 A near-identical handle `erickapineda09` does exist in `public.kol_directory` (TikTok). It is a different string and was not audited as a substitute. If the requested handle was a typo, re-run against `erickapineda09`; if it was not, this account has never been ingested.

### Data Completeness Score

**0 / 100**

Nothing is present: no profile, no metrics, no content, no audience, no freshness data.

---

## 22. @anyageraldine

### Account Status

**Found** -- `public.kol_directory` row `d6e669df-9f46-4de6-a140-7c0a2c43cdd1` (platform `instagram`), linked to `social_account` `dd945491-b7b4-46df-8d9e-c612545f30ea`.

### Profile Information

| Field | Value |
| --- | --- |
| Username | anyageraldine |
| Display Name | AG. |
| Platform | instagram |
| Category | Lifestyle |
| Profile URL | https://www.instagram.com/anyageraldine |
| Avatar | present |
| Bio | `🇮🇩 Business inquiries: +62 811 191 8959 (ochi) Whatsapp.` |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | verified |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | 177756402 |
| Roster row created | 2023-09-13 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 11,208,273 | `kol_directory.followers_count` |
| Followers (measured) | 11,205,230 | `l1_silver.unified_profile.followers_count` |
| Following | 1,122 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 2,798 | `l1_silver.unified_profile.media_count` |
| Average Likes | 82,741 | `l2_gold.post_metric.likes` |
| Average Comments | 710 | `l2_gold.post_metric.comments` |
| Average Views | 230,982 (over 2 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | NULL | `l2_gold.post_metric.shares` |
| Average Saves | NULL | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 827,414 | sum over `post_metric` |
| Total Comments (sample) | 7,095 | sum over `post_metric` |
| Total Views (sample) | 461,963 | sum over `post_metric` |
| Total Interactions (sample) | 834,509 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | 0.60% | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | 0.004523 (= 0.4523%), over 3 of 10 posts | `l2_gold.post_metric.er_followers`, a fraction |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | -0.0271 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-16 |
| Oldest Content | 2023-10-12 |
| Content Types | carousel_container, clips, feed |
| Daily rollup rows (`kol_metric_daily`) | 9 (latest 2026-08-16) |
| Monthly rollup rows | 5 |
| Format breakdown rows | 10 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 2,798). |
| Recent content exists | Yes -- newest post is 19 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 10 of 100 sampled (10%) |
| Male | 29 of 100 sampled (29%) |
| Unknown | 61 of 100 sampled (61%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 10 geo rows; top resolved: ID=10 |
| Audience cities | included in the 10 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 9 rows; top: unknown=80; religion=10; business=6 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2026-08-14 (21 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-16 |
| Analytics last updated | 2026-08-16 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🟠 Verification conflict: `kol_directory.verified_status = 'verified'` but `l1_silver.unified_profile.is_verified = false`. `is_verified` is false for every account in this audit -- including @instagram and @cristiano -- so the medallion flag is not being populated at all.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (61 of 100 sampled units). Only 39% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟡 Views are present on only 2 of 10 sampled posts, so the average-views figure is a mean over a partial sub-sample rather than over the post set.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**95 / 100**

Missing: age groups (-3); sync log entries (-2).

---

## 23. @shabiraaluaadnan

### Account Status

**NOT FOUND IN DATABASE**

Searched exactly (case-insensitive, `@` stripped) against `public.kol_directory.username`, `kol_directory.username_normalized` and `public.social_account.username` in the `kol` database, and against `public.discover_creators` and `public.social_accounts` in the `tsdb` warehouse. Zero rows in all five.

### Profile Information

| Field | Value |
| --- | --- |
| Username | NOT FOUND |
| Display Name | NOT FOUND |
| Platform | NOT FOUND |
| Category | NOT FOUND |
| Profile URL | NOT FOUND |
| Account Status | NOT FOUND |

### Core Metrics

| Metric | Value |
| --- | --- |
| Followers | NOT FOUND |
| Following | NOT FOUND |
| Total Posts | NOT FOUND |
| Average Likes | NOT FOUND |
| Average Comments | NOT FOUND |
| Average Views | NOT FOUND |
| Engagement Rate | NOT FOUND |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records | NOT FOUND |
| Posts Analyzed | NOT FOUND |
| Latest Content | NOT FOUND |
| Content Analytics Status | NOT FOUND |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | No |
| Female | NOT FOUND |
| Male | NOT FOUND |
| Unknown | NOT FOUND |
| Main Age Group | NOT FOUND |

### Freshness

| Metric | Value |
| --- | --- |
| Last Updated | NOT FOUND |
| Profile Date | NOT FOUND |
| Sync Status | NOT FOUND |
| Freshness Status | Unknown |

### Issues Found

* 🔴 **Account not present in the database.** The exact handle `shabiraaluaadnan` returns no row in either database.
* 🟠 A near-identical handle `shabiraalulaadnan` does exist in `public.kol_directory` (TikTok). It is a different string and was not audited as a substitute. If the requested handle was a typo, re-run against `shabiraalulaadnan`; if it was not, this account has never been ingested.

### Data Completeness Score

**0 / 100**

Nothing is present: no profile, no metrics, no content, no audience, no freshness data.

---

## 24. @pojoksatu.id

### Account Status

**Found** -- `public.kol_directory` row `b5c58aa0-c1ee-40a4-9ba0-11befb331bd6` (platform `tiktok`), linked to `social_account` `0a03ffa4-772d-4c11-97b9-03dcfeaea5cd`.

### Profile Information

| Field | Value |
| --- | --- |
| Username | pojoksatu.id |
| Display Name | Pojoksatu |
| Platform | tiktok |
| Category | NULL |
| Profile URL | https://tiktok.com/@pojoksatu.id |
| Avatar | NULL |
| Bio | NULL |
| Location (`creator_city`) | NULL |
| Language | UNAVAILABLE -- no language column exists on any table in this database |
| Verified (`kol_directory.verified_status`) | NULL |
| Verified (`unified_profile.is_verified`) | False |
| Private | False |
| Directory Status | active |
| Scrape Status | success |
| Source | excel_import |
| Platform User ID | NULL |
| Roster row created | 2023-08-16 |

### Core Metrics

| Metric | Value | Source |
| --- | --- | --- |
| Followers (roster) | 10,500,000 | `kol_directory.followers_count` |
| Followers (measured) | 11,000,000 | `l1_silver.unified_profile.followers_count` |
| Following | 39 | `l1_silver.unified_profile.following_count` |
| Total Posts (account) | 1,833 | `l1_silver.unified_profile.media_count` |
| Average Likes | 2,298 | `l2_gold.post_metric.likes` |
| Average Comments | 51 | `l2_gold.post_metric.comments` |
| Average Views | 59,236 (over 10 of 10 sampled posts) | `l2_gold.post_metric.views` |
| Average Shares | 65 | `l2_gold.post_metric.shares` |
| Average Saves | 49 | `l2_gold.post_metric.saves` |
| Total Likes (sample) | 22,983 | sum over `post_metric` |
| Total Comments (sample) | 508 | sum over `post_metric` |
| Total Views (sample) | 592,359 | sum over `post_metric` |
| Total Interactions (sample) | 24,136 | `post_metric.engagement_owned` |
| Reach | UNAVAILABLE | `reach` is NULL on every row for every audited account |
| Engagement Rate (roster) | 0.01% | `kol_directory.engagement_rate`, a percentage |
| Engagement Rate (per-post mean) | 0.000221 (= 0.0221%), over 10 of 10 posts | `l2_gold.post_metric.er_followers`, a fraction |
| Tier | Mega | `unified_profile.tier` / `kol_tiers` band |
| Followers growth | 0.9174 | `unified_profile.followers_growth` |
| Rate card | UNAVAILABLE | `l1_silver.unified_rate_card` is empty table-wide |

### Content Data

| Metric | Value |
| --- | --- |
| Post Records (`l1_silver.unified_post`) | 10 |
| Posts Analyzed (`l2_gold.post_metric`) | 10 |
| Latest Content | 2026-08-20 |
| Oldest Content | 2026-08-20 |
| Content Types | VIDEO |
| Daily rollup rows (`kol_metric_daily`) | 1 (latest 2026-08-20) |
| Monthly rollup rows | 1 |
| Format breakdown rows | 1 |
| Content Analytics Status | Snapshot only. Exactly 10 posts -- a fixed sample cap, not the account's history (`media_count` = 1,833). |
| Recent content exists | Yes -- newest post is 15 days old |

### Audience Data

| Metric | Value |
| --- | --- |
| Audience Data Available | Yes -- gender only |
| Female | 4 of 100 sampled (4%) |
| Male | 11 of 100 sampled (11%) |
| Unknown | 85 of 100 sampled (85%) |
| Main Age Group | **NO AGE DATA** -- `audience_demographics_daily` holds no age rows for any account |
| Demographics as of | 2026-08-26 |
| Audience countries | 9 geo rows; top resolved: ID=10; GB=1; JP=1 |
| Audience cities | included in the 9 geo rows above (`geo_level = 'city'`) |
| Audience languages | UNAVAILABLE -- no language dimension exists |
| Interests | 8 rows; top: unknown=89; food=3; parenting=2 |

### Freshness

| Metric | Value |
| --- | --- |
| Profile last updated (gold snapshot) | 2026-08-24 (11 days ago) |
| Profile date (silver) | 2026-08-24 |
| Directory `last_refreshed_at` | 2023-08-16 (1115 days ago) |
| Gold card `updated_at` | 2026-08-26 |
| Content last updated | 2026-08-20 |
| Analytics last updated | 2026-08-20 |
| Last successful synchronization | UNAVAILABLE -- no `sync_log` row carries this `social_account_id` |
| Number of sync logs | 0 |
| **Freshness Status** | **Aging** -- data as of 2026-08-24, 11 days before the audit date |

### Issues Found

* 🔴 Requested as an Instagram account, but the roster holds only a **tiktok** row for this handle. No Instagram record exists in `public.kol_directory`. Every figure in this record is tiktok data.
* 🟠 Follower count disagrees between layers: `kol_directory.followers_count` = 10,500,000 vs `l1_silver.unified_profile.followers_count` = 11,000,000 (5% apart). The directory value is the one the roster list, the filters and the tier band all read.
* 🟡 No age-group demographics. `l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` only; the table holds no age row for any account.
* 🟠 Gender demographics are dominated by `unknown` (85 of 100 sampled units). Only 15% of the sample resolves to a gender, which is too thin to characterise the audience.
* 🟡 No rate card. `l1_silver.unified_rate_card` is empty for this account and table-wide (0 rows), and `l2_gold.kol_profile_card.rate_card*` is NULL.
* 🟠 No synchronisation history. `l0_harmonization.sync_log` holds 99 rows overall but not one carries this account's `social_account_id` -- the log records table-level runs, never per-account ones, so there is no way to tell when this creator was last refreshed or whether the refresh failed.
* 🟡 Post history is a fixed 10-post sample, not a history. Every audited account carries exactly 10 rows, so all averages are computed over that sample only.
* 🟠 `kol_directory.last_refreshed_at` is 2023-08-16 (1115 days old) while the medallion layers hold data from 2026-08-24. The directory timestamp does not track the pipeline, so the roster list reports this creator as far more stale than it actually is.
* 🟡 `creator_city` is NULL -- the roster row carries no location.

### Data Completeness Score

**82 / 100**

Missing: avatar_url (-3); bio (-4); category (-4); age groups (-3); directory refresh within 30d (-2); sync log entries (-2).

---

## Phase 5 -- Master summary table

One row per requested account. For the four handles that hold both an Instagram and a TikTok roster row, this table reports the row on the platform that was requested (Instagram); the companion row is covered inside that account's record above.

| No | Username | Found | Platform | Followers | Posts | Engagement Rate | Audience Data | Last Updated | Freshness | Issues | Completeness Score |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | ---: | ---: |
| 1 | @instagram | Found | instagram | 685,896,635 | 0 | 0.07% | No | 2026-08-14 | Aging | 7 | 54 |
| 2 | @cristiano | Found | instagram | 679,697,682 | 10 | 2.21% | Gender only | 2026-08-24 | Aging | 8 | 91 |
| 3 | @leomessi | Found | instagram | 516,283,723 | 10 | 2.66% | Gender only | 2026-08-24 | Aging | 9 | 95 |
| 4 | @raffinagita1717 | Found | instagram | 75,033,211 | 10 | 0.52% | Gender only | 2026-08-24 | Aging | 8 | 91 |
| 5 | @lunamaya | Found | instagram | 37,950,413 | 10 | 0.03% | Gender only | 2026-08-24 | Aging | 8 | 95 |
| 6 | @ibnuwardani | Found | tiktok | 35,000,000 | 10 | NULL | Gender only | 2026-08-24 | Aging | 9 | 82 |
| 7 | @iben_ma | Found | instagram | 4,007,007 | 10 | 1.46% | Gender only | 2026-08-24 | Aging | 8 | 95 |
| 8 | @inul.d | Found | instagram | 20,042,625 | 10 | 0.01% | Gender only | 2026-08-24 | Aging | 8 | 91 |
| 9 | @bbrightvc | Found | instagram | 18,018,065 | 0 | NULL | No | NULL | Unknown | 6 | 20 |
| 10 | @pevpearce | Found | instagram | 17,448,881 | 10 | 0.28% | Gender only | 2026-08-24 | Aging | 8 | 91 |
| 11 | @irwansyah_15 | Found | instagram | 14,912,349 | 10 | 0.25% | Gender only | 2026-08-24 | Aging | 10 | 91 |
| 12 | @fadiljaidi | Found | instagram | 14,398,933 | 10 | 3.07% | Gender only | 2026-08-24 | Aging | 9 | 91 |
| 13 | @saalhaerid | Found | instagram | 2,249,680 | 10 | 0.72% | Gender only | 2026-08-24 | Aging | 8 | 91 |
| 14 | @jharnabhagwani | Found | tiktok | 13,200,000 | 10 | NULL | Gender only | 2026-08-24 | Aging | 8 | 82 |
| 15 | @sptrakori_ | Found | tiktok | 20,200,000 | 10 | NULL | Gender only | 2026-08-24 | Aging | 9 | 86 |
| 16 | @lalitahutami | Found | tiktok | 13,100,000 | 10 | NULL | Gender only | 2026-08-24 | Aging | 9 | 82 |
| 17 | @isyanasarasvati | Found | instagram | 12,286,540 | 10 | 0.12% | Gender only | 2026-08-24 | Aging | 10 | 95 |
| 18 | @lambe_turah | Found | instagram | 12,167,763 | 10 | 0.08% | Gender only | 2026-08-24 | Aging | 7 | 90 |
| 19 | @ditanganu | Found | tiktok | 14,900,000 | 10 | NULL | Gender only | 2026-08-24 | Aging | 9 | 82 |
| 20 | @hesfinatia | Found | tiktok | 15,000,000 | 10 | NULL | Gender only | 2026-08-24 | Aging | 9 | 86 |
| 21 | @erickapinedao9 | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND | No | NOT FOUND | Unknown | 2 | 0 |
| 22 | @anyageraldine | Found | instagram | 11,205,230 | 10 | 0.60% | Gender only | 2026-08-24 | Aging | 8 | 95 |
| 23 | @shabiraaluaadnan | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND | NOT FOUND | No | NOT FOUND | Unknown | 2 | 0 |
| 24 | @pojoksatu.id | Found | tiktok | 11,000,000 | 10 | 0.01% | Gender only | 2026-08-24 | Aging | 9 | 82 |

**Averages across all 24 requested accounts:** completeness 77.4 / 100. **Across the 22 found:** 84.5 / 100. Highest: @leomessi (95). Lowest among found: @bbrightvc (20).

---

## Phase 6 -- Data coverage analysis

Counted over all 24 **requested** accounts. For a handle with two platform rows, the requested platform's row is the one counted. "Available" means the field holds a non-null value, not that the value is correct.

| Data Category | Available | Missing | Coverage % |
| --- | ---: | ---: | ---: |
| Profile Data (identity row exists with a display name) | 21/24 | 3/24 | 88% |
| Followers | 22/24 | 2/24 | 92% |
| Following | 21/24 | 3/24 | 88% |
| Total posts (media_count) | 21/24 | 3/24 | 88% |
| Bio | 12/24 | 12/24 | 50% |
| Category / niche | 12/24 | 12/24 | 50% |
| Avatar URL | 14/24 | 10/24 | 58% |
| Profile URL | 22/24 | 2/24 | 92% |
| Location (creator_city) | 0/24 | 24/24 | 0% |
| Engagement rate (roster, kol_directory) | 15/24 | 9/24 | 62% |
| Engagement rate (per-post, post_metric) | 16/24 | 8/24 | 67% |
| Average likes | 20/24 | 4/24 | 83% |
| Average views | 19/24 | 5/24 | 79% |
| Shares / saves | 7/24 | 17/24 | 29% |
| Reach | 0/24 | 24/24 | 0% |
| Content Data (>=1 post record) | 20/24 | 4/24 | 83% |
| Audience Data -- gender | 20/24 | 4/24 | 83% |
| Audience Data -- age groups | 0/24 | 24/24 | 0% |
| Audience Data -- geo | 20/24 | 4/24 | 83% |
| Audience Data -- interests | 20/24 | 4/24 | 83% |
| Audience Data -- languages | 0/24 | 24/24 | 0% |
| Rate card | 0/24 | 24/24 | 0% |
| Freshness Data (profile snapshot date) | 21/24 | 3/24 | 88% |
| Sync log entries | 0/24 | 24/24 | 0% |

Rolled up to the six categories requested:

| Data Category | Available | Missing | Coverage % |
| --- | ---: | ---: | ---: |
| Profile Data | 21/24 | 3/24 | 88% |
| Followers | 22/24 | 2/24 | 92% |
| Engagement | 21/24 | 3/24 | 88% |
| Content Data | 20/24 | 4/24 | 83% |
| Audience Data | 20/24 | 4/24 | 83% |
| Freshness Data | 21/24 | 3/24 | 88% |

---

## Phase 7 -- Issues summary

Ranked by how many of the 24 requested accounts each issue affects. Every entry below is an observed finding, not a hypothetical.

| Rank | Issue | Severity | Affected Accounts | Percentage |
| ---: | --- | --- | ---: | ---: |
| 1 | No per-account synchronisation history (`sync_log` carries no `social_account_id` for the account) | Major | 22 / 24 | 92% |
| 2 | No rate card anywhere (`unified_rate_card` empty table-wide) | Minor | 22 / 24 | 92% |
| 3 | `reach` NULL on every post and every daily rollup | Major | 22 / 24 | 92% |
| 4 | No age-group demographics (table holds `gender` only) | Minor | 22 / 24 | 92% |
| 5 | No location on the roster row (`creator_city` NULL) | Minor | 22 / 24 | 92% |
| 6 | Post history capped at a 10-post sample | Minor | 20 / 24 | 83% |
| 7 | Gender sample more than 60% `unknown` | Major | 20 / 24 | 83% |
| 8 | Verified conflict: roster says verified, `unified_profile.is_verified` says false | Major | 14 / 24 | 58% |
| 9 | Views present on only part of the post sample | Minor | 12 / 24 | 50% |
| 10 | Directory `last_refreshed_at` more than a year stale while the pipeline data is current | Major | 7 / 24 | 29% |
| 11 | Requested as Instagram but only a TikTok row exists | Critical | 7 / 24 | 29% |
| 12 | Roster follower count disagrees with the measured one by more than 2% | Major | 6 / 24 | 25% |
| 13 | `er_followers` NULL on every sampled post | Major | 4 / 24 | 17% |
| 14 | Negative likes (`-1` hidden-likes sentinel) polluting the averages and the interaction total | Critical | 2 / 24 | 8% |
| 15 | No post records at all | Critical | 2 / 24 | 8% |
| 16 | No audience demographics at all | Major | 2 / 24 | 8% |
| 17 | Account not found in the database | Critical | 2 / 24 | 8% |
| 18 | `scrape_status = 'failed'` -- harvest never completed | Critical | 1 / 24 | 4% |

### The three findings that change the numbers, not just the coverage

**1. `likes = -1` is a sentinel that is being summed as a number.** `l2_gold.post_metric` stores `likes = -1` on posts where the creator hides the like count, and sets `likes_hidden = true` alongside it. `engagement_owned` is then computed as likes + comments *including* the `-1`, so a post with 1 comment and hidden likes lands as `engagement_owned = 0`. Two audited accounts are affected -- `@irwansyah_15` (7 of 10 posts) and `@isyanasarasvati` (8 of 10). The damage to the average is severe: `@isyanasarasvati` averages **997** likes as stored, versus **4,987** over the two posts that actually carry a like count. Any screen reading average likes or total interactions for these two creators is showing a wrong number, not a missing one.

**2. NULL engagement rate is rendered as `0.00%` and labelled "measured".** `src/lib/discover/creatorMatch.ts:87` coerces `erPct: row.erPct ?? 0`, and `SIGNAL_BASIS` at line 64 marks `erPct` as `'measured'`. `src/lib/discover/account.ts:132`, `:150` and `:280` do the same with `Number(r.er_pct ?? 0)`. `DiscoverDirectoryView.tsx:77` then prints `p.erPct.value.toFixed(2)` unconditionally, and line 380 exports that same value to the CSV under the header `ER % (live)`. So a creator whose ER was never measured is indistinguishable in the table and in the export from one measured at zero. Among the audited accounts this affects the 7 TikTok-only rows, whose `kol_directory.engagement_rate` is NULL. Note that other call sites do handle it properly -- `CreatorDetail.tsx:188` prints `'not measured'`, and `CreatorRoster.tsx:450` passes null through -- so the behaviour is inconsistent between screens showing the same creator.

**3. Audience age and gender shown in the Creator workspace are generated, not read.** `src/lib/discover/kolSample.ts` is a seeded generator whose header states plainly that everything it returns is demo data, and `creatorSignals` derives `topAudience` from it. This is deliberate and the UI marks it -- so it is not a hidden defect -- but it interacts badly with a change on the data side: `l2_gold.audience_demographics_daily` now holds **real** gender rows for 23 accounts (69 rows, all of them accounts in this audit), and `audience_geo_daily` and `audience_interest_daily` hold real geo and interest rows. The `kolSample.ts` header still asserts the database "has no audience demographics". That comment is now out of date, and real audience data is sitting unused behind generated data.

### Platform-wide limitations, stated once

These apply to every audited account and were not repeated as a per-account issue where they are universal:

* **`reach` is NULL everywhere** -- on `post_metric`, on `kol_metric_daily` and on `unified_profile`. Reach needs the Instagram/TikTok Insights API, which this harvest does not have. `has_insights` is `false` on every profile row.
* **Instagram posts carry no shares and no saves.** `shares` and `saves` are populated only for TikTok. For all 15 Instagram accounts these are NULL, not zero.
* **`l1_silver.unified_rate_card` holds 0 rows table-wide,** and `l2_gold.kol_profile_card.rate_card`, `rate_card_currency`, `rate_card_min_fee` and `rate_card_max_fee` are NULL on all 1,976 rows.
* **`l1_silver.unified_audience` and `l1_silver.unified_comment` hold 0 rows table-wide.** The gold audience tables are populated without a silver layer beneath them.
* **`l2_gold.audience_demographics_daily` carries `audience_type = 'gender'` and nothing else** -- 69 rows total, three per account (female / male / unknown), for 23 accounts. There is no age dimension in the table for anyone.
* **The gender and geo figures are 100-unit samples,** not follower censuses: every account's three gender rows sum to exactly 100, and `unknown` runs between 61 and 85 of those 100.
* **Post history is capped at 10 rows per audited account.** `l1_silver.unified_post` holds 477 rows in total across the whole database; the cap is not global (one account elsewhere carries 200) but every account in this audit has exactly 10, or 1, or 0.
* **`l0_harmonization.sync_log` never records a `social_account_id`** for these accounts. Its 99 rows describe table-level runs (`instagram_profile`, `tiktok_post`, and so on) between 2026-08-12 and 2026-08-28. Per-account sync status is therefore unknowable from the database.
* **`public.add_kol_scrape_log` and `add_kol_pipeline_log` hold 0 rows for all 24 accounts** -- every one entered the roster through `source = 'excel_import'`, not through the Add-KOL pipeline.

### Checks that came back clean

* **No impossible percentages.** No `er_followers` above 1.0 anywhere in the sample.
* **No future-dated posts.** No `posted_at` later than the audit date.
* **No missing permalinks.** Every row in `post_metric` carries one.
* **No malformed profile URLs.** All 26 roster rows carry a well-formed `https://www.instagram.com/...` or `https://tiktok.com/@...` URL.
* **No negative values other than the `-1` likes sentinel described above.**
* **No duplicate roster rows.** The four handles with two rows each hold one per platform, which is the table's intended key.

---

## Annex -- the two near-match handles (NOT audited as substitutes)

Recorded only so the naming discrepancy can be settled. Neither is counted in any figure above.

| Field | `erickapineda09` | `shabiraalulaadnan` |
| --- | --- | --- |
| Requested as | `@erickapinedao9` | `@shabiraaluaadnan` |
| Platform in DB | tiktok | tiktok |
| Roster followers | 11,800,000 | 10,664,778 |
| Measured followers (gold card) | 16,800,000 | UNAVAILABLE |
| Display name | Ericka Pineda | NULL |
| Media count | 6,525 | NULL |
| Engagement rate | NULL | NULL |
| Post records | 0 | 0 |
| Audience data | NO DATA | NO DATA |
| Daily metrics | 0 | 0 |
| Avatar | NULL | NULL |
| `last_refreshed_at` | 2024-10-07 (697 days) | 2025-07-01 (430 days) |
| Freshness | Stale (directory); gold snapshot 2026-08-17 | Stale -- no gold card at all |

Both are directory-only entries: identity and a follower count, no content, no audience, no metrics.

---

## Phase 8 -- Export-ready output

`selected-kol-audit-summary.csv` sits beside this file, one row per requested account, 26 columns, using the same vocabulary as this report: `NULL`, `NOT FOUND`, `UNAVAILABLE`, `NO DATA`, `INSUFFICIENT DATA`. No cell is left ambiguously blank.

Column notes for the spreadsheet:

| Column | Meaning |
| --- | --- |
| `followers_roster` / `followers_measured` | `kol_directory.followers_count` and `l1_silver.unified_profile.followers_count`. They disagree for the TikTok rows -- both are given rather than one being picked. |
| `engagement_rate_roster_pct` | `kol_directory.engagement_rate`, already a percentage. |
| `engagement_rate_post_mean_frac` | mean `l2_gold.post_metric.er_followers`, a fraction. Multiply by 100 for a percentage. |
| `avg_likes_stored` / `avg_likes_excl_hidden` | the second column excludes `likes = -1` sentinel rows. They differ only for `@irwansyah_15` and `@isyanasarasvati`. |
| `posts_hidden_likes` | count of sampled posts carrying the `-1` sentinel. Non-zero means `avg_likes_stored` is wrong. |
| `gender_*` | counts out of a 100-unit sample, not follower counts. |
| `freshness` | Fresh / Aging / Stale / Unknown, per the rule stated in Phase 2. |
| `completeness_score` | 0-100, per the rubric stated in Phase 2. |

---

## Method note

Every figure in this report was read directly from the two databases with `SELECT` statements only. No row was inserted, updated or deleted; no file in `src/` was modified. Nothing was estimated, extrapolated or filled in: where a value is absent the report says which kind of absence it is. The only derived numbers are arithmetic means and sums over `l2_gold.post_metric`, which are labelled as such and reported next to the sample size they were computed over.
