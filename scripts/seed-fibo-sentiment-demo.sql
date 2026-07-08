-- ============================================================================
-- DEMO SEED: fake comment sentiment + word cloud for "Fibo Demo", June 2026.
--
-- Writes DIRECTLY into the gold tables the report app reads. It bypasses the
-- real pipeline (l0_raw -> harmonization -> l1 unified_comment -> feature.*
-- -> sp_build_*). No stored procedure needs to run. This is DEMO-ONLY fake
-- sentiment (not real NLP output).
--
-- App read paths:
--   * sentiment line chart -> l2_gold.comment_sentiment_daily
--   * word cloud           -> l2_gold.post_wordcloud JOIN l2_gold.comment_sentiment_post
--
-- Idempotent: re-running UPSERTs (safe to run more than once).
-- To remove later: DELETE ... WHERE brand_id = <Fibo> (see bottom of file).
--
-- Brand:  Fibo Demo  = 5a570576-9a39-4567-b695-22e58c34b443
-- Org:    b33c9046-684b-420b-b581-7df1434a8854
-- Period: June 2026 (report month); daily rows seeded Apr–Jun so the
--         "Last 3 Months" dimension also has 3 non-zero bars.
-- ============================================================================

BEGIN;

-- 1) SENTIMENT LINE — daily comment counts (pos/neu/neg) over Apr–Jun 2026.
INSERT INTO l2_gold.comment_sentiment_daily
  (brand_id, platform, metric_date, total_comments, positive_count, neutral_count, negative_count, avg_sentiment_score, built_at)
SELECT
  '5a570576-9a39-4567-b695-22e58c34b443'::uuid,
  'instagram',
  d::date,
  pos + neu + neg,
  pos, neu, neg,
  ROUND(pos::numeric / NULLIF(pos + neu + neg, 0), 4),   -- positivity ratio 0..1
  now()
FROM (
  SELECT d,
    5 + (EXTRACT(DAY FROM d)::int % 7) * 3 AS pos,        -- gentle day-to-day variation
    2 + (EXTRACT(DAY FROM d)::int % 4)     AS neu,
    1 + (EXTRACT(DAY FROM d)::int % 3)     AS neg
  FROM generate_series('2026-04-01'::date, '2026-06-30'::date, interval '1 day') AS g(d)
) x
ON CONFLICT (brand_id, platform, metric_date) DO UPDATE SET
  total_comments      = EXCLUDED.total_comments,
  positive_count      = EXCLUDED.positive_count,
  neutral_count       = EXCLUDED.neutral_count,
  negative_count      = EXCLUDED.negative_count,
  avg_sentiment_score = EXCLUDED.avg_sentiment_score,
  built_at            = EXCLUDED.built_at;

-- 2) WORD CLOUD (part A) — per-post sentiment so words inherit brand + color.
--    dominant_sentiment drives the word color; post_date scopes to the month.
INSERT INTO l2_gold.comment_sentiment_post
  (platform, post_id, brand_id, post_date, total_comments, positive_count, neutral_count, negative_count, avg_sentiment_score, dominant_sentiment, built_at)
VALUES
  ('instagram','dummy-ig-202606-0','5a570576-9a39-4567-b695-22e58c34b443'::uuid,'2026-06-01', 28, 20, 5, 3, 0.71,'positive', now()),
  ('instagram','dummy-ig-202606-1','5a570576-9a39-4567-b695-22e58c34b443'::uuid,'2026-06-03', 30, 24, 4, 2, 0.80,'positive', now()),
  ('instagram','dummy-ig-202606-2','5a570576-9a39-4567-b695-22e58c34b443'::uuid,'2026-06-06', 26,  3, 5,18, 0.12,'negative', now()),
  ('instagram','dummy-ig-202606-3','5a570576-9a39-4567-b695-22e58c34b443'::uuid,'2026-06-09', 31, 22, 6, 3, 0.71,'positive', now()),
  ('instagram','dummy-ig-202606-4','5a570576-9a39-4567-b695-22e58c34b443'::uuid,'2026-06-12', 25, 18, 5, 2, 0.72,'positive', now()),
  ('instagram','dummy-ig-202606-5','5a570576-9a39-4567-b695-22e58c34b443'::uuid,'2026-06-15', 27,  4,20, 3, 0.48,'neutral',  now()),
  ('instagram','dummy-ig-202606-6','5a570576-9a39-4567-b695-22e58c34b443'::uuid,'2026-06-18', 22, 16, 4, 2, 0.73,'positive', now()),
  ('instagram','dummy-ig-202606-7','5a570576-9a39-4567-b695-22e58c34b443'::uuid,'2026-06-21', 28, 20, 5, 3, 0.71,'positive', now()),
  ('instagram','dummy-ig-202606-8','5a570576-9a39-4567-b695-22e58c34b443'::uuid,'2026-06-24', 20,  2, 4,14, 0.14,'negative', now()),
  ('instagram','dummy-ig-202606-9','5a570576-9a39-4567-b695-22e58c34b443'::uuid,'2026-06-27', 21, 15, 4, 2, 0.72,'positive', now())
ON CONFLICT (platform, post_id) DO UPDATE SET
  brand_id            = EXCLUDED.brand_id,
  post_date           = EXCLUDED.post_date,
  total_comments      = EXCLUDED.total_comments,
  positive_count      = EXCLUDED.positive_count,
  neutral_count       = EXCLUDED.neutral_count,
  negative_count      = EXCLUDED.negative_count,
  avg_sentiment_score = EXCLUDED.avg_sentiment_score,
  dominant_sentiment  = EXCLUDED.dominant_sentiment,
  built_at            = EXCLUDED.built_at;

-- 3) WORD CLOUD (part B) — words + frequency, tied to the posts above so each
--    word inherits its post's dominant_sentiment (green=positive posts,
--    red=negative posts, gray=neutral post).
INSERT INTO l2_gold.post_wordcloud (post_id, platform, word, frequency) VALUES
  -- positive posts (green)
  ('dummy-ig-202606-0','instagram','lembut',40),  ('dummy-ig-202606-0','instagram','wangi',30),
  ('dummy-ig-202606-0','instagram','cepat',22),   ('dummy-ig-202606-1','instagram','bagus',38),
  ('dummy-ig-202606-1','instagram','mantap',26),  ('dummy-ig-202606-1','instagram','praktis',20),
  ('dummy-ig-202606-3','instagram','suka',34),    ('dummy-ig-202606-3','instagram','kualitas',22),
  ('dummy-ig-202606-3','instagram','premium',18), ('dummy-ig-202606-4','instagram','recommended',28),
  ('dummy-ig-202606-4','instagram','murah',18),   ('dummy-ig-202606-4','instagram','elegan',16),
  ('dummy-ig-202606-6','instagram','adem',24),    ('dummy-ig-202606-6','instagram','nyaman',16),
  ('dummy-ig-202606-6','instagram','best',14),    ('dummy-ig-202606-7','instagram','keren',30),
  ('dummy-ig-202606-7','instagram','puas',20),    ('dummy-ig-202606-7','instagram','worth',12),
  ('dummy-ig-202606-9','instagram','favorit',26), ('dummy-ig-202606-9','instagram','ramah',14),
  -- negative posts (red)
  ('dummy-ig-202606-2','instagram','mahal',20),   ('dummy-ig-202606-2','instagram','lambat',16),
  ('dummy-ig-202606-2','instagram','ribet',10),   ('dummy-ig-202606-2','instagram','kurang',7),
  ('dummy-ig-202606-8','instagram','kecewa',14),  ('dummy-ig-202606-8','instagram','telat',12),
  ('dummy-ig-202606-8','instagram','rusak',8),
  -- neutral post (gray)
  ('dummy-ig-202606-5','instagram','harga',18),   ('dummy-ig-202606-5','instagram','ukuran',14),
  ('dummy-ig-202606-5','instagram','stok',12),    ('dummy-ig-202606-5','instagram','promo',12),
  ('dummy-ig-202606-5','instagram','warna',10),   ('dummy-ig-202606-5','instagram','ready',9),
  ('dummy-ig-202606-5','instagram','restock',8),  ('dummy-ig-202606-5','instagram','info',7),
  ('dummy-ig-202606-5','instagram','dm',6)
ON CONFLICT (post_id, platform, word) DO UPDATE SET frequency = EXCLUDED.frequency;

COMMIT;

-- Quick check:
-- SELECT metric_date, positive_count, neutral_count, negative_count
--   FROM l2_gold.comment_sentiment_daily
--  WHERE brand_id='5a570576-9a39-4567-b695-22e58c34b443' AND metric_date >= '2026-06-01'
--  ORDER BY metric_date;

-- ── Undo (remove the demo data) ─────────────────────────────────────────────
-- DELETE FROM l2_gold.post_wordcloud       WHERE post_id LIKE 'dummy-ig-202606-%';
-- DELETE FROM l2_gold.comment_sentiment_post  WHERE brand_id='5a570576-9a39-4567-b695-22e58c34b443';
-- DELETE FROM l2_gold.comment_sentiment_daily WHERE brand_id='5a570576-9a39-4567-b695-22e58c34b443';
