/**
 * The Discovery filter catalogue and the ranking presets.
 *
 * The two right-hand columns of `DISCOVERY_FILTERS` — the KOL-database source
 * and its coverage — are carried over from `deliv.xlsx` (`Mapping Filter-DB`)
 * and from `discovery-filter-deliverables-audit.md`, re-measured 8 Sep 2026
 * against 7.721 active `kol_directory` rows. They are in the workbook for one
 * reason: a spec that defines a filter without saying whether the database can
 * answer it is how "Max Rate Card" ended up marked DONE while returning zero
 * creators for every price. The Excel is the source of truth for the *logic*;
 * these columns say which parts of that logic have data behind them today.
 *
 * One row changed meaning rather than status on 9 Sep 2026: "Verified" became
 * "Connected". They are not the same question — the first was the platform's
 * blue tick (455 of 932 valued rows), the second is whether the creator linked
 * the account through OAuth, which nobody has done yet. A filter went from
 * answering for 932 creators to answering for none, and that is a deliberate
 * product decision from the pipeline handoff, not a regression to be fixed by
 * putting the old column back.
 *
 * Status vocabulary is the audit's own:
 *   DONE             wired end to end, UI to SQL, and the count moves
 *   PARTIAL          works, but on a fraction of the roster
 *   BLOCKED BY DATA  correct code, empty column — shown disabled with a reason
 *   NEW              defined by this workbook; no column exists yet
 */

const H = 'HARD FILTER'
const S = 'SOFT MATCH'

/**
 * group, filter, key, type, control, brand input (Brand_Profile key or "—"),
 * KOL_Database field, prototype status, KOL-database source, coverage
 */
export const DISCOVERY_FILTERS = [
  ['SEARCH', 'Creator Search', 'q', H, 'Text input (debounce 350ms)', '—', 'Creator Name', 'DONE', 'kol_directory.username + agency_kol_accounts.label', '97,1%'],
  ['SEARCH', 'Handle', 'handle', H, 'Text input', '—', 'Handle', 'DONE', 'kol_directory.username_normalized', '97,1%'],
  ['SEARCH', 'Keyword', 'keyword', H, 'Text input', 'brand_keywords', 'Content Topics + Audience Interests', 'PARTIAL', 'kol_directory.bio', '~12% terisi'],
  ['SEARCH', 'Content Topic', 'topic', S, 'Multi-select', 'preferred_content_topics', 'Content Topics', 'BLOCKED BY DATA', 'feature.ig/tt_post_analysis.content_category', '0 baris'],

  ['PLATFORM', 'Instagram', 'platform.instagram', H, 'Chip', 'preferred_platform', 'Platform', 'DONE', 'kol_directory.platform_id → platforms.key', '97,1%'],
  ['PLATFORM', 'TikTok', 'platform.tiktok', H, 'Chip', 'preferred_platform', 'Platform', 'DONE', 'kol_directory.platform_id → platforms.key', '97,1%'],

  ['CREATOR', 'Category', 'categories', H, 'Multi-select chips', 'preferred_category', 'Category', 'DONE', 'category_ids → kol_categories', '54,1% (3.547 tanpa kategori)'],
  ['CREATOR', 'Sub Category', 'subCategories', S, 'Multi-select chips', 'preferred_subcategory', 'Sub Category', 'BLOCKED BY DATA', '— tidak ada kolom sub-kategori', '0%'],
  ['CREATOR', 'Tier', 'tiers', H, 'Multi-select chips', 'preferred_tier', 'Tier', 'DONE', 'followers_count terhadap kol_tiers', '7.195 bertier + 526 untiered'],
  ['CREATOR', 'Followers', 'minFollowers / maxFollowers', H, 'Range slider', 'preferred_followers_min / _max', 'Followers', 'DONE', 'kol_directory.followers_count', '97,1%'],
  ['CREATOR', 'Engagement Rate', 'minErPct', H, 'Slider 0–10%', 'min_engagement_rate', 'Engagement Rate', 'DONE', 'kol_directory.engagement_rate (ER_CLEAN)', '1.744 terpakai (22,6%)'],
  ['CREATOR', 'Creator Location', 'creatorCity', S, 'Dropdown', 'target_city', 'Creator City', 'BLOCKED BY DATA', 'kol_directory.creator_city', '0% terisi'],
  ['CREATOR', 'Connected', 'connectedOnly', H, 'Toggle', '—', 'Connected', 'BLOCKED BY DATA', 'social_account.platform_user_id + oauth_token', '0 creator — connect flow belum jalan'],

  ['AUDIENCE', 'Audience Country', 'audienceCountry', H, 'Dropdown', 'target_country', 'Audience Country', 'BLOCKED BY DATA', "audience_geo_daily (geo_level='country')", '23 creator'],
  ['AUDIENCE', 'Audience Region', 'audienceRegion', S, 'Dropdown', 'target_region', 'Audience Region', 'BLOCKED BY DATA', 'audience_geo_daily', '9 dari 33 key salah level'],
  ['AUDIENCE', 'Audience City', 'audienceCity', S, 'Dropdown', 'target_city', 'Audience City', 'BLOCKED BY DATA', "audience_geo_daily (geo_level='city')", '15 creator usable'],
  ['AUDIENCE', 'Audience Age', 'audienceAge', S, 'Chips 13–17 … 45+', 'primary_age_range / secondary_age_range', 'Audience Age 13–17 % … 45+ %', 'BLOCKED BY DATA', "audience_demographics_daily (audience_type='age')", '0 baris'],
  ['AUDIENCE', 'Audience Gender', 'audienceGender', S, 'Slider Major Female / Male', 'gender_majority', 'Female % / Male %', 'BLOCKED BY DATA', 'audience_demographics_daily (gender)', '23 creator (0,30%)'],
  ['AUDIENCE', 'Audience Interests', 'audienceInterests', S, 'Multi-select', 'audience_interests', 'Audience Interests', 'BLOCKED BY DATA', 'audience_interest_daily.interest_key', "23 creator; 85,2% 'unknown'"],
  ['AUDIENCE', 'Audience Quality', 'minAudienceQuality', H, 'Slider 0–100', 'min_audience_quality', 'Audience Quality', 'BLOCKED BY DATA', 'feature.ig/tt_audience_analysis.audience_quality_score', '23 creator'],
  ['AUDIENCE', 'Audience Authenticity', 'minAuthenticity', S, 'Slider 0–100', '—', 'Audience Authenticity', 'BLOCKED BY DATA', 'feature.ig/tt_audience_analysis.authenticity_score', '23 creator'],
  ['AUDIENCE', 'Purchase Intent', 'purchaseIntent', S, 'Dropdown', '—', 'Purchase Intent', 'NEW', '— belum ada kolom', '0%'],

  ['PERFORMANCE', 'Average Views', 'minAvgViews', S, 'Slider', '—', 'Average Views', 'PARTIAL', 'l2_gold.post_metric.views', '21 creator lolos threshold'],
  ['PERFORMANCE', 'Median Views', 'minMedianViews', S, 'Slider', '—', 'Median Views', 'NEW', '— belum ada agregat median', '0%'],
  ['PERFORMANCE', 'Engagement Rate', 'minErPct', H, 'Slider', 'min_engagement_rate', 'Engagement Rate', 'DONE', 'kol_directory.engagement_rate', '22,6%'],
  ['PERFORMANCE', 'Share Rate', 'minShareRate', S, 'Slider', '—', 'Share Rate', 'PARTIAL', 'l2_gold.post_metric.shares', '11 creator, TikTok saja'],
  ['PERFORMANCE', 'Save Rate', 'minSaveRate', S, 'Slider', '—', 'Save Rate', 'PARTIAL', 'l2_gold.post_metric.saves', '11 creator, TikTok saja'],
  ['PERFORMANCE', 'Consistency', 'minConsistency', S, 'Slider', '—', 'Consistency Score', 'BLOCKED BY DATA', '— nol kolom consistency/cadence', '0%'],
  ['PERFORMANCE', 'Follower Growth', 'growth', S, 'Preset band + sort', '—', 'Growth sejak snapshot terakhir', 'PARTIAL', 'l2_gold.kol_profile_card.followers_growth', '25 creator (0,3%) — butuh dua snapshot'],
  ['PERFORMANCE', '90D Growth', 'min90dGrowth', S, 'Slider', '—', '90D Growth', 'BLOCKED BY DATA', 'l2_gold.kol_metric_monthly (deret)', '5 creator ≥4 titik'],
  ['PERFORMANCE', 'Recent Performance', 'minRecentPerf', S, 'Slider', '—', 'Recent Performance', 'BLOCKED BY DATA', 'kol_metric_monthly (deret)', '5 creator'],
  ['PERFORMANCE', 'View-to-Follower Ratio', 'minVfr', S, 'Slider', '—', 'View-to-Follower Ratio', 'PARTIAL', 'post_metric.views ÷ followers_count', '21 creator'],

  ['COMMERCIAL', 'Rate', 'maxRate', H, 'Slider 500rb–1M', '—', 'Rate Card (IDR)', 'BLOCKED BY DATA', 'l1_silver.unified_rate_card', '0 baris'],
  ['COMMERCIAL', 'CPV', 'maxCpv', S, 'Slider', '—', 'CPV', 'BLOCKED BY DATA', 'rate ÷ views', '0% (butuh rate card)'],
  ['COMMERCIAL', 'CPE', 'maxCpe', S, 'Slider', '—', 'CPE', 'BLOCKED BY DATA', 'feature.ig/tt_audience_analysis.cpe', '0%'],
  ['COMMERCIAL', 'CPM', 'maxCpm', S, 'Slider', '—', 'CPM', 'BLOCKED BY DATA', 'rate ÷ followers × 1.000', '0%'],
  ['COMMERCIAL', 'Cost Efficiency', 'minCostEfficiency', S, 'Slider', '—', 'Cost Efficiency', 'BLOCKED BY DATA', 'CPE terhadap median roster', '0%'],
  ['COMMERCIAL', 'Estimated ROI', 'minRoi', S, 'Slider', '—', 'Estimated ROI', 'BLOCKED BY DATA', 'EMV ÷ rate', '0%'],

  ['INTELLIGENCE', 'Brand Match', 'minBrandMatch', S, 'Slider 0–100', 'min_brand_match', 'Final Match Score', 'NEW', '— didefinisikan workbook ini', 'n/a'],
  ['INTELLIGENCE', 'Brand Fit', 'minBrandFit', S, 'Slider 0–100', '—', 'Brand Fit Index', 'BLOCKED BY DATA', 'feature.brand_fit_analysis.partnership_score', '0 baris'],
  ['INTELLIGENCE', 'Opportunity Score', 'minOpportunity', S, 'Slider 0–100', '—', 'Opportunity Score', 'NEW', '— didefinisikan workbook ini', 'n/a'],
  ['INTELLIGENCE', 'Content Relevance', 'minContentRelevance', S, 'Slider 0–100', 'preferred_content_topics', 'Content & Category Relevance', 'NEW', 'butuh feature content-DNA', '0%'],
  ['INTELLIGENCE', 'Competitor Saturation', 'maxCompetitorSaturation', S, 'Slider 0–100', 'max_competitor_saturation', 'Competitor Saturation', 'BLOCKED BY DATA', '— tidak ada kolom competitor-saturation', '0%'],
  ['INTELLIGENCE', 'Brand Safety', 'minBrandSafety', H, 'Slider 0–100', 'min_brand_safety', 'Brand Safety Score', 'BLOCKED BY DATA', '— tidak ada kolom risk-level', '0%'],

  ['DISCOVERY', 'Newly Added', 'createdAfter', S, 'Section tab', '—', 'Added Date', 'DONE', 'kol_directory.created_at', '99,7%'],
  ['DISCOVERY', 'Recently Updated', 'refreshedAfter', S, 'Section tab', '—', 'Last Updated', 'DONE', 'kol_directory.last_refreshed_at', '97,1%'],
  ['DISCOVERY', 'Trending Creators', 'trending', S, 'Section tab', '—', 'Recent Performance + 30D Growth', 'BLOCKED BY DATA', 'kol_metric_monthly (deret)', '5 creator'],
  ['DISCOVERY', 'Rising Creators', 'rising', S, 'Section tab', '—', '30D + 90D Growth + ER', 'BLOCKED BY DATA', 'followers_growth (maks 0,917% vs rule ≥5,5%)', '25 creator'],
  ['DISCOVERY', 'Hidden Gems', 'hiddenGems', S, 'Section tab', '—', 'Hidden Gem Score', 'NEW', 'butuh ER + audience quality + saturation', 'parsial'],
  ['DISCOVERY', 'Most Relevant', 'mostRelevant', S, 'Section tab', 'seluruh Brand_Profile', 'Final Match Score × Confidence', 'NEW', '— didefinisikan workbook ini', 'n/a'],

  ['EXCLUSION', 'Already Selected', 'exclude_already_selected', H, 'Toggle', 'exclude_already_selected', 'Already Selected', 'DONE', 'discover_creator_links (migrasi 053)', '100% (state aplikasi)'],
  ['EXCLUSION', 'Already in Cart', 'exclude_in_cart', H, 'Toggle', 'exclude_in_cart', 'In Cart', 'DONE', 'discover cart (state aplikasi)', '100%'],
  ['EXCLUSION', 'Existing Partner', 'exclude_existing_partner', H, 'Toggle', 'exclude_existing_partner', 'Existing Partner', 'BLOCKED BY DATA', 'public.campaign_kols', '0 baris'],
  ['EXCLUSION', 'Excluded Creator', 'exclude_excluded_creator', H, 'Toggle', 'exclude_excluded_creator', 'Excluded Creator', 'NEW', '— belum ada daftar exclusion', '0%'],
  ['EXCLUSION', 'High Competitor Saturation', 'max_competitor_saturation', H, 'Slider (0 = off)', 'max_competitor_saturation', 'Competitor Saturation', 'BLOCKED BY DATA', '— tidak ada kolom', '0%'],
  ['EXCLUSION', 'Low Brand Safety', 'min_brand_safety', H, 'Slider', 'min_brand_safety', 'Brand Safety Score', 'BLOCKED BY DATA', '— tidak ada kolom', '0%'],
]

/**
 * The 30 ranking presets.
 *
 * `metric` names the column the preset orders by; `dir` says which end wins.
 * Every one of them resolves to a single cell per creator — the same discipline
 * `CREATOR_PRESETS` in `@/lib/discover/creatorMatch` follows, where a preset is
 * "a real filter plus a ranking" rather than a mood.
 *
 * `available` mirrors the prototype's own answer today: four of its eight chips
 * are disabled because the column behind them is empty, and a spec that quietly
 * promises thirty working presets would be repeating that mistake at scale.
 */
export const RANKING_PRESETS = [
  ['Best Match', 'Final Match Score', 'desc', 'NEW'],
  ['Highest Average Views', 'Average Views', 'desc', 'PARTIAL'],
  ['Highest Median Views', 'Median Views', 'desc', 'NEW'],
  ['Highest Engagement Quality', 'Engagement Quality Index', 'desc', 'PARTIAL'],
  ['Highest Share Rate', 'Share Rate', 'desc', 'PARTIAL'],
  ['Highest Save Rate', 'Save Rate', 'desc', 'PARTIAL'],
  ['Most Consistent', 'Consistency Score', 'desc', 'BLOCKED BY DATA'],
  ['Highest View-to-Follower Ratio', 'View-to-Follower Ratio', 'desc', 'PARTIAL'],
  ['Highest Recent Performance', 'Recent Performance', 'desc', 'BLOCKED BY DATA'],
  ['Highest 30D Growth', 'Growth sejak snapshot terakhir', 'desc', 'PARTIAL — 25 creator'],
  ['Highest 90D Growth', '90D Growth', 'desc', 'BLOCKED BY DATA'],
  ['Rising Creators', 'Rising Score', 'desc', 'BLOCKED BY DATA'],
  ['Highest Audience Quality', 'Audience Quality', 'desc', 'BLOCKED BY DATA'],
  ['Highest Audience Authenticity', 'Audience Authenticity', 'desc', 'BLOCKED BY DATA'],
  ['Best Audience Match', 'Target Audience Relevance', 'desc', 'NEW'],
  ['Strongest Community', 'Community Score', 'desc', 'BLOCKED BY DATA'],
  ['Lowest CPV', 'CPV', 'asc', 'BLOCKED BY DATA'],
  ['Lowest CPE', 'CPE', 'asc', 'BLOCKED BY DATA'],
  ['Lowest CPM', 'CPM', 'asc', 'BLOCKED BY DATA'],
  ['Best Cost Efficiency', 'Cost Efficiency', 'desc', 'BLOCKED BY DATA'],
  ['Best Estimated ROI', 'Estimated ROI', 'desc', 'BLOCKED BY DATA'],
  ['Highest Brand Fit', 'Brand Fit Index', 'desc', 'NEW'],
  ['Highest Opportunity', 'Opportunity Score', 'desc', 'NEW'],
  ['Lowest Competitor Saturation', 'Competitor Saturation', 'asc', 'BLOCKED BY DATA'],
  ['Highest Content Relevance', 'Content & Category Relevance', 'desc', 'NEW'],
  ['Newly Added', 'Added Date', 'desc', 'DONE'],
  ['Recently Updated', 'Last Updated', 'desc', 'DONE'],
  ['Trending Creators', 'Trending Score', 'desc', 'BLOCKED BY DATA'],
  ['Hidden Gems', 'Hidden Gem Score', 'desc', 'NEW'],
  ['Most Relevant', 'Relevance Score', 'desc', 'NEW'],
]
