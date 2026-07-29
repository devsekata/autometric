/**
 * Metric glossary — the text shown in the (i) tooltip next to every metric.
 *
 * Source of truth: docs/glosarium_metrik_autometric.md (v1.0, verified against
 * the live DB on 23 Jul 2026). Keep the two in sync: when the doc changes, change
 * the entry here.
 *
 * Canonical keys are `<gold_table>.<column>` because column names repeat across
 * tables (`post_count`, `likes_sum`, `reach_sum` …) and mean different things.
 * The UI never uses those keys directly — screens pass their own key and
 * `lookupMetric()` resolves it through METRIC_ALIASES.
 *
 * Dev-facing remarks from the doc (unit conversions, "don't average this
 * column", grain notes) are deliberately left out — they belong in the doc, not
 * in a tooltip aimed at the person reading the dashboard.
 */

export interface MetricEntry {
  /** Indonesian label suggested by the glossary. */
  label: string
  /** Plain-language explanation shown in the tooltip. */
  description: string
  /** Optional caveat rendered in a muted second line. */
  caveat?: string
}

/* ── §1 l2_gold.post_metric — per content ─────────────────────────────────── */

const POST_METRIC: Record<string, MetricEntry> = {
  'post_metric.likes': {
    label: 'Suka',
    description: 'Jumlah suka yang diterima konten ini.',
    caveat: 'Khusus Facebook, angka ini mencakup semua jenis reaksi (Like, Love, Haha, dan lainnya).',
  },
  'post_metric.comments': {
    label: 'Komentar',
    description: 'Jumlah komentar yang diterima konten ini.',
  },
  'post_metric.shares': {
    label: 'Dibagikan',
    description: 'Berapa kali konten ini dibagikan oleh pengguna.',
  },
  'post_metric.saves': {
    label: 'Disimpan',
    description: 'Berapa kali konten ini disimpan oleh pengguna.',
    caveat: 'Hanya tersedia untuk Instagram dan TikTok.',
  },
  'post_metric.reposts': {
    label: 'Repost',
    description: 'Berapa kali konten ini di-repost.',
    caveat: 'Hanya tersedia untuk Instagram.',
  },
  'post_metric.follows': {
    label: 'Follower dari Konten',
    description: 'Jumlah follower baru yang mulai mengikuti akun setelah melihat konten ini.',
    caveat: 'Saat ini hanya tersedia untuk Instagram.',
  },
  'post_metric.reach': {
    label: 'Jangkauan',
    description: 'Jumlah akun unik yang melihat konten ini.',
  },
  'post_metric.views': {
    label: 'Tayangan',
    description: 'Berapa kali konten ini ditonton atau dilihat.',
  },
  'post_metric.impressions': {
    label: 'Impresi',
    description: 'Berapa kali konten ini muncul di layar pengguna, termasuk tayangan berulang oleh orang yang sama.',
    caveat: 'Hanya tersedia untuk Facebook.',
  },
  'post_metric.followers_on_post_day': {
    label: 'Follower saat Tayang',
    description: 'Jumlah follower akun pada hari konten ini dipublikasikan. Dipakai sebagai pembanding performa antar konten.',
  },
  'post_metric.engagement_owned': {
    label: 'Total Interaksi',
    description: 'Total seluruh interaksi pada konten ini. Instagram: suka + komentar + bagikan + simpan + repost. TikTok: suka + komentar + bagikan + simpan. Facebook: reaksi + komentar + bagikan.',
  },
  'post_metric.engagement_public': {
    label: 'Interaksi Publik',
    description: 'Interaksi yang terlihat oleh publik. Instagram: suka + komentar. Facebook dan TikTok: sama dengan total interaksi.',
  },
  'post_metric.er_reach': {
    label: 'ER (Jangkauan)',
    description: 'Persentase orang yang berinteraksi dibanding jumlah akun yang melihat konten ini. Semakin tinggi, semakin efektif konten memancing interaksi.',
  },
  'post_metric.er_views': {
    label: 'ER (Tayangan)',
    description: 'Persentase interaksi dibanding jumlah tayangan konten ini.',
  },
  'post_metric.er_impressions': {
    label: 'ER (Impresi)',
    description: 'Persentase interaksi dibanding jumlah impresi konten ini.',
    caveat: 'Hanya relevan untuk Facebook.',
  },
  'post_metric.er_followers': {
    label: 'ER (Follower)',
    description: 'Persentase interaksi dibanding jumlah follower akun pada hari konten tayang.',
  },
  'post_metric.avg_watch_time': {
    label: 'Rata-rata Durasi Tonton',
    description: 'Rata-rata lamanya penonton menonton konten video ini.',
    caveat: 'Tersedia untuk Instagram Reels dan TikTok.',
  },
  'post_metric.duration_s': {
    label: 'Durasi',
    description: 'Panjang konten video dalam detik.',
  },
  'post_metric.completion_rate': {
    label: 'Tingkat Tonton Selesai',
    description: 'Persentase penonton yang menonton video ini sampai selesai.',
    caveat: 'Hanya tersedia untuk TikTok.',
  },
  'post_metric.reels_skip_rate': {
    label: 'Reels Skip Rate',
    description: 'Belum tersedia — sumber data dari platform belum menyediakan metrik ini.',
  },
  'post_metric.post_type': {
    label: 'Jenis Konten',
    description: 'Jenis konten yang dipublikasikan, misalnya foto, video, reels, atau carousel.',
  },
  'post_metric.content_pillar': {
    label: 'Pilar Konten',
    description: 'Kategori pilar konten. Dicocokkan otomatis dari hashtag yang dipakai konten.',
  },
  'post_metric.is_campaign': {
    label: 'Campaign',
    description: 'Menandai konten yang merupakan bagian dari sebuah campaign.',
  },
  'post_metric.is_boosted': {
    label: 'Beriklan',
    description: 'Menandai konten yang dipromosikan berbayar (boosted).',
  },
}

/* ── §2 l2_gold.brand_metric_daily — daily per channel ────────────────────── */

const BRAND_DAILY: Record<string, MetricEntry> = {
  'brand_metric_daily.post_count': {
    label: 'Jumlah Konten',
    description: 'Jumlah konten yang dipublikasikan pada periode ini.',
  },
  'brand_metric_daily.engagement_sum': {
    label: 'Total Interaksi',
    description: 'Total seluruh interaksi (suka, komentar, bagikan, simpan, repost) dari semua konten yang tayang pada periode ini.',
  },
  'brand_metric_daily.engagement_public_sum': {
    label: 'Interaksi Publik',
    description: 'Total interaksi yang terlihat publik dari semua konten yang tayang pada periode ini.',
  },
  'brand_metric_daily.likes_sum': {
    label: 'Suka',
    description: 'Total suka dari semua konten yang tayang pada periode ini.',
    caveat: 'Facebook: mencakup semua jenis reaksi.',
  },
  'brand_metric_daily.comments_sum': {
    label: 'Komentar',
    description: 'Total komentar dari semua konten yang tayang pada periode ini.',
  },
  'brand_metric_daily.shares_sum': {
    label: 'Dibagikan',
    description: 'Total berapa kali konten pada periode ini dibagikan.',
  },
  'brand_metric_daily.saves_sum': {
    label: 'Disimpan',
    description: 'Total berapa kali konten pada periode ini disimpan.',
  },
  'brand_metric_daily.reposts_sum': {
    label: 'Repost',
    description: 'Total repost dari konten pada periode ini.',
    caveat: 'Hanya Instagram.',
  },
  'brand_metric_daily.reach_sum': {
    label: 'Jangkauan',
    description: 'Total jangkauan dari semua konten yang tayang pada periode ini.',
    caveat: 'Penjumlahan antar konten bisa menghitung orang yang sama lebih dari sekali.',
  },
  'brand_metric_daily.views_sum': {
    label: 'Tayangan',
    description: 'Total tayangan dari semua konten yang tayang pada periode ini.',
  },
  'brand_metric_daily.impressions_sum': {
    label: 'Impresi',
    description: 'Total impresi dari semua konten yang tayang pada periode ini.',
    caveat: 'Hanya Facebook.',
  },
  'brand_metric_daily.er_reach_daily': {
    label: 'ER (Jangkauan)',
    description: 'Persentase interaksi dibanding jangkauan untuk konten yang tayang pada periode ini.',
    caveat: 'Untuk rentang beberapa hari, angka dihitung ulang dari total — bukan rata-rata angka harian.',
  },
  'brand_metric_daily.er_views_daily': {
    label: 'ER (Tayangan)',
    description: 'Persentase interaksi dibanding tayangan untuk konten yang tayang pada periode ini.',
  },
  'brand_metric_daily.er_impressions_daily': {
    label: 'ER (Impresi)',
    description: 'Persentase interaksi dibanding impresi untuk konten yang tayang pada periode ini.',
    caveat: 'Hanya Facebook.',
  },
  'brand_metric_daily.er_followers_daily': {
    label: 'ER (Follower)',
    description: 'Persentase interaksi dibanding jumlah follower saat konten tayang.',
  },
  'brand_metric_daily.follower_count_eod': {
    label: 'Total Follower',
    description: 'Jumlah follower akun pada akhir periode ini.',
  },
  'brand_metric_daily.new_followers_sum': {
    label: 'Follower Baru',
    description: 'Jumlah follower baru yang didapat pada periode ini.',
    caveat: 'Facebook dan TikTok; Instagram hanya menyediakan angka pertumbuhan bersih.',
  },
  'brand_metric_daily.lost_followers_sum': {
    label: 'Follower Hilang',
    description: 'Jumlah follower yang berhenti mengikuti pada periode ini.',
    caveat: 'Hanya tersedia untuk TikTok.',
  },
  'brand_metric_daily.net_growth_sum': {
    label: 'Pertumbuhan Bersih',
    description: 'Selisih follower baru dan follower yang hilang pada periode ini.',
  },
  'brand_metric_daily.profile_visit_sum': {
    label: 'Kunjungan Profil',
    description: 'Berapa kali profil akun dikunjungi pada periode ini.',
  },
  'brand_metric_daily.profile_reach_sum': {
    label: 'Jangkauan Profil',
    description: 'Jumlah akun yang terjangkau di tingkat profil pada periode ini.',
    caveat: 'Penjumlahan antar hari bisa menghitung orang yang sama lebih dari sekali.',
  },
  'brand_metric_daily.accounts_engaged_sum': {
    label: 'Akun Berinteraksi',
    description: 'Jumlah akun unik yang berinteraksi dengan akun ini pada periode ini.',
    caveat: 'Hanya tersedia untuk Instagram.',
  },
}

/* ── §3 Comments & community ──────────────────────────────────────────────── */

const COMMENTS: Record<string, MetricEntry> = {
  'comment_activity.comment_count': {
    label: 'Jumlah Komentar',
    description: 'Jumlah komentar yang masuk pada periode ini di semua konten.',
  },
  'comment_activity.likes_sum': {
    label: 'Suka pada Komentar',
    description: 'Total suka yang diterima komentar-komentar pada periode ini.',
  },
  'comment_activity.replies_sum': {
    label: 'Balasan Komentar',
    description: 'Total balasan yang diterima komentar-komentar pada periode ini.',
  },
  'comment_activity.hour_of_day': {
    label: 'Jam',
    description: 'Jam masuknya komentar dalam waktu Indonesia bagian barat (WIB), 0–23.',
  },
  'comment_sentiment.total_comments': {
    label: 'Komentar Dianalisis',
    description: 'Jumlah komentar yang dianalisis sentimennya pada periode ini.',
  },
  'comment_sentiment.positive_count': {
    label: 'Positif',
    description: 'Jumlah komentar bernada positif menurut analisis AI berbahasa Indonesia.',
  },
  'comment_sentiment.neutral_count': {
    label: 'Netral',
    description: 'Jumlah komentar bernada netral.',
  },
  'comment_sentiment.negative_count': {
    label: 'Negatif',
    description: 'Jumlah komentar bernada negatif.',
  },
  'comment_sentiment.dominant_sentiment': {
    label: 'Sentimen Dominan',
    description: 'Nada komentar yang paling banyak muncul pada konten ini (positif, netral, atau negatif).',
    caveat: 'Bila jumlahnya seri, positif diprioritaskan, lalu negatif.',
  },
  'comment_relevance.tier': {
    label: 'Tingkat Relevansi',
    description: 'Pengelompokan komentar berdasarkan seberapa relevan isinya dengan konten: Tinggi (skor di atas 75), Sedang (40–75), Rendah (di bawah 40). Skor dihitung otomatis oleh AI, skala 0–100.',
  },
  'comment_relevance.comment_count': {
    label: 'Jumlah Komentar',
    description: 'Jumlah komentar dalam kelompok relevansi ini.',
  },
  'community_contributors.comments_count': {
    label: 'Komentar',
    description: 'Jumlah komentar yang ditulis pengguna ini dalam periode terpilih.',
  },
  'community_contributors.likes_received': {
    label: 'Suka Diterima',
    description: 'Total suka yang diterima komentar-komentar pengguna ini.',
  },
  'community_contributors.replies_sum': {
    label: 'Balasan Diterima',
    description: 'Total balasan yang diterima komentar-komentar pengguna ini.',
  },
  'community_contributors.avg_relevance': {
    label: 'Rata-rata Relevansi',
    description: 'Rata-rata skor relevansi komentar pengguna ini terhadap konten brand (0–100).',
  },
  'community_contributors.composite_score': {
    label: 'Skor Kontributor',
    description: 'Skor gabungan 0–100: separuh dari tingkat keaktifan (dibandingkan komentator teraktif), separuh dari rata-rata relevansi komentarnya.',
  },
  'community_contributors.tier': {
    label: 'Kategori',
    description: 'Kategori kontributor berdasarkan skor: Super Fan (70 ke atas), Aktif (40–69), Kasual (di bawah 40).',
  },
  'community_contributors.rank_in_window': {
    label: 'Peringkat',
    description: 'Peringkat pengguna ini di antara seluruh kontributor pada periode terpilih.',
  },
  'post_comment_timeline.days_since_post': {
    label: 'Hari ke-',
    description: 'Jarak hari antara tanggal komentar dan tanggal konten dipublikasikan. Hari ke-0 berarti komentar masuk di hari yang sama dengan tayangnya konten.',
  },
  'post_wordcloud.word': {
    label: 'Kata Populer',
    description: 'Kata-kata yang paling sering muncul di komentar beserta jumlah kemunculannya. Teks dinormalisasi dan kata umum (stopword), emoji, serta angka murni dibuang.',
    caveat: 'Maksimum 50 kata teratas per konten.',
  },
}

/* ── §4 Pillars & content attributes ──────────────────────────────────────── */

const PILLARS: Record<string, MetricEntry> = {
  'pillar_performance_daily.post_count': {
    label: 'Jumlah Konten',
    description: 'Jumlah konten dengan pilar ini yang tayang pada periode ini.',
  },
  'pillar_performance_daily.engagement_sum': {
    label: 'Total Interaksi',
    description: 'Total interaksi dari konten pilar ini yang tayang pada periode ini.',
  },
  'pillar_performance_daily.reach_sum': {
    label: 'Jangkauan',
    description: 'Total jangkauan konten pilar ini pada periode ini.',
  },
  'pillar_performance_daily.views_sum': {
    label: 'Tayangan',
    description: 'Total tayangan konten pilar ini pada periode ini.',
  },
  'pillar_performance_daily.watch_time_sum': {
    label: 'Durasi Tonton per Pilar',
    description: 'Penjumlahan rata-rata durasi tonton tiap konten pada pilar ini.',
    caveat: 'Ini bukan total waktu tonton sesungguhnya — bagi dengan jumlah konten untuk mendapat rata-rata antar konten.',
  },
  'content_attribute_daily.content_tag': {
    label: 'Atribut Konten',
    description: 'Penanda jenis konten: beriklan (boosted), kolaborasi, campaign, event, aon, activity, repost, atau organik.',
    caveat: 'Satu konten bisa memiliki lebih dari satu atribut.',
  },
  'content_attribute_daily.post_count': {
    label: 'Jumlah Konten',
    description: 'Jumlah konten dengan atribut ini yang tayang pada periode ini.',
    caveat: 'Karena satu konten bisa punya beberapa atribut, angka antar-atribut tidak boleh dijumlahkan.',
  },
  'content_attribute_daily.engagement_sum': {
    label: 'Total Interaksi',
    description: 'Total interaksi dari konten dengan atribut ini pada periode ini.',
  },
  'dim_content_pillar.content_pillar': {
    label: 'Pilar Konten',
    description: 'Nama pilar atau kategori konten yang ditetapkan brand.',
  },
  'dim_content_pillar.hashtags': {
    label: 'Hashtag Pemicu',
    description: 'Daftar hashtag pemicu — konten yang memakai salah satu hashtag ini otomatis dikategorikan ke pilar ini.',
  },
}

/* ── §5 Stories (Instagram) ───────────────────────────────────────────────── */

const STORIES: Record<string, MetricEntry> = {
  'story_metric_daily.story_count': {
    label: 'Jumlah Story',
    description: 'Jumlah story yang tayang pada periode ini.',
  },
  'story_metric_daily.reach_sum': {
    label: 'Jangkauan Story',
    description: 'Total akun unik yang melihat story pada periode ini.',
  },
  'story_metric_daily.views_sum': {
    label: 'Tayangan Story',
    description: 'Total berapa kali story pada periode ini dilihat.',
  },
  'story_metric_daily.replies_sum': {
    label: 'Balasan',
    description: 'Jumlah balasan (DM) yang diterima story pada periode ini.',
  },
  'story_metric_daily.taps_fwd_sum': {
    label: 'Tap Maju',
    description: 'Berapa kali penonton mengetuk untuk melompat ke story berikutnya.',
    caveat: 'Angka tinggi bisa berarti story kurang menahan perhatian.',
  },
  'story_metric_daily.taps_back_sum': {
    label: 'Tap Mundur',
    description: 'Berapa kali penonton mengetuk untuk kembali menonton ulang story sebelumnya.',
    caveat: 'Angka tinggi biasanya pertanda konten menarik.',
  },
  'story_metric_daily.exits_sum': {
    label: 'Keluar',
    description: 'Berapa kali penonton keluar dari story sebelum selesai.',
  },
  'story_metric_daily.swipe_up_sum': {
    label: 'Buka Tautan',
    description: 'Berapa kali penonton membuka tautan yang dipasang di story.',
  },
  'story_metric_daily.follows_sum': {
    label: 'Follower dari Story',
    description: 'Jumlah follower baru yang datang setelah melihat story pada periode ini.',
  },
  'story_type_daily.story_type': {
    label: 'Tipe Story',
    description: 'Jenis story, misalnya foto atau video. Nilai "unknown" berarti tipe tidak terdeteksi dari sumber data.',
  },
}

/* ── §6 Followers & audience ──────────────────────────────────────────────── */

const AUDIENCE: Record<string, MetricEntry> = {
  'tiktok_churn_daily.new_followers': {
    label: 'Follower Baru',
    description: 'Jumlah follower baru TikTok pada periode ini.',
  },
  'tiktok_churn_daily.lost_followers': {
    label: 'Follower Hilang',
    description: 'Jumlah follower TikTok yang berhenti mengikuti pada periode ini.',
  },
  'tiktok_churn_daily.net_growth': {
    label: 'Pertumbuhan Bersih',
    description: 'Selisih follower baru dan follower yang hilang pada periode ini.',
  },
  'tiktok_churn_daily.video_views_sum': {
    label: 'Tayangan Video',
    description: 'Total tayangan video akun TikTok pada periode ini, diambil dari data tingkat profil.',
  },
  'audience_demographics_daily.age': {
    label: 'Kelompok Usia',
    description: 'Jumlah audiens pada tiap kelompok usia.',
  },
  'audience_demographics_daily.gender': {
    label: 'Gender',
    description: 'Jumlah audiens per gender. "Tidak diketahui" berarti platform tidak memiliki data gender pengguna tersebut.',
  },
  'audience_demographics_daily.audience_type': {
    label: 'Tipe Audiens',
    description: 'Jenis audiens yang diukur: demografi seluruh follower akun, atau demografi audiens yang berinteraksi dengan konten.',
  },
  'audience_geo_daily.geo': {
    label: 'Lokasi Audiens',
    description: 'Sebaran audiens per kota atau per negara.',
  },
  'audience_geo_daily.audience_count': {
    label: 'Jumlah Audiens',
    description: 'Jumlah audiens dari lokasi ini.',
  },
}

/* ── §7 Competitors ───────────────────────────────────────────────────────── */

const COMPETITOR: Record<string, MetricEntry> = {
  'competitor_post_metric.like_count': {
    label: 'Suka',
    description: 'Jumlah suka konten kompetitor.',
    caveat: 'Facebook: mencakup semua jenis reaksi.',
  },
  'competitor_post_metric.comment_count': {
    label: 'Komentar',
    description: 'Jumlah komentar konten kompetitor.',
    caveat: 'Tidak tersedia untuk Facebook.',
  },
  'competitor_post_metric.share_count': {
    label: 'Dibagikan',
    description: 'Berapa kali konten kompetitor dibagikan.',
    caveat: 'Tidak tersedia untuk Instagram.',
  },
  'competitor_post_metric.view_count': {
    label: 'Tayangan',
    description: 'Berapa kali konten kompetitor ditonton.',
    caveat: 'Tidak tersedia untuk Facebook.',
  },
  'competitor_post_metric.save_count': {
    label: 'Disimpan',
    description: 'Berapa kali konten kompetitor disimpan.',
    caveat: 'Hanya tersedia untuk TikTok.',
  },
  'competitor_profile_metric_daily.follower_count': {
    label: 'Follower Kompetitor',
    description: 'Jumlah follower akun kompetitor pada periode ini.',
  },
  'competitor_profile_metric_daily.following_count': {
    label: 'Mengikuti',
    description: 'Jumlah akun yang diikuti kompetitor.',
    caveat: 'Tidak tersedia untuk Facebook.',
  },
  'competitor_profile_metric_daily.followers_growth': {
    label: 'Pertumbuhan Follower',
    description: 'Perubahan jumlah follower kompetitor pada periode ini.',
  },
  'competitor_profile_metric_daily.post_count': {
    label: 'Konten Kompetitor',
    description: 'Jumlah konten yang dipublikasikan kompetitor pada periode ini.',
  },
  'ugc_tagged_posts.username': {
    label: 'Pengguna',
    description: 'Akun publik yang membuat konten dan menandai brand ini.',
    caveat: 'Saat ini hanya Instagram.',
  },
  'ugc_tagged_posts.total_engagement': {
    label: 'Total Interaksi UGC',
    description: 'Jumlah suka ditambah komentar pada konten buatan pengguna tersebut.',
  },
}

/* ── §8 Posting time ──────────────────────────────────────────────────────── */

const POSTING_TIME: Record<string, MetricEntry> = {
  'posting_time_heatmap.post_count': {
    label: 'Jumlah Konten',
    description: 'Jumlah konten yang pernah tayang pada kombinasi hari dan jam ini.',
    caveat: 'Dihitung sepanjang masa, tidak mengikuti filter periode.',
  },
  'posting_time_heatmap.engagement_sum': {
    label: 'Total Interaksi',
    description: 'Total interaksi dari konten yang tayang pada kombinasi hari dan jam ini — untuk melihat waktu posting yang paling efektif.',
    caveat: 'Dihitung sepanjang masa, tidak mengikuti filter periode.',
  },
  'posting_time_heatmap.reach_sum': {
    label: 'Jangkauan',
    description: 'Total jangkauan konten pada slot waktu ini.',
  },
  'posting_time_heatmap.views_sum': {
    label: 'Tayangan',
    description: 'Total tayangan konten pada slot waktu ini.',
  },
}

/* ── Derived metrics — shown in the UI but computed on the fly ────────────── */
/* These have no Gold column of their own, so their wording is written here in
   the same voice as the glossary rather than copied from it. */

const DERIVED: Record<string, MetricEntry> = {
  'derived.blended_er': {
    label: 'Blended Engagement Rate',
    description: 'Rata-rata gabungan tingkat interaksi seluruh channel pada periode terpilih. Dihitung ulang dari total interaksi dibagi total penyebut, bukan merata-ratakan angka harian.',
  },
  'derived.avg_saves_rate': {
    label: 'Rata-rata Saves Rate',
    description: 'Persentase konten yang disimpan dibanding jangkauannya. Menunjukkan seberapa sering konten dianggap layak disimpan untuk dilihat kembali.',
    caveat: 'Hanya Instagram — platform lain tidak menyediakan angka simpan.',
  },
  'derived.swipe_up_rate': {
    label: 'Swipe-Up Rate',
    description: 'Persentase penonton story yang membuka tautan yang dipasang, dibanding jumlah yang melihat story.',
  },
  'derived.exit_rate': {
    label: 'Exit Rate',
    description: 'Persentase penonton yang keluar dari story sebelum selesai, dibanding jumlah yang melihatnya. Semakin rendah semakin baik.',
  },
  'derived.avg_story_reach': {
    label: 'Rata-rata Jangkauan Story',
    description: 'Rata-rata jumlah akun unik yang melihat tiap story pada periode terpilih.',
  },
  'derived.likes_per_comment': {
    label: 'Rata-rata Suka per Komentar',
    description: 'Rata-rata jumlah suka yang diterima setiap komentar. Menunjukkan seberapa besar komentar ikut memancing interaksi lanjutan.',
  },
  'derived.replies_per_comment': {
    label: 'Rata-rata Balasan per Komentar',
    description: 'Rata-rata jumlah balasan yang diterima setiap komentar, termasuk balasan dari brand sendiri.',
  },
  'derived.comments_rate': {
    label: 'Comments Rate',
    description: 'Persentase komentar dibanding jangkauan konten. Menunjukkan seberapa besar konten memancing percakapan.',
  },
  'derived.total_comments_tracked': {
    label: 'Total Komentar Terlacak',
    description: 'Jumlah seluruh komentar yang berhasil ditarik dari semua channel pada periode terpilih.',
  },
  'derived.total_tracked_followers': {
    label: 'Total Follower Terlacak',
    description: 'Jumlah follower dari seluruh channel yang terhubung, dijumlahkan pada akhir periode terpilih.',
    caveat: 'Satu orang yang mengikuti beberapa channel terhitung lebih dari sekali.',
  },
  'derived.link_clicks_fb': {
    label: 'Klik Tautan',
    description: 'Berapa kali tautan pada konten diklik oleh pengguna.',
    caveat: 'Hanya tersedia untuk Facebook.',
  },
  'derived.profile_views': {
    label: 'Kunjungan Profil',
    description: 'Berapa kali halaman profil akun dibuka pada periode terpilih.',
  },
  'derived.impressions_views': {
    label: 'Impresi / Tayangan',
    description: 'Gabungan impresi dan tayangan dalam satu kolom: Facebook memakai impresi, Instagram dan TikTok memakai tayangan.',
  },
  'derived.er_pooled': {
    label: 'ER (Gabungan)',
    description: 'Tingkat interaksi yang dihitung dari total seluruh konten pada periode — total interaksi dibagi total penyebut.',
    caveat: 'Berbeda dari "Avg. ER" yang merata-ratakan ER tiap konten.',
  },
  'derived.er_avg': {
    label: 'Rata-rata ER',
    description: 'Rata-rata dari tingkat interaksi tiap konten pada periode terpilih.',
    caveat: 'Berbeda dari ER gabungan yang menghitung dari total.',
  },
  'derived.website_clicks': {
    label: 'Website Clicks',
    description: 'Berapa kali tautan yang dipasang di profil atau konten diklik oleh pengguna.',
    caveat: 'Hanya tersedia untuk Instagram dan Facebook.',
  },
  'derived.total_interactions_profile': {
    label: 'Total Interactions',
    description: 'Total interaksi di tingkat channel yang dilaporkan langsung oleh platform, mencakup interaksi di luar konten yang tayang pada periode ini.',
    caveat: 'Hanya tersedia untuk Instagram dan TikTok. Berbeda dari Engagement yang dijumlahkan dari konten.',
  },
  'derived.followers_growth_pct': {
    label: 'Pertumbuhan Follower (%)',
    description: 'Pertumbuhan bersih follower pada periode ini dinyatakan dalam persen terhadap jumlah follower di awal periode.',
  },
  'derived.avg_per_post': {
    label: 'Rata-rata per Konten',
    description: 'Nilai rata-rata metrik ini dibagi jumlah konten yang tayang pada periode terpilih.',
  },
}

export const METRIC_GLOSSARY: Record<string, MetricEntry> = {
  ...POST_METRIC,
  ...BRAND_DAILY,
  ...COMMENTS,
  ...PILLARS,
  ...STORIES,
  ...AUDIENCE,
  ...COMPETITOR,
  ...POSTING_TIME,
  ...DERIVED,
}

/**
 * Screen-specific keys → canonical glossary keys.
 *
 * Dashboard KPI keys (`s-swipe`, `tk-net`, …) and report metric ids (`avg_saved`,
 * `er_reach_pooled`, …) are UI identifiers, not Gold columns, so every one of
 * them is mapped explicitly here. An unmapped key simply renders no icon.
 *
 * Dashboard entries are prefixed `kpi:` because a few ids mean different things
 * on the two surfaces — the dashboard's `saves` is an average *rate*, the report's
 * `saves` is a raw count. `lookupMetric` tries the scoped key before the bare one.
 */
export const METRIC_ALIASES: Record<string, string> = {
  /* ── Dashboard: Overview ── */
  'kpi:reach':     'brand_metric_daily.reach_sum',
  'kpi:eng':       'brand_metric_daily.engagement_sum',
  'kpi:er':        'derived.blended_er',
  'kpi:views':     'tiktok_churn_daily.video_views_sum',
  'kpi:posts':     'brand_metric_daily.post_count',
  'kpi:foll':      'derived.total_tracked_followers',
  'kpi:followers': 'brand_metric_daily.follower_count_eod',
  'kpi:growth':    'brand_metric_daily.net_growth_sum',
  'kpi:impr':      'brand_metric_daily.impressions_sum',

  /* ── Dashboard: Content ── */
  'kpi:saves':  'derived.avg_saves_rate',
  'kpi:compl':  'post_metric.completion_rate',
  'kpi:clicks': 'derived.link_clicks_fb',

  /* ── Dashboard: Audience ── */
  'kpi:igr': 'brand_metric_daily.profile_reach_sum',
  'kpi:fbv': 'brand_metric_daily.profile_visit_sum',
  'kpi:tkv': 'derived.profile_views',

  /* ── Dashboard: Stories ── */
  'kpi:s-pub':   'story_metric_daily.story_count',
  'kpi:s-reach': 'derived.avg_story_reach',
  'kpi:s-swipe': 'derived.swipe_up_rate',
  'kpi:s-exit':  'derived.exit_rate',

  /* ── Dashboard: TikTok ── */
  'kpi:tk-new':   'tiktok_churn_daily.new_followers',
  'kpi:tk-lost':  'tiktok_churn_daily.lost_followers',
  'kpi:tk-net':   'tiktok_churn_daily.net_growth',
  'kpi:tk-views': 'tiktok_churn_daily.video_views_sum',
  'kpi:tk-compl': 'post_metric.completion_rate',

  /* ── Dashboard: Community ── */
  'kpi:c-total':    'derived.total_comments_tracked',
  'kpi:c-fbl':      'derived.likes_per_comment',
  'kpi:c-tkr':      'derived.likes_per_comment',
  'kpi:c-igr':      'derived.replies_per_comment',
  'kpi:c-comments': 'derived.comments_rate',

  /* ── Report: content-level metrics ── */
  likes:               'post_metric.likes',
  comments:            'post_metric.comments',
  shares:              'post_metric.shares',
  saved:               'post_metric.saves',
  saves:               'post_metric.saves',
  reposts:             'post_metric.reposts',
  reach:               'post_metric.reach',
  post_reach:          'post_metric.reach',
  eng_owned:           'post_metric.engagement_owned',
  engagement:          'post_metric.engagement_owned',
  total_interactions:  'post_metric.engagement_owned',
  eng_public:          'post_metric.engagement_public',
  impressions:         'post_metric.impressions',
  impressions_views:   'derived.impressions_views',
  video_views:         'brand_metric_daily.views_sum',
  new_follow:          'post_metric.follows',
  new_follow_content:  'post_metric.follows',
  watch_time:          'post_metric.avg_watch_time',
  video_watch_time:    'post_metric.avg_watch_time',
  post_view_time:      'post_metric.avg_watch_time',
  completion:          'post_metric.completion_rate',
  post_completion:     'post_metric.completion_rate',
  reels_skip_rate:     'post_metric.reels_skip_rate',
  er_reach:            'derived.er_avg',
  er_views:            'derived.er_avg',
  er_followers:        'derived.er_avg',
  er_impressions:      'post_metric.er_impressions',
  er_reach_pooled:     'derived.er_pooled',
  er_views_pooled:     'derived.er_pooled',
  er_followers_pooled: 'derived.er_pooled',

  /* ── Report: channel-level metrics ── */
  total_followers:      'brand_metric_daily.follower_count_eod',
  followers_net_growth: 'brand_metric_daily.net_growth_sum',
  followers_growth:     'brand_metric_daily.net_growth_sum',
  followers_growth_pct: 'derived.followers_growth_pct',
  new_follows:          'brand_metric_daily.new_followers_sum',
  new_followers:        'brand_metric_daily.new_followers_sum',
  unfollows:            'brand_metric_daily.lost_followers_sum',
  profile_reach:        'brand_metric_daily.profile_reach_sum',
  profile_views:        'derived.profile_views',
  visits:               'derived.profile_views',
  profile_visit:        'brand_metric_daily.profile_visit_sum',
  total_posts:          'brand_metric_daily.post_count',
  post_count:           'brand_metric_daily.post_count',
  number_of_posts:      'brand_metric_daily.post_count',

  views:     'brand_metric_daily.views_sum',

  /* ── Report: KPI picker (channel aggregates, see kpiQuery) ── */
  'rkpi:reach':              'brand_metric_daily.reach_sum',
  'rkpi:impressions':        'brand_metric_daily.impressions_sum',
  'rkpi:followers':          'brand_metric_daily.follower_count_eod',
  'rkpi:growth':             'brand_metric_daily.net_growth_sum',
  'rkpi:engagement':         'brand_metric_daily.engagement_sum',
  'rkpi:er':                 'derived.blended_er',
  'rkpi:likes':              'brand_metric_daily.likes_sum',
  'rkpi:comments':           'brand_metric_daily.comments_sum',
  'rkpi:saves':              'brand_metric_daily.saves_sum',
  'rkpi:shares':             'brand_metric_daily.shares_sum',
  'rkpi:reposts':            'brand_metric_daily.reposts_sum',
  'rkpi:views':              'brand_metric_daily.views_sum',
  'rkpi:visits':             'brand_metric_daily.profile_visit_sum',
  'rkpi:new_followers':      'brand_metric_daily.new_followers_sum',
  'rkpi:story_views':        'story_metric_daily.views_sum',
  'rkpi:story_reach':        'story_metric_daily.reach_sum',
  'rkpi:clicks':             'derived.website_clicks',
  'rkpi:total_interactions': 'derived.total_interactions_profile',
  'rkpi:watch_time':         'post_metric.avg_watch_time',

  /* ── Report: story & sentiment ── */
  story_reach: 'story_metric_daily.reach_sum',
  story_views: 'story_metric_daily.views_sum',
  positive:    'comment_sentiment.positive_count',
  neutral:     'comment_sentiment.neutral_count',
  negative:    'comment_sentiment.negative_count',
}

/** Report columns prefixed `avg_` share their base metric's meaning. */
const AVG_PREFIX = 'avg_'

function resolve(key: string): MetricEntry | undefined {
  return METRIC_GLOSSARY[key] ?? METRIC_GLOSSARY[METRIC_ALIASES[key]]
}

/**
 * Resolve any UI metric key to its glossary entry.
 *
 * `scope` disambiguates ids that exist on more than one surface — pass 'kpi' from
 * dashboard KPI cards. Returns undefined when the key has no entry, in which case
 * callers render no icon at all.
 */
export function lookupMetric(
  key: string | null | undefined,
  scope?: string,
): MetricEntry | undefined {
  if (!key) return undefined

  const direct = (scope && resolve(`${scope}:${key}`)) || resolve(key)
  if (direct) return direct

  // `avg_likes` → `likes`, described as the per-post average of that metric.
  if (key.startsWith(AVG_PREFIX)) {
    const base = lookupMetric(key.slice(AVG_PREFIX.length), scope)
    if (base) {
      return {
        label: `Rata-rata ${base.label}`,
        description: `${base.description} Ditampilkan sebagai rata-rata per konten pada periode terpilih.`,
        caveat: base.caveat,
      }
    }
  }

  return undefined
}
