-- Up Migration
--
-- Reclassify pojoksatu.id from Beauty > Skincare to News & Media > Local News.
--
--   npm run migrate:kol
--
-- ── Scope: the KOL server only ──────────────────────────────────────────────
-- Applied by `scripts/apply-kol-migration.js` through `PG_*_KOL`. Never run by
-- `npm run migrate:up`, which targets the analytics warehouse.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- 012 copied pojoksatu.id's inferred classification (Beauty > Skincare,
-- curated/medium) into Discovery. Its own evidence does not support it:
--   - the Beauty score (2.50) comes from 2 of 20 posts, both sponsored copy
--     ("Kenalan sama Lumeglow Premium Collagen...", a sunscreen ad);
--   - the curated reviewer's note already reads "Existing Beauty kept; news
--     page, one beauty-supplement post";
--   - 13 of its 20 captions are news reports (incidents in Solo, Lebak Bulus,
--     Mamasa, Barito Kuala, Jember, Gunung Argopuro), the same kind of content
--     as bangsaonline and jktinfo, which 013 classified News & Media > Local News.
--
-- ── Data ────────────────────────────────────────────────────────────────────
-- One row. inferred_* is rewritten (previous values kept under
-- inferred_category_evidence.manual_review.previous) and category_id /
-- category_ids follow it. Guarded on the row still holding Beauty in both
-- places, so a re-run is a no-op. No taxonomy row is added or changed.
--
-- Applied to 10.100.14.216/kol on 2026-09-28.

UPDATE public.kol_directory kd
   SET inferred_category_id            = c.id,
       inferred_subcategory_id         = s.id,
       inferred_category_source        = 'curated',
       inferred_category_confidence    = 'medium',
       inferred_subcategory_confidence = 'medium',
       inferred_category_at            = now(),
       inferred_category_evidence      = COALESCE(kd.inferred_category_evidence, '{}'::jsonb)
         || jsonb_build_object('manual_review', jsonb_build_object(
              'date', '2026-09-28',
              'reason', 'News page: 13 of 20 captions are news reports. The Beauty score (2/20 posts) came from sponsored copy (collagen supplement, sunscreen); the curated note already called it a news page.',
              'evidence', 'Pengemudi BYD Sealion 7 yang bikin geger di Solo ...; Seorang driver ojek online mendapat kejutan dari seorang polisi ...; Kenalan sama Lumeglow Premium Collagen (sponsored)',
              'previous', jsonb_build_object(
                'category', 'Beauty', 'subcategory', 'Skincare',
                'confidence', kd.inferred_category_confidence,
                'subcategory_confidence', kd.inferred_subcategory_confidence))),
       category_id                     = c.id,
       category_ids                    = ARRAY[c.id],
       updated_at                      = now()
  FROM public.kol_categories c
  JOIN public.kol_categories s ON s.code = 'NWS.LOC' AND s.parent_id = c.id
 WHERE c.code = 'NWS' AND c.level = 'category'
   AND kd.id = 'b5c58aa0-c1ee-40a4-9ba0-11befb331bd6'::uuid   -- pojoksatu.id (tiktok)
   AND kd.username = 'pojoksatu.id'
   AND kd.category_id = (SELECT id FROM public.kol_categories WHERE code = 'BEA')
   AND kd.category_ids = ARRAY[(SELECT id FROM public.kol_categories WHERE code = 'BEA')]
   AND kd.inferred_category_id = (SELECT id FROM public.kol_categories WHERE code = 'BEA');
