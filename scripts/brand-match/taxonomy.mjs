/**
 * The taxonomy: the tree of labels the Brand Match engine and Discovery both
 * classify against, and the crosswalk that joins the brand half to the creator
 * half.
 *
 * This file imports nothing from the workbook on purpose. It is the bottom
 * layer — `vocabulary.mjs` derives CATEGORIES, SUBCATS, INDUSTRIES and NICHES
 * from it so the workbook cannot hold two lists of the same thing, which is
 * the failure this taxonomy exists to end. Today the product holds three: 28 rows in `kol_categories`,
 * 7 hard-coded names in `@/lib/discover/vocab`, and 14 in the workbook, with
 * only four names in common and no mapping between them
 * (`discovery-filter-audit.md:349`, `discovery-ui-audit.md:428`).
 *
 * Three rules shape everything below.
 *
 *   1. THREE AXES, NOT ONE. A label answers exactly one question — what the
 *      creator makes (content), who watches (audience), or how it is shot
 *      (format). `kol_categories` mixes them: "Moms" and "Gen Z" are audiences
 *      sitting in a content column. That is part of why 90,9% of categorised
 *      creators collapse into Lifestyle + Beauty and why the category chip
 *      barely narrows anything. Only the content axis may feed the Category and
 *      Sub Category ladders.
 *
 *   2. EVERY NODE CARRIES ITS OWN KEYWORDS, in Indonesian and English. They are
 *      not decoration: they are what classifies the 3.547 creators who have no
 *      category at all, and what `Keyword Match` searches. A node nobody can
 *      write a keyword for is a node that will never be populated.
 *
 *   3. THE CROSSWALK IS DERIVED, AND OVERRIDES ARE VISIBLE AS OVERRIDES. A
 *      niche scores a sub category through the Industry × Category matrix
 *      already on Lookup_Lists; the lists below only sharpen it where a human
 *      says "this niche means exactly this sub category". The Taxonomy sheet
 *      prints the derived default beside the override so the two can be told
 *      apart.
 *
 * Codes are namespaced by parent, so `FIT.HOM` (Home Workout) and `HNL`
 * (Home & Living) never collide. They are stable: labels get retranslated,
 * codes do not, and the codes are what a migration would key on.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * What `npm run taxonomy:fetch` last read off the KOL server, if it has ever
 * run here. Absent is the normal state away from the office VPN, and the sheet
 * says so rather than filling the gap with plausible names.
 */
const SNAPSHOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'kol-categories.json')

export function dbCategorySnapshot() {
  if (!existsSync(SNAPSHOT)) return null
  const raw = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
  return { measuredAt: raw.measuredAt, roster: raw.roster, uncategorised: raw.uncategorised, rows: raw.rows }
}

/* ── the three axes ───────────────────────────────────────────────────────── */

/** axis, question it answers, what belongs to it, where it is stored */
export const AXES = [
  ['CONTENT', 'What does the creator make?',
    'Category → Sub Category → Content Topic. The only axis the Category Match and Sub Category Match ladders are allowed to read.',
    'kol_directory.category_ids → public.kol_categories (L1 only, today)'],
  ['AUDIENCE', 'Who watches?',
    'Age band, gender majority, geography, audience interest. A different question with its own weight — Target Audience Relevance is 30% of the score against Content & Category Relevance at 20%.',
    'audience_demographics_daily, audience_geo_daily, audience_interest_daily'],
  ['FORMAT', 'How is it made?',
    'Content Style and Communication Style. Already a separate vocabulary with its own matrices (8, 8b, 9); named here so nobody files it back under Category.',
    '— no column; modelled on KOL_Database today'],
]

/* ── creator taxonomy: Category → Sub Category → Content Topic ────────────── */

/**
 * L1 order is the order the Industry × Category matrix is written in. Changing
 * it silently transposes matrix 5, so append rather than reorder.
 */
export const TAXONOMY = [
  {
    code: 'BEA', label: 'Beauty', labelId: 'Kecantikan',
    kw: ['beauty', 'kecantikan', 'cantik', 'glowing', 'mua'],
    subs: [
      { code: 'SKN', label: 'Skincare', labelId: 'Perawatan Kulit',
        kw: ['skincare', 'perawatan kulit', 'serum', 'moisturizer', 'sunscreen', 'jerawat', 'acne'],
        topics: [
          { code: 'ROUT', label: 'Skincare Routine', labelId: 'Rutinitas Skincare', kw: ['morning routine', 'night routine', 'urutan skincare', 'layering'] },
          { code: 'ACNE', label: 'Acne & Treatment', labelId: 'Jerawat & Perawatan', kw: ['jerawat', 'acne', 'bruntusan', 'purging', 'dermatologist'] },
          { code: 'SUNS', label: 'Sunscreen & Barrier', labelId: 'Sunscreen & Skin Barrier', kw: ['sunscreen', 'spf', 'skin barrier', 'ceramide'] },
        ] },
      { code: 'MKP', label: 'Makeup', labelId: 'Riasan',
        kw: ['makeup', 'riasan', 'mua', 'lipstik', 'foundation', 'eyeshadow', 'cushion'],
        topics: [
          { code: 'TUTO', label: 'Makeup Tutorial', labelId: 'Tutorial Makeup', kw: ['tutorial makeup', 'makeup look', 'daily makeup'] },
          { code: 'SWAT', label: 'Product Swatch & Review', labelId: 'Swatch & Review Produk', kw: ['swatch', 'review lipstik', 'shade', 'first impression'] },
          { code: 'OCCA', label: 'Occasion Makeup', labelId: 'Makeup Acara', kw: ['makeup wisuda', 'makeup pengantin', 'makeup kondangan', 'bridal'] },
        ] },
      { code: 'HAR', label: 'Haircare', labelId: 'Perawatan Rambut',
        kw: ['haircare', 'rambut', 'sampo', 'shampoo', 'hairstyling', 'salon'],
        topics: [
          { code: 'TREA', label: 'Hair Treatment', labelId: 'Perawatan Rambut', kw: ['hair mask', 'rambut rontok', 'ketombe', 'smoothing'] },
          { code: 'STYL', label: 'Hairstyling', labelId: 'Penataan Rambut', kw: ['hairstyle', 'catok', 'kepang', 'hair color'] },
        ] },
    ],
  },
  {
    code: 'FAS', label: 'Fashion', labelId: 'Mode',
    kw: ['fashion', 'gaya', 'outfit', 'ootd', 'busana'],
    subs: [
      { code: 'STR', label: 'Streetwear', labelId: 'Streetwear',
        kw: ['streetwear', 'sneakers', 'oversized', 'thrift', 'kaos'],
        topics: [
          { code: 'SNKR', label: 'Sneakers & Footwear', labelId: 'Sepatu & Sneakers', kw: ['sneakers', 'sepatu', 'unboxing sepatu', 'colorway'] },
          { code: 'THRF', label: 'Thrift & Preloved', labelId: 'Thrift & Preloved', kw: ['thrift', 'preloved', 'thrifting', 'barang second'] },
        ] },
      { code: 'HJB', label: 'Hijab Fashion', labelId: 'Fashion Hijab',
        kw: ['hijab', 'hijabers', 'muslimah', 'modest', 'kerudung', 'syari'],
        topics: [
          { code: 'STYL', label: 'Hijab Styling', labelId: 'Tutorial Hijab', kw: ['tutorial hijab', 'pashmina', 'hijab segi empat'] },
          { code: 'OCCA', label: 'Modest Occasion Wear', labelId: 'Busana Acara Muslimah', kw: ['gamis', 'kondangan', 'lebaran', 'baju raya'] },
        ] },
      { code: 'LOC', label: 'Local Brand', labelId: 'Brand Lokal',
        kw: ['local brand', 'brand lokal', 'umkm', 'produk lokal', 'karya anak bangsa'],
        topics: [
          { code: 'HAUL', label: 'Local Brand Haul', labelId: 'Haul Brand Lokal', kw: ['haul', 'checkout', 'racun belanja', 'brand lokal'] },
          { code: 'DSGN', label: 'Local Designer', labelId: 'Desainer Lokal', kw: ['desainer', 'koleksi', 'runway', 'capsule'] },
        ] },
    ],
  },
  {
    code: 'FOD', label: 'Food', labelId: 'Makanan',
    kw: ['food', 'kuliner', 'makanan', 'jajan', 'resep', 'foodie'],
    subs: [
      { code: 'CUL', label: 'Culinary Review', labelId: 'Review Kuliner',
        kw: ['kuliner', 'review makanan', 'food review', 'jajanan', 'warung'],
        topics: [
          { code: 'STRE', label: 'Street Food', labelId: 'Jajanan Kaki Lima', kw: ['kaki lima', 'street food', 'jajanan', 'gerobak'] },
          { code: 'REST', label: 'Restaurant Review', labelId: 'Review Restoran', kw: ['restoran', 'all you can eat', 'fine dining', 'menu baru'] },
          { code: 'MUKB', label: 'Mukbang', labelId: 'Mukbang', kw: ['mukbang', 'makan besar', 'asmr makan'] },
        ] },
      { code: 'HCK', label: 'Home Cooking', labelId: 'Masak Rumahan',
        kw: ['resep', 'masak', 'cooking', 'dapur', 'masakan rumahan'],
        topics: [
          { code: 'DAIL', label: 'Everyday Recipe', labelId: 'Resep Harian', kw: ['resep praktis', 'menu harian', 'bekal', 'anak kos'] },
          { code: 'BAKE', label: 'Baking & Dessert', labelId: 'Kue & Dessert', kw: ['baking', 'kue', 'dessert', 'roti'] },
        ] },
      { code: 'BEV', label: 'Coffee & Beverage', labelId: 'Kopi & Minuman',
        kw: ['kopi', 'coffee', 'minuman', 'cafe', 'barista', 'boba'],
        topics: [
          { code: 'BREW', label: 'Coffee Brewing', labelId: 'Seduh Kopi', kw: ['manual brew', 'espresso', 'v60', 'biji kopi'] },
          { code: 'CAFE', label: 'Cafe Hopping', labelId: 'Cafe Hopping', kw: ['cafe', 'coffee shop', 'nongkrong', 'aesthetic cafe'] },
        ] },
    ],
  },
  {
    code: 'FIT', label: 'Fitness', labelId: 'Kebugaran',
    kw: ['fitness', 'olahraga', 'workout', 'sehat', 'gym', 'diet'],
    subs: [
      { code: 'HOM', label: 'Home Workout', labelId: 'Olahraga di Rumah',
        kw: ['home workout', 'olahraga di rumah', 'senam', 'pilates', 'yoga'],
        topics: [
          { code: 'BODY', label: 'Bodyweight Routine', labelId: 'Latihan Tanpa Alat', kw: ['tanpa alat', 'bodyweight', 'hiit', 'plank'] },
          { code: 'YOGA', label: 'Yoga & Pilates', labelId: 'Yoga & Pilates', kw: ['yoga', 'pilates', 'stretching', 'peregangan'] },
        ] },
      { code: 'GYM', label: 'Gym & Strength', labelId: 'Gym & Latihan Beban',
        kw: ['gym', 'angkat beban', 'strength', 'fitness center', 'bulking'],
        topics: [
          { code: 'PROG', label: 'Strength Program', labelId: 'Program Latihan', kw: ['program latihan', 'push pull legs', 'progressive overload'] },
          { code: 'NUTR', label: 'Supplement & Nutrition', labelId: 'Suplemen & Nutrisi', kw: ['whey', 'protein', 'suplemen', 'defisit kalori'] },
        ] },
      { code: 'RUN', label: 'Running', labelId: 'Lari',
        kw: ['lari', 'running', 'marathon', 'sepatu lari'],
        topics: [
          { code: 'RACE', label: 'Race & Event', labelId: 'Lomba & Event Lari', kw: ['race', 'marathon', 'fun run', 'finish time'] },
          { code: 'GEAR', label: 'Running Gear', labelId: 'Perlengkapan Lari', kw: ['sepatu lari', 'gear lari', 'jam lari'] },
        ] },
    ],
  },
  {
    code: 'TEC', label: 'Tech', labelId: 'Teknologi',
    kw: ['tech', 'teknologi', 'gadget', 'digital'],
    subs: [
      { code: 'GDG', label: 'Gadget Review', labelId: 'Review Gadget',
        kw: ['gadget', 'review hp', 'smartphone', 'unboxing', 'spesifikasi'],
        topics: [
          { code: 'PHON', label: 'Smartphone Review', labelId: 'Review Ponsel', kw: ['hp baru', 'kamera hp', 'benchmark', 'flagship'] },
          { code: 'WEAR', label: 'Audio & Wearable', labelId: 'Audio & Wearable', kw: ['tws', 'earbuds', 'smartwatch', 'headphone'] },
        ] },
      { code: 'SAAS', label: 'Software & SaaS', labelId: 'Software & SaaS',
        kw: ['software', 'aplikasi', 'saas', 'tools', 'no-code'],
        topics: [
          { code: 'BIZ', label: 'Business Software', labelId: 'Software Bisnis', kw: ['crm', 'erp', 'invoice', 'aplikasi kasir'] },
          { code: 'DEV', label: 'Developer Tools', labelId: 'Tools Developer', kw: ['coding', 'developer', 'api', 'github'] },
        ] },
      { code: 'AIP', label: 'AI & Productivity', labelId: 'AI & Produktivitas',
        kw: ['ai', 'kecerdasan buatan', 'chatgpt', 'produktivitas', 'automation'],
        topics: [
          { code: 'TOOL', label: 'AI Tools', labelId: 'Tools AI', kw: ['prompt', 'ai tools', 'generatif', 'copilot'] },
          { code: 'FLOW', label: 'Workflow & Automation', labelId: 'Alur Kerja & Otomasi', kw: ['otomatisasi', 'workflow', 'notion', 'spreadsheet'] },
        ] },
    ],
  },
  {
    code: 'FIN', label: 'Finance', labelId: 'Keuangan',
    kw: ['finance', 'keuangan', 'uang', 'cuan', 'finansial'],
    subs: [
      { code: 'PFN', label: 'Personal Finance', labelId: 'Keuangan Pribadi',
        kw: ['keuangan pribadi', 'budgeting', 'menabung', 'dana darurat', 'gaji'],
        topics: [
          { code: 'BUDG', label: 'Budgeting & Saving', labelId: 'Atur Anggaran & Menabung', kw: ['budgeting', 'catat pengeluaran', 'dana darurat'] },
          { code: 'DEBT', label: 'Debt & Credit', labelId: 'Utang & Kredit', kw: ['utang', 'paylater', 'kartu kredit', 'pinjol'] },
        ] },
      { code: 'INV', label: 'Investing', labelId: 'Investasi',
        kw: ['investasi', 'saham', 'reksadana', 'crypto', 'portofolio'],
        topics: [
          { code: 'STCK', label: 'Stock & Mutual Fund', labelId: 'Saham & Reksadana', kw: ['saham', 'reksadana', 'ihsg', 'dividen'] },
          { code: 'CRYP', label: 'Crypto & Digital Asset', labelId: 'Kripto & Aset Digital', kw: ['crypto', 'bitcoin', 'kripto', 'blockchain'] },
        ] },
      { code: 'BIZ', label: 'Business', labelId: 'Bisnis',
        kw: ['bisnis', 'usaha', 'umkm', 'entrepreneur', 'startup'],
        topics: [
          { code: 'SME', label: 'SME & Entrepreneurship', labelId: 'UMKM & Wirausaha', kw: ['umkm', 'jualan', 'modal usaha', 'reseller'] },
          { code: 'STUP', label: 'Startup & Funding', labelId: 'Startup & Pendanaan', kw: ['startup', 'funding', 'pitch deck', 'valuasi'] },
        ] },
    ],
  },
  {
    code: 'EDU', label: 'Education', labelId: 'Edukasi',
    kw: ['edukasi', 'belajar', 'pendidikan', 'kelas', 'kuliah'],
    subs: [
      { code: 'STU', label: 'Study Tips', labelId: 'Tips Belajar',
        kw: ['study tips', 'utbk', 'snbt', 'sekolah', 'ujian'],
        topics: [
          { code: 'EXAM', label: 'Exam Preparation', labelId: 'Persiapan Ujian', kw: ['utbk', 'snbt', 'try out', 'ujian'] },
          { code: 'METH', label: 'Study Method', labelId: 'Metode Belajar', kw: ['pomodoro', 'catatan', 'study with me', 'mind map'] },
        ] },
      { code: 'LNG', label: 'Language', labelId: 'Bahasa',
        kw: ['bahasa', 'english', 'ielts', 'toefl', 'grammar'],
        topics: [
          { code: 'ENGL', label: 'English Learning', labelId: 'Belajar Bahasa Inggris', kw: ['english', 'grammar', 'speaking', 'vocabulary'] },
          { code: 'OTHR', label: 'Other Languages', labelId: 'Bahasa Lain', kw: ['bahasa jepang', 'bahasa korea', 'mandarin'] },
        ] },
      { code: 'CAR', label: 'Career', labelId: 'Karier',
        kw: ['karier', 'karir', 'interview', 'lowongan', 'fresh graduate'],
        topics: [
          { code: 'HUNT', label: 'Job Hunting & CV', labelId: 'Cari Kerja & CV', kw: ['cv', 'lamaran', 'interview', 'loker'] },
          { code: 'SKIL', label: 'Skill & Certification', labelId: 'Skill & Sertifikasi', kw: ['sertifikasi', 'kursus', 'upskilling', 'bootcamp'] },
        ] },
    ],
  },
  {
    code: 'LIF', label: 'Lifestyle', labelId: 'Gaya Hidup',
    kw: ['lifestyle', 'gaya hidup', 'keseharian', 'daily'],
    subs: [
      { code: 'VLG', label: 'Daily Vlog', labelId: 'Vlog Harian',
        kw: ['vlog', 'daily vlog', 'keseharian', 'day in my life'],
        topics: [
          { code: 'DAY', label: 'Day in the Life', labelId: 'Sehari Bersama', kw: ['day in my life', 'morning routine', 'night routine'] },
          { code: 'WKND', label: 'Weekend & Hangout', labelId: 'Akhir Pekan & Nongkrong', kw: ['weekend', 'nongkrong', 'hangout', 'me time'] },
        ] },
      { code: 'SLF', label: 'Self Improvement', labelId: 'Pengembangan Diri',
        kw: ['self improvement', 'motivasi', 'produktif', 'mindset', 'journaling'],
        topics: [
          { code: 'HABT', label: 'Habit & Routine', labelId: 'Kebiasaan & Rutinitas', kw: ['habit', 'rutinitas', 'konsisten', 'journaling'] },
          { code: 'MIND', label: 'Mindset & Motivation', labelId: 'Mindset & Motivasi', kw: ['mindset', 'motivasi', 'overthinking', 'healing'] },
        ] },
      { code: 'MIN', label: 'Minimalism', labelId: 'Minimalis',
        kw: ['minimalis', 'decluttering', 'hidup sederhana', 'slow living'],
        topics: [
          { code: 'DECL', label: 'Decluttering', labelId: 'Beberes & Kurangi Barang', kw: ['decluttering', 'buang barang', 'capsule wardrobe'] },
          { code: 'SLOW', label: 'Slow Living', labelId: 'Slow Living', kw: ['slow living', 'mindful', 'hidup sederhana'] },
        ] },
    ],
  },
  {
    code: 'TRV', label: 'Travel', labelId: 'Wisata',
    kw: ['travel', 'jalan-jalan', 'wisata', 'liburan', 'trip'],
    subs: [
      { code: 'DOM', label: 'Domestic Travel', labelId: 'Wisata Domestik',
        kw: ['wisata lokal', 'destinasi', 'pantai', 'gunung', 'explore indonesia'],
        topics: [
          { code: 'NATR', label: 'Nature & Outdoor', labelId: 'Alam & Luar Ruang', kw: ['pantai', 'gunung', 'air terjun', 'camping'] },
          { code: 'CITY', label: 'City & Culture', labelId: 'Kota & Budaya', kw: ['kota tua', 'museum', 'budaya', 'heritage'] },
        ] },
      { code: 'BGT', label: 'Budget Travel', labelId: 'Wisata Hemat',
        kw: ['budget travel', 'hemat', 'backpacker', 'itinerary murah'],
        topics: [
          { code: 'BPCK', label: 'Backpacking', labelId: 'Backpacking', kw: ['backpacker', 'hostel', 'open trip'] },
          { code: 'ITIN', label: 'Itinerary & Tips', labelId: 'Itinerary & Tips', kw: ['itinerary', 'tips liburan', 'tiket murah', 'promo'] },
        ] },
      { code: 'STY', label: 'Staycation & Hotel', labelId: 'Staycation & Hotel',
        kw: ['staycation', 'hotel', 'resort', 'review hotel', 'penginapan', 'villa'],
        topics: [
          { code: 'REVW', label: 'Hotel Review', labelId: 'Review Hotel', kw: ['review hotel', 'room tour', 'breakfast', 'rooftop'] },
          { code: 'FAM', label: 'Family Staycation', labelId: 'Staycation Keluarga', kw: ['staycation keluarga', 'kolam anak', 'family room'] },
        ] },
    ],
  },
  {
    code: 'PAR', label: 'Parenting', labelId: 'Pengasuhan',
    kw: ['parenting', 'ibu', 'anak', 'keluarga', 'bunda'],
    subs: [
      { code: 'MOM', label: 'Momlife', labelId: 'Kehidupan Ibu',
        kw: ['momlife', 'ibu rumah tangga', 'moms', 'bunda', 'working mom'],
        topics: [
          { code: 'DAIL', label: 'Daily Momlife', labelId: 'Keseharian Ibu', kw: ['momlife', 'drama ibu', 'me time ibu'] },
          { code: 'PROD', label: 'Mom Product Review', labelId: 'Review Produk Ibu', kw: ['review produk anak', 'rekomendasi ibu', 'stroller'] },
        ] },
      { code: 'KID', label: 'Kids & Family', labelId: 'Anak & Keluarga',
        kw: ['anak', 'keluarga', 'mainan', 'sekolah anak'],
        topics: [
          { code: 'ACTV', label: 'Kids Activity', labelId: 'Aktivitas Anak', kw: ['mainan', 'aktivitas anak', 'montessori', 'playdate'] },
          { code: 'TRIP', label: 'Family Trip & Routine', labelId: 'Jalan & Rutinitas Keluarga', kw: ['liburan keluarga', 'rutinitas keluarga'] },
        ] },
      { code: 'PRG', label: 'Pregnancy & Newborn', labelId: 'Kehamilan & Bayi',
        kw: ['hamil', 'kehamilan', 'newborn', 'bayi', 'mpasi', 'menyusui'],
        topics: [
          { code: 'JRNY', label: 'Pregnancy Journey', labelId: 'Perjalanan Kehamilan', kw: ['trimester', 'usg', 'persiapan lahiran'] },
          { code: 'CARE', label: 'Newborn Care & MPASI', labelId: 'Perawatan Bayi & MPASI', kw: ['mpasi', 'asi', 'popok', 'newborn'] },
        ] },
    ],
  },
  {
    code: 'ENT', label: 'Entertainment', labelId: 'Hiburan',
    kw: ['hiburan', 'entertainment', 'viral'],
    subs: [
      { code: 'COM', label: 'Comedy', labelId: 'Komedi',
        kw: ['komedi', 'lucu', 'humor', 'skit', 'prank', 'receh'],
        topics: [
          { code: 'SKIT', label: 'Sketch & Skit', labelId: 'Sketsa & Skit', kw: ['skit', 'sketsa', 'parodi', 'relate'] },
          { code: 'REAC', label: 'Reaction & Commentary', labelId: 'Reaksi & Komentar', kw: ['reaction', 'komentar', 'review lucu'] },
        ] },
      { code: 'MUS', label: 'Music', labelId: 'Musik',
        kw: ['musik', 'music', 'cover lagu', 'nyanyi', 'band'],
        topics: [
          { code: 'COVR', label: 'Cover & Performance', labelId: 'Cover & Penampilan', kw: ['cover lagu', 'akustik', 'live session', 'busking'] },
          { code: 'REVW', label: 'Music Review', labelId: 'Ulasan Musik', kw: ['review album', 'rekomendasi lagu', 'playlist'] },
        ] },
      { code: 'FLM', label: 'Film & Series', labelId: 'Film & Serial',
        kw: ['film', 'series', 'drakor', 'bioskop', 'rekomendasi film'],
        topics: [
          { code: 'REVW', label: 'Film & Series Review', labelId: 'Ulasan Film & Serial', kw: ['review film', 'spoiler', 'ending', 'drakor'] },
          { code: 'RECO', label: 'Recommendation List', labelId: 'Daftar Rekomendasi', kw: ['rekomendasi film', 'wajib tonton', 'netflix'] },
        ] },
    ],
  },
  {
    code: 'GAM', label: 'Gaming', labelId: 'Gim',
    kw: ['gaming', 'game', 'gamer', 'main game'],
    subs: [
      { code: 'MOB', label: 'Mobile Gaming', labelId: 'Gim Mobile',
        kw: ['mobile legends', 'free fire', 'pubg', 'mobile game'],
        topics: [
          { code: 'PLAY', label: 'Gameplay & Highlight', labelId: 'Gameplay & Cuplikan', kw: ['gameplay', 'highlight', 'push rank', 'savage'] },
          { code: 'META', label: 'Tips & Meta', labelId: 'Tips & Meta', kw: ['build', 'meta', 'tier list', 'tips main'] },
        ] },
      { code: 'PCC', label: 'PC & Console', labelId: 'PC & Konsol',
        kw: ['konsol', 'console', 'steam', 'playstation', 'rakit pc'],
        topics: [
          { code: 'BULD', label: 'PC Build & Setup', labelId: 'Rakit PC & Setup', kw: ['rakit pc', 'setup gaming', 'gpu', 'peripheral'] },
          { code: 'PLAY', label: 'Console Gameplay', labelId: 'Gameplay Konsol', kw: ['playthrough', 'walkthrough', 'ps5', 'nintendo'] },
        ] },
      { code: 'ESP', label: 'Esports', labelId: 'Esports',
        kw: ['esports', 'turnamen', 'tournament', 'pro player'],
        topics: [
          { code: 'TOUR', label: 'Tournament & Team', labelId: 'Turnamen & Tim', kw: ['turnamen', 'roster', 'grand final', 'liga'] },
          { code: 'PRO', label: 'Pro Player Content', labelId: 'Konten Pro Player', kw: ['pro player', 'scrim', 'analisis pertandingan'] },
        ] },
    ],
  },
  {
    code: 'AUT', label: 'Automotive', labelId: 'Otomotif',
    kw: ['otomotif', 'automotive', 'kendaraan', 'mesin'],
    subs: [
      { code: 'MTR', label: 'Motorcycle', labelId: 'Motor',
        kw: ['motor', 'motorcycle', 'moge', 'matic', 'touring motor'],
        topics: [
          { code: 'REVW', label: 'Motorcycle Review', labelId: 'Review Motor', kw: ['review motor', 'test ride', 'konsumsi bbm'] },
          { code: 'RIDE', label: 'Riding & Touring', labelId: 'Riding & Touring', kw: ['touring', 'safety riding', 'komunitas motor'] },
        ] },
      { code: 'CAR', label: 'Car Review', labelId: 'Review Mobil',
        kw: ['mobil', 'test drive', 'review mobil'],
        topics: [
          { code: 'TEST', label: 'Car Review & Test Drive', labelId: 'Review & Test Drive', kw: ['test drive', 'review mobil', 'interior mobil'] },
          { code: 'EV', label: 'EV & New Energy', labelId: 'Mobil Listrik', kw: ['mobil listrik', 'ev', 'hybrid', 'charging'] },
        ] },
      { code: 'MOD', label: 'Modification & Aftermarket', labelId: 'Modifikasi & Aftermarket',
        kw: ['modifikasi', 'modif', 'velg', 'aftermarket', 'restorasi'],
        topics: [
          { code: 'BULD', label: 'Modification Build', labelId: 'Proyek Modifikasi', kw: ['build', 'modif', 'restorasi', 'custom'] },
          { code: 'PART', label: 'Parts & Accessories', labelId: 'Sparepart & Aksesori', kw: ['sparepart', 'velg', 'knalpot', 'aksesori'] },
        ] },
    ],
  },
  {
    code: 'HNL', label: 'Home & Living', labelId: 'Rumah & Hunian',
    kw: ['rumah', 'hunian', 'interior', 'home living'],
    subs: [
      { code: 'INT', label: 'Interior', labelId: 'Interior',
        kw: ['interior', 'dekorasi', 'desain rumah', 'ruang tamu'],
        topics: [
          { code: 'MAKE', label: 'Room Makeover', labelId: 'Makeover Ruangan', kw: ['makeover', 'room tour', 'kamar aesthetic'] },
          { code: 'DECO', label: 'Furniture & Decor', labelId: 'Furnitur & Dekorasi', kw: ['furnitur', 'sofa', 'dekorasi', 'lampu'] },
        ] },
      { code: 'ORG', label: 'Home Organization', labelId: 'Beberes Rumah',
        kw: ['beberes', 'organizing', 'storage', 'bersih-bersih', 'rapi'],
        topics: [
          { code: 'STOR', label: 'Storage & Organizing', labelId: 'Penyimpanan & Penataan', kw: ['storage', 'rak', 'organizing', 'lemari'] },
          { code: 'CLEA', label: 'Cleaning Routine', labelId: 'Rutinitas Bersih-bersih', kw: ['cleaning', 'bersih-bersih', 'deep clean'] },
        ] },
      { code: 'IMP', label: 'Home Improvement', labelId: 'Renovasi Rumah',
        kw: ['renovasi', 'bangun rumah', 'diy rumah', 'tukang', 'kpr'],
        topics: [
          { code: 'RENO', label: 'Renovation & DIY', labelId: 'Renovasi & DIY', kw: ['renovasi', 'diy', 'rab', 'tukang'] },
          { code: 'FRST', label: 'First Home & KPR', labelId: 'Rumah Pertama & KPR', kw: ['kpr', 'rumah pertama', 'cicilan rumah', 'developer'] },
        ] },
    ],
  },
]

/* ── brand taxonomy: Industry → Niche ─────────────────────────────────────── */

/**
 * `brand_niche` is collected on Brand_Profile and read by no formula in the
 * engine — a field the brand fills in that changes nothing. The `primary` and
 * `secondary` lists below are what give it a job: they are the only place the
 * taxonomy says "this kind of brand wants exactly this kind of creator" at a
 * finer grain than Industry × Category.
 *
 * Industry order matches INDUSTRY_CATEGORY in vocabulary.mjs — matrix 5 is
 * written from this list, so append rather than reorder.
 */
export const BRAND_TAXONOMY = [
  { code: 'TECH', industry: 'Technology / SaaS', industryId: 'Teknologi / SaaS',
    kw: ['teknologi', 'software', 'aplikasi', 'platform', 'digital'],
    niches: [
      { code: 'B2BSAAS', label: 'B2B SaaS', labelId: 'SaaS B2B',
        kw: ['saas', 'b2b', 'dashboard', 'langganan', 'enterprise'],
        primary: ['TEC.SAAS', 'TEC.AIP'], secondary: ['FIN.BIZ', 'EDU.CAR'] },
      { code: 'CONAPP', label: 'Consumer App', labelId: 'Aplikasi Konsumen',
        kw: ['aplikasi', 'app', 'download', 'pengguna', 'fitur baru'],
        primary: ['TEC.GDG', 'TEC.AIP'], secondary: ['LIF.VLG', 'LIF.SLF', 'GAM.MOB'] },
    ] },
  { code: 'BEAUTY', industry: 'Beauty & Skincare', industryId: 'Kecantikan & Perawatan Kulit',
    kw: ['kecantikan', 'skincare', 'kosmetik', 'perawatan'],
    niches: [
      { code: 'CLEAN', label: 'Clean Beauty', labelId: 'Clean Beauty',
        kw: ['clean beauty', 'bahan alami', 'vegan', 'cruelty free', 'bpom'],
        primary: ['BEA.SKN', 'BEA.MKP'], secondary: ['LIF.MIN', 'FIT.HOM'] },
      { code: 'DERMA', label: 'Derma Skincare', labelId: 'Skincare Dermatologi',
        kw: ['dermatologi', 'klinik kecantikan', 'active ingredient', 'retinol', 'niacinamide'],
        primary: ['BEA.SKN'], secondary: ['BEA.HAR', 'PAR.MOM'] },
    ] },
  { code: 'FNB', industry: 'Food & Beverage', industryId: 'Makanan & Minuman',
    kw: ['makanan', 'minuman', 'kuliner', 'resto'],
    niches: [
      { code: 'LOCALFNB', label: 'Local F&B', labelId: 'F&B Lokal',
        kw: ['resto lokal', 'outlet', 'cabang baru', 'menu baru', 'franchise'],
        primary: ['FOD.CUL', 'FOD.BEV'], secondary: ['TRV.DOM', 'LIF.VLG'] },
      { code: 'RTD', label: 'Ready-to-Drink', labelId: 'Minuman Siap Minum',
        kw: ['minuman kemasan', 'botol', 'sachet', 'isotonik'],
        primary: ['FOD.BEV'], secondary: ['FIT.RUN', 'FIT.GYM', 'FOD.CUL'] },
    ] },
  { code: 'FASHION', industry: 'Fashion & Apparel', industryId: 'Mode & Pakaian',
    kw: ['fashion', 'pakaian', 'apparel', 'koleksi'],
    niches: [
      { code: 'MODEST', label: 'Modest Fashion', labelId: 'Fashion Muslimah',
        kw: ['modest', 'hijab', 'muslimah', 'gamis', 'syari'],
        primary: ['FAS.HJB'], secondary: ['FAS.LOC', 'BEA.MKP', 'PAR.MOM'] },
      { code: 'ATHL', label: 'Athleisure', labelId: 'Athleisure',
        kw: ['athleisure', 'sportswear', 'legging', 'activewear'],
        primary: ['FAS.STR', 'FIT.GYM'], secondary: ['FIT.RUN', 'FIT.HOM', 'LIF.VLG'] },
    ] },
  { code: 'HEALTH', industry: 'Health & Fitness', industryId: 'Kesehatan & Kebugaran',
    kw: ['kesehatan', 'kebugaran', 'sehat', 'fitness'],
    niches: [
      { code: 'GYMSTUDIO', label: 'Gym & Studio', labelId: 'Gym & Studio',
        kw: ['gym', 'studio', 'membership', 'personal trainer'],
        primary: ['FIT.GYM', 'FIT.HOM'], secondary: ['FIT.RUN', 'LIF.SLF'] },
      { code: 'SUPP', label: 'Supplement & Nutrition', labelId: 'Suplemen & Nutrisi',
        kw: ['suplemen', 'vitamin', 'protein', 'nutrisi', 'herbal'],
        primary: ['FIT.GYM', 'FIT.RUN'], secondary: ['FOD.HCK', 'PAR.PRG', 'BEA.SKN'] },
    ] },
  { code: 'FINSVC', industry: 'Financial Services', industryId: 'Jasa Keuangan',
    kw: ['keuangan', 'bank', 'ojk', 'pembayaran'],
    niches: [
      { code: 'DIGIBANK', label: 'Digital Banking', labelId: 'Bank Digital',
        kw: ['bank digital', 'tabungan', 'transfer', 'qris', 'e-wallet'],
        primary: ['FIN.PFN'], secondary: ['FIN.INV', 'FIN.BIZ', 'EDU.CAR'] },
      { code: 'INVPLAT', label: 'Investment Platform', labelId: 'Platform Investasi',
        kw: ['sekuritas', 'reksadana', 'portofolio', 'trading'],
        primary: ['FIN.INV'], secondary: ['FIN.PFN', 'TEC.AIP'] },
    ] },
  { code: 'EDUC', industry: 'Education', industryId: 'Pendidikan',
    kw: ['pendidikan', 'belajar', 'kursus', 'sekolah'],
    niches: [
      { code: 'EDUTECH', label: 'Edutech', labelId: 'Edutech',
        kw: ['edutech', 'kelas online', 'platform belajar', 'bimbel online'],
        primary: ['EDU.STU', 'EDU.LNG'], secondary: ['EDU.CAR', 'TEC.AIP', 'PAR.KID'] },
      { code: 'TESTPREP', label: 'Test Prep & Course', labelId: 'Bimbel & Kursus',
        kw: ['bimbel', 'try out', 'utbk', 'sertifikasi', 'bootcamp'],
        primary: ['EDU.STU', 'EDU.CAR'], secondary: ['EDU.LNG', 'PAR.KID'] },
    ] },
  { code: 'TRAVEL', industry: 'Travel & Hospitality', industryId: 'Wisata & Perhotelan',
    kw: ['wisata', 'travel', 'hotel', 'destinasi'],
    niches: [
      { code: 'HOTEL', label: 'Hotel & Resort', labelId: 'Hotel & Resort',
        kw: ['hotel', 'resort', 'staycation', 'menginap'],
        primary: ['TRV.STY'], secondary: ['TRV.DOM', 'FOD.CUL', 'PAR.KID'] },
      { code: 'OTA', label: 'OTA & Trip', labelId: 'OTA & Perjalanan',
        kw: ['tiket', 'booking', 'promo', 'open trip', 'itinerary'],
        primary: ['TRV.BGT', 'TRV.DOM'], secondary: ['TRV.STY', 'FIN.PFN'] },
    ] },
  { code: 'HOMELIV', industry: 'Home & Living', industryId: 'Rumah & Hunian',
    kw: ['rumah', 'hunian', 'peralatan rumah'],
    niches: [
      { code: 'HOMEESS', label: 'Home Essentials', labelId: 'Kebutuhan Rumah',
        kw: ['peralatan rumah', 'kebutuhan rumah', 'pembersih', 'dapur'],
        primary: ['HNL.ORG'], secondary: ['HNL.INT', 'PAR.MOM', 'FOD.HCK'] },
      { code: 'FURN', label: 'Furniture & Decor', labelId: 'Furnitur & Dekorasi',
        kw: ['furnitur', 'mebel', 'dekorasi', 'sofa', 'rak'],
        primary: ['HNL.INT'], secondary: ['HNL.IMP', 'LIF.MIN'] },
    ] },
  { code: 'AUTOM', industry: 'Automotive', industryId: 'Otomotif',
    kw: ['otomotif', 'kendaraan', 'dealer', 'showroom'],
    niches: [
      { code: 'MOTOPART', label: 'Motorcycle & Parts', labelId: 'Motor & Sparepart',
        kw: ['motor', 'sparepart', 'oli', 'ban', 'servis'],
        primary: ['AUT.MTR', 'AUT.MOD'], secondary: ['AUT.CAR', 'TRV.DOM'] },
      { code: 'CAREV', label: 'Car & EV', labelId: 'Mobil & Kendaraan Listrik',
        kw: ['mobil', 'ev', 'kendaraan listrik', 'dealer', 'test drive'],
        primary: ['AUT.CAR'], secondary: ['AUT.MOD', 'TEC.GDG', 'FIN.PFN'] },
    ] },
  { code: 'GAMENT', industry: 'Gaming & Entertainment', industryId: 'Gim & Hiburan',
    kw: ['gim', 'game', 'hiburan', 'streaming'],
    niches: [
      { code: 'MOBGAME', label: 'Mobile Game', labelId: 'Gim Mobile',
        kw: ['mobile game', 'event in-game', 'top up', 'karakter baru'],
        primary: ['GAM.MOB', 'GAM.ESP'], secondary: ['GAM.PCC', 'ENT.COM'] },
      { code: 'STREAM', label: 'Streaming & Music', labelId: 'Streaming & Musik',
        kw: ['streaming', 'playlist', 'rilis', 'konser', 'series'],
        primary: ['ENT.MUS', 'ENT.FLM'], secondary: ['ENT.COM', 'LIF.VLG'] },
    ] },
  { code: 'PARENT', industry: 'Parenting & Baby', industryId: 'Pengasuhan & Bayi',
    kw: ['ibu', 'anak', 'bayi', 'keluarga', 'balita'],
    niches: [
      { code: 'FAMNUT', label: 'Family Nutrition', labelId: 'Nutrisi Keluarga',
        kw: ['nutrisi', 'susu', 'gizi', 'mpasi', 'tumbuh kembang'],
        primary: ['PAR.PRG', 'PAR.KID'], secondary: ['FOD.HCK', 'PAR.MOM', 'FIT.HOM'] },
      { code: 'BABYCARE', label: 'Baby Care', labelId: 'Perawatan Bayi',
        kw: ['popok', 'bayi', 'newborn', 'perlengkapan bayi', 'stroller'],
        primary: ['PAR.PRG', 'PAR.MOM'], secondary: ['PAR.KID', 'BEA.SKN'] },
    ] },
]

/* ── the crosswalk ladder ─────────────────────────────────────────────────── */

/** Score a niche gives a sub category it names outright. */
export const CROSSWALK_PRIMARY = 100
/** Score for a sub category the niche reaches but does not centre on. */
export const CROSSWALK_SECONDARY = 85
/**
 * Ceiling for a sub category the niche said nothing about, inside a category it
 * did speak about.
 *
 * Without this rung the crosswalk contradicts itself. Matrix 5 scores Derma
 * Skincare against the whole Beauty category at 100, so a Derma brief would
 * score Makeup — which it never named — above Haircare, which it named as a
 * secondary. The rung says: once a niche tells us which part of a category it
 * means, its silence about the rest of that category is information. Categories
 * the niche never mentioned are untouched and keep whatever matrix 5 said.
 */
export const CROSSWALK_SIBLING = 70

/* ── the DB alias map ─────────────────────────────────────────────────────── */

/**
 * `public.kol_categories` holds 28 master rows, all of them in use, and the
 * chip UI is built from them dynamically. Mapping them onto the tree above is
 * the one input the backend plan is still waiting on
 * (`backend-validation-10-filters.md:170`, owner: Product).
 *
 * Only the five names the 8 Sep 2026 audit actually measured are listed. The
 * other 23 are deliberately absent rather than guessed: `npm run taxonomy:fetch`
 * reads them off the KOL server — office VPN required — into
 * `kol-categories.json`, which the builder picks up automatically.
 *
 * Two of the five do not belong on the content axis at all, and that is the
 * finding: "Moms" is an audience and "Gen Z" is an age band, both filed in a
 * content column. A brand asking for parenting content and a brand asking for a
 * mother audience are asking different questions; today the category chip
 * answers both with the same row.
 *
 * raw name, creators, axis, maps to, note
 */
export const DB_CATEGORY_ALIASES = [
  ['Lifestyle', 2522, 'CONTENT', 'LIF',
    'Maps cleanly to L1. Also the dumping ground: 2.522 of 4.174 categorised creators sit here, so on its own it barely narrows a search. Sub-category classification is what breaks it up.'],
  ['Beauty', 1271, 'CONTENT', 'BEA',
    'Maps cleanly to L1. With Lifestyle this is 90,9% of every categorised creator.'],
  ['Moms', 581, 'CONTENT + AUDIENCE', 'PAR.MOM',
    'The content half maps to Parenting → Momlife. The audience half — female, 25-44, parent — belongs on the audience axis and must not be reached through the category chip.'],
  ['Entertainment', 476, 'CONTENT', 'ENT', 'Maps cleanly to L1.'],
  ['Gen Z', 150, 'AUDIENCE', '—',
    'Not a content category at all: an age band already carried by Audience Age 13-17 / 18-24. Keep the row for backward compatibility, drop it from the category chip, and answer the question with the audience filter built for it.'],
]

/* ── how an uncategorised creator gets a node ─────────────────────────────── */

/**
 * 3.547 of 7.721 creators carry no category, and Add KOL never writes one. These
 * are the rules that fill the gap without letting a guess be read as a
 * measurement.
 *
 * step, rule, detail
 */
export const CLASSIFICATION_RULES = [
  ['1. Source of truth', 'An existing kol_categories row always wins',
    'If the creator already has category_ids, map them through the alias table and stop. A keyword hit never overwrites a human classification.'],
  ['2. Evidence', 'Bio first, then captions, then audience interest',
    'The bio is the creator describing themselves — weight ×2. Recent captions weight ×1. Audience interest is a tie-break only: what an audience likes is not what the creator makes.'],
  ['3. Scoring', 'A keyword hit scores by the level it belongs to',
    'A Content Topic (L3) hit scores 3, a Sub Category (L2) hit 2, a Category (L1) hit 1, each multiplied by the evidence weight. Scores roll up — an L3 hit credits its parents too.'],
  ['4. Assignment', 'Assign the level the evidence actually supports',
    'Leader ≥ 6 points and ahead of the runner-up by ≥ 2 → assign L2 and its L1. Leader ≥ 3 → assign L1 only. Otherwise leave Uncategorized. At most 3 categories per creator; the DB allows 5 and 1.183 creators already carry more than one.'],
  ['5. Confidence', 'Carry the basis, the way SignalBasis already does',
    'live = mapped from kol_categories · calculated = keyword classification above threshold · estimated = L1-only fallback. Discovery may rank on any of the three.'],
  ['6. The hard rule', 'A modelled category ranks; it never gates',
    'Category as a HARD FILTER is legitimate only against a live basis. Applied to an estimated one it silently deletes creators on the strength of a guess — the same mistake as the preset chips that ranked by a hash of the creator id.'],
]

/* ── where each level lives, and how much of it exists ────────────────────── */

/** level, stored in, coverage (8 Sep 2026), what is missing */
export const TAXONOMY_COVERAGE = [
  ['L1 Category', 'kol_directory.category_ids → public.kol_categories',
    '4.174 / 7.721 = 54,1%',
    '28 raw rows mixing content and audience labels, mapped to no code. Needs the alias table agreed and stored.'],
  ['L2 Sub Category', '— no column exists', '0%',
    'Needs public.kol_sub_categories plus kol_directory.sub_category_ids. Until then Sub Category Match falls back to its parent-category ladder and the Discovery filter stays disabled with its reason shown.'],
  ['L3 Content Topic', 'feature.{ig,tt}_post_analysis.content_category', '0 rows',
    'The column exists and is empty. It is also the right place to classify from: a topic is a property of a post, not of an account.'],
  ['B1 Brand Industry', 'Brand_Profile.industry (workbook input)', 'n/a — brand-side input',
    'Read by Industry Match through matrix 5. Complete.'],
  ['B2 Brand Niche', 'Brand_Profile.brand_niche (workbook input)', 'n/a — brand-side input',
    'Collected, and read by no formula in the engine. The crosswalk is what would give it weight.'],
  ['Keywords', 'Brand_Profile.business_keywords / brand_keywords', 'creator side: kol_directory.bio, ~12% filled',
    'Keyword Match searches the creator bio, topics, interests and category text. A bio column that is 88% empty is the ceiling on that score today.'],
]

/**
 * The alias table as the sheet should print it.
 *
 * With no snapshot on disk it is the five measured rows and nothing else. Once
 * `npm run taxonomy:fetch` has run on the office VPN it is all 28 master rows
 * with their real counts, the five already decided and the rest marked UNMAPPED
 * — a to-do list with names on it rather than a note saying names exist.
 */
export function aliasTable() {
  const decided = new Map(DB_CATEGORY_ALIASES.map(a => [a[0], a]))
  const snap = dbCategorySnapshot()
  if (!snap) {
    return { rows: DB_CATEGORY_ALIASES, measuredAt: null, missing: 28 - DB_CATEGORY_ALIASES.length }
  }
  const rows = snap.rows.map(({ name, creators }) => {
    const hit = decided.get(name)
    // The snapshot's count is the fresher measurement, so it wins over the one
    // written down when the alias was decided.
    return hit
      ? [hit[0], creators, hit[2], hit[3], hit[4]]
      : [name, creators, 'UNMAPPED', '—',
        'Not yet decided. Two questions, in order: which axis is this — content, audience or format — and only then, which node.']
  })
  return { rows, measuredAt: snap.measuredAt, missing: rows.filter(r => r[2] === 'UNMAPPED').length }
}

/* ── derived views ────────────────────────────────────────────────────────── */

export const CATEGORIES = TAXONOMY.map(c => c.label)

/** [sub label, parent label] — the shape Lookup_Lists section 2 is built from. */
export const SUBCATS = TAXONOMY.flatMap(c => c.subs.map(s => [s.label, c.label]))

/** [topic label, sub label, category label] */
export const TOPICS = TAXONOMY.flatMap(c =>
  c.subs.flatMap(s => s.topics.map(t => [t.label, s.label, c.label])))

export const INDUSTRIES = BRAND_TAXONOMY.map(i => i.industry)

export const NICHES = BRAND_TAXONOMY.flatMap(i => i.niches.map(n => n.label))

/** Every creator-side node, flattened, in reading order. */
export function nodes() {
  const out = []
  for (const c of TAXONOMY) {
    out.push({ code: c.code, level: 'L1 Category', parent: '', label: c.label, labelId: c.labelId, kw: c.kw })
    for (const s of c.subs) {
      out.push({ code: `${c.code}.${s.code}`, level: 'L2 Sub Category', parent: c.code, label: s.label, labelId: s.labelId, kw: s.kw })
      for (const t of s.topics) {
        out.push({
          code: `${c.code}.${s.code}.${t.code}`, level: 'L3 Content Topic',
          parent: `${c.code}.${s.code}`, label: t.label, labelId: t.labelId, kw: t.kw,
        })
      }
    }
  }
  return out
}

/** Every brand-side node, flattened, in reading order. */
export function brandNodes() {
  const out = []
  for (const i of BRAND_TAXONOMY) {
    out.push({ code: i.code, level: 'B1 Industry', parent: '', label: i.industry, labelId: i.industryId, kw: i.kw })
    for (const n of i.niches) {
      out.push({ code: `${i.code}.${n.code}`, level: 'B2 Niche', parent: i.code, label: n.label, labelId: n.labelId, kw: n.kw })
    }
  }
  return out
}

const SUB_BY_CODE = new Map()
for (const c of TAXONOMY) {
  for (const s of c.subs) SUB_BY_CODE.set(`${c.code}.${s.code}`, { sub: s, cat: c })
}

/** `'BEA.SKN'` → `{ subLabel, catLabel }`, or null for an unknown code. */
export function subOf(code) {
  const hit = SUB_BY_CODE.get(code)
  return hit ? { subLabel: hit.sub.label, catLabel: hit.cat.label } : null
}

/** Every sub category belonging to category `catLabel`, as `{ code, label }`. */
export function subsOfCategory(catLabel) {
  const cat = TAXONOMY.find(c => c.label === catLabel)
  return cat ? cat.subs.map(s => ({ code: `${cat.code}.${s.code}`, label: s.label })) : []
}

/**
 * The categories a niche has expressed an opinion about, with the sub category
 * codes it named at each strength. Throws on an unknown code rather than
 * emitting a crosswalk row that would silently never match anything.
 */
export function nicheClaims(niche) {
  const primary = new Set(niche.primary)
  const secondary = new Set(niche.secondary ?? [])
  const cats = new Set()
  for (const code of [...primary, ...secondary]) {
    const hit = subOf(code)
    if (!hit) throw new Error(`crosswalk: niche ${niche.label} names unknown sub category ${code}`)
    cats.add(hit.catLabel)
  }
  return { primary, secondary, cats }
}
