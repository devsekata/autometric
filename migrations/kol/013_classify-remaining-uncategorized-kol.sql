-- Up Migration
--
-- Give the last 15 uncategorised active creators a category and subcategory.
--
--   npm run migrate:kol
--
-- ── Scope: the KOL server only ──────────────────────────────────────────────
-- Applied by `scripts/apply-kol-migration.js` through `PG_*_KOL`. Never run by
-- `npm run migrate:up`, which targets the analytics warehouse.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- 012 copied the inferred classification into Discovery's category columns for
-- the 23 creators whose inferred_category_confidence was high or medium. The
-- other 15 were 'low'. Each was re-read against its evidence (bio, captions in
-- l1_silver.unified_post, kol_profile_card.content_topic, and the curated
-- reason in inferred_category_evidence):
--
--   10 rows: the inferred classification matches the evidence. Written as is.
--    5 rows: the evidence itself records the label as a placeholder or a
--            fallback for "no matching category". Those are reclassified to a
--            category that exists for what the content actually is (step 2),
--            rather than written with a label known to be wrong.
--
-- ── Taxonomy (step 1) ───────────────────────────────────────────────────────
-- Existing rows are reused wherever one fits:
--   Environmentalism and sustainability, Animal Lovers  existing level-'category'
--       rows with no code. They get a code (ENV, ANM) so they can be referenced
--       by inferred_category_id (fn_kd_inferred_category_check requires one).
--       Name, taxonomy_key and every creator already tagged with them are
--       untouched.
-- Added, because nothing in kol_categories describes the content:
--   News & Media (NWS)            > Local News (NWS.LOC)
--   Art (ART)                     > Painting & Visual Art (ART.VIS)
--   Environmentalism and sust. (ENV) > Environmental Action (ENV.ACT)
--   Animal Lovers (ANM)           > Pet Content (ANM.PET)
-- Codes follow the existing PARENT / PARENT.SUB pattern. None of the new rows
-- has a taxonomy_key: they are outside the nine Brand Match keys and are shown
-- under their own names.
--
-- ── Data ────────────────────────────────────────────────────────────────────
-- Step 2 rewrites inferred_category_id / inferred_subcategory_id / source /
-- confidence / inferred_category_at for the 5 rows, only while they still hold
-- the placeholder classification, and keeps the previous values under
-- inferred_category_evidence.manual_review.previous.
-- Step 3 copies the category into category_id / category_ids for the 15 rows,
-- only while both are still NULL. Subcategory stays in inferred_subcategory_id;
-- category_ids holds category-level ids only.
-- Every step is guarded, so a re-run is a no-op. Nothing is deleted.
--
-- Applied to 10.100.14.216/kol on 2026-09-28.

-- 1. Taxonomy ────────────────────────────────────────────────────────────────
UPDATE public.kol_categories SET code = 'ENV', updated_at = now()
 WHERE name = 'Environmentalism and sustainability' AND level = 'category' AND code IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.kol_categories WHERE code = 'ENV');
UPDATE public.kol_categories SET code = 'ANM', updated_at = now()
 WHERE name = 'Animal Lovers' AND level = 'category' AND code IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.kol_categories WHERE code = 'ANM');

INSERT INTO public.kol_categories (name, code, level, parent_id, created_at, updated_at)
SELECT v.name, v.code, 'category', NULL, now(), now()
  FROM (VALUES ('News & Media', 'NWS'), ('Art', 'ART')) AS v(name, code)
 WHERE NOT EXISTS (SELECT 1 FROM public.kol_categories k
                    WHERE k.code = v.code OR (k.level = 'category' AND k.name = v.name));

INSERT INTO public.kol_categories (name, code, level, parent_id, created_at, updated_at)
SELECT v.name, v.code, 'sub_category', p.id, now(), now()
  FROM (VALUES ('Local News',            'NWS.LOC', 'NWS'),
               ('Painting & Visual Art', 'ART.VIS', 'ART'),
               ('Environmental Action',  'ENV.ACT', 'ENV'),
               ('Pet Content',           'ANM.PET', 'ANM')) AS v(name, code, parent_code)
  JOIN public.kol_categories p ON p.code = v.parent_code AND p.level = 'category'
 WHERE NOT EXISTS (SELECT 1 FROM public.kol_categories k
                    WHERE k.code = v.code OR (k.level = 'sub_category' AND k.name = v.name));

-- 2. Reclassify the 5 placeholder / fallback rows ───────────────────────────
UPDATE public.kol_directory kd
   SET inferred_category_id            = c.id,
       inferred_subcategory_id         = s.id,
       inferred_category_source        = 'curated',
       inferred_category_confidence    = 'medium',
       inferred_subcategory_confidence = 'medium',
       inferred_category_at            = now(),
       inferred_category_evidence      = COALESCE(kd.inferred_category_evidence, '{}'::jsonb)
         || jsonb_build_object('manual_review', jsonb_build_object(
              'date', '2026-09-28', 'reason', t.reason, 'evidence', t.evidence,
              'previous', jsonb_build_object(
                'category', t.old_cat, 'subcategory', t.old_sub,
                'confidence', kd.inferred_category_confidence,
                'subcategory_confidence', kd.inferred_subcategory_confidence)))
  FROM (VALUES
    ('1b3afc5a-ff2c-4723-bb2e-d33bb9989c91'::uuid, 'NWS', 'NWS.LOC', 'Entertainment', 'Film & Series',
     'News page (Harian Bangsa, #tiktokberita): every caption is a news report. Entertainment > Film & Series was recorded as a placeholder.',
     'HARIANBANGSA Koran Warga Jatim Edisi 22 September 2026 #tiktokberita; Aksi pencurian telepon genggam (HP) terjadi di gerai Sanfu, Lippo Mall Puri'),  -- bangsaonline
    ('241bb862-4f8e-4dba-9ffd-97f146e68cd3'::uuid, 'NWS', 'NWS.LOC', 'Entertainment', 'Film & Series',
     'City news page (bio "Jakarta Daily Update"): captions are local news. Entertainment > Film & Series was recorded as a placeholder.',
     'bio: Jakarta Daily Update, Informasi Jakarta & Sekitarnya; Kebakaran terjadi di kawasan Pasar Mobil Kemayoran; BMKG memprakirakan hujan ringan ... DKI Jakarta'),  -- jktinfo
    ('3e91a4aa-5f47-4cc6-b0a2-7b903b47f263'::uuid, 'ENV', 'ENV.ACT', 'Lifestyle', 'Daily Vlog',
     'Environmental clean-up and social-action group. Lifestyle > Daily Vlog was recorded as a fallback ("no matching category").',
     'fenomena yang sering terjadi ketika kita lagi clean up; Siapa disini yang udah mulai pilah sampah di rumah?; kali kedua kita perbaiki sekolah'),  -- pandawaragroup
    ('098f800c-a997-4103-b478-b1e8d2852f4d'::uuid, 'ANM', 'ANM.PET', 'Lifestyle', 'Daily Vlog',
     'Pet-cat persona account (bio names the breed). Lifestyle > Daily Vlog was recorded as the closest fallback.',
     'bio: Kebayoran Baru Short Hair; Mau more snack tapi ga boleh; Misi mencari Pipip yang sedang pergi mandi'),  -- bobbykertanegara
    ('6bdd8713-8312-451e-8901-06a353aa9696'::uuid, 'ART', 'ART.VIS', 'Entertainment', 'Comedy',
     'Painting / visual-art collaborations (content_topic art). Comedy was recorded as a weak guess ("Playful short-video content; weak").',
     'karya seni mahal ini pak! @R U C A S; kanvas udah, muka gua udah, apa lagi yang kita cat ya?; karya adik adik hebat kemaren')  -- botakteras
  ) AS t(id, cat_code, sub_code, old_cat, old_sub, reason, evidence)
  JOIN public.kol_categories c ON c.code = t.cat_code AND c.level = 'category'
  JOIN public.kol_categories s ON s.code = t.sub_code AND s.parent_id = c.id
 WHERE kd.id = t.id
   AND kd.category_id IS NULL AND kd.category_ids IS NULL
   AND (SELECT name FROM public.kol_categories WHERE id = kd.inferred_category_id)    = t.old_cat
   AND (SELECT name FROM public.kol_categories WHERE id = kd.inferred_subcategory_id) = t.old_sub;

-- 3. Copy category into Discovery's columns for the 15 rows ─────────────────
UPDATE public.kol_directory kd
   SET category_id  = kd.inferred_category_id,
       category_ids = ARRAY[kd.inferred_category_id],
       updated_at   = now()
  FROM (VALUES
  ('d6100b4e-de13-4fa6-ab0b-4e6207fc9f0c'::uuid),  -- aamandazahra (instagram)
  ('1b3afc5a-ff2c-4723-bb2e-d33bb9989c91'::uuid),  -- bangsaonline (tiktok)
  ('098f800c-a997-4103-b478-b1e8d2852f4d'::uuid),  -- bobbykertanegara (instagram)
  ('6bdd8713-8312-451e-8901-06a353aa9696'::uuid),  -- botakteras (tiktok)
  ('94dfc30e-a022-4fea-b747-0bb8ba410a0c'::uuid),  -- celinenobleza (tiktok)
  ('934b0de4-d57a-4798-a36f-79dc15bc07b0'::uuid),  -- ditanganu (tiktok)
  ('5f336f2d-8ae2-4002-b456-1c956a274b15'::uuid),  -- ibnuwardani (tiktok)
  ('241bb862-4f8e-4dba-9ffd-97f146e68cd3'::uuid),  -- jktinfo (instagram)
  ('4815a3e8-234e-4a76-8112-4e7b01c5f1fa'::uuid),  -- lalitahutami (tiktok)
  ('3e91a4aa-5f47-4cc6-b0a2-7b903b47f263'::uuid),  -- pandawaragroup (tiktok)
  ('8dbcdc43-8754-47c7-931d-1607af7308c0'::uuid),  -- rayanurfitrird (instagram)
  ('f0354daa-0460-411e-9fb8-b3a994db2490'::uuid),  -- riaricis1795 (instagram)
  ('9af7e5b8-8967-46ea-9ace-7f84b7e879ca'::uuid),  -- saalhaerid (tiktok)
  ('6ce42ec0-2a7c-4642-8a3d-f445d1fe7e2b'::uuid),  -- saalhaerid (instagram)
  ('7cf3b6a5-a45c-48b3-be7b-8189fca46233'::uuid)   -- yourrkayesss (tiktok)
  ) AS t(id)
 WHERE kd.id = t.id
   AND kd.category_id IS NULL
   AND kd.category_ids IS NULL
   AND kd.inferred_category_id IS NOT NULL
   AND kd.inferred_subcategory_id IS NOT NULL;
