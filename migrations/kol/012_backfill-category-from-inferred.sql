-- Up Migration
--
-- Backfill Discovery's category for active creators that only had an inferred
-- classification.
--
--   npm run migrate:kol
--
-- ── Scope: the KOL server only ──────────────────────────────────────────────
-- Applied by `scripts/apply-kol-migration.js` through `PG_*_KOL`. Never run by
-- `npm run migrate:up`, which targets the analytics warehouse.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- Discovery reads a creator's category from kol_directory.category_ids (falling
-- back to category_id). 38 of the 100 active creators had neither, although
-- every one of them carries a classification in inferred_category_id /
-- inferred_subcategory_id, so the Creator Database showed them as
-- "Belum berkategori". Nothing in this repo writes category_ids (it came from
-- the original roster import), so a creator classified after that import could
-- never gain a category.
--
-- ── Rule ────────────────────────────────────────────────────────────────────
-- Only classifications with inferred_category_confidence 'high' or 'medium'
-- are copied: 23 rows, listed below by id. The 15 'low' rows (curated labels
-- the reviewer marked as weak) are left NULL on purpose; they stay
-- "Belum berkategori" until someone classifies them properly.
--
-- The category is copied as is, including categories outside the nine
-- taxonomy keys (Finance, Parenting, Home & Living): they already exist in
-- kol_categories at level 'category' and are shown under their own names.
-- No kol_categories row is added or changed.
--
-- The subcategory is NOT written to category_ids, which holds category-level
-- ids only. Discovery reads it from inferred_subcategory_id (kolDirectory.ts
-- BASE), and only when it is a child of the category the row carries.
--
-- ── Data ────────────────────────────────────────────────────────────────────
-- Touches category_id, category_ids and updated_at of the listed rows, and only
-- while BOTH category columns are still NULL, so a creator that has meanwhile
-- been given a category is never overwritten and a re-run is a no-op.
-- Nothing is deleted.
--
-- Applied to 10.100.14.216/kol on 2026-09-28 (23 rows); every other column of
-- those rows, every other kol_directory row and kol_categories were verified
-- unchanged by fingerprint before commit.
--
-- ── Revert ──────────────────────────────────────────────────────────────────
--   UPDATE public.kol_directory SET category_id = NULL, category_ids = NULL
--    WHERE id IN (<the ids below>) AND category_ids = ARRAY[inferred_category_id];

UPDATE public.kol_directory kd
   SET category_id  = kd.inferred_category_id,
       category_ids = ARRAY[kd.inferred_category_id],
       updated_at   = now()
  FROM (VALUES
  ('77b96ce0-f4eb-45ec-af1d-42877b54588a'::uuid),  -- drrichardlee (tiktok)         Beauty › Skincare  [medium]
  ('5ab1c10c-e701-4631-a37a-7e4272956e4c'::uuid),  -- jharnabhagwani (tiktok)       Beauty › Makeup  [medium]
  ('b5c58aa0-c1ee-40a4-9ba0-11befb331bd6'::uuid),  -- pojoksatu.id (tiktok)         Beauty › Skincare  [medium]
  ('ad479019-10d8-426f-832f-f089b67baa4f'::uuid),  -- tasyafarasya (instagram)      Beauty › Makeup  [high]
  ('f2e8a875-e9c3-4db8-a441-0fe043763440'::uuid),  -- arafahrianti02 (tiktok)       Entertainment › Comedy  [medium]
  ('476cb45f-e46e-4fdf-bba0-be9442c5ccb5'::uuid),  -- cokipardedebebas (instagram)  Entertainment › Comedy  [high]
  ('febb54fe-4950-47fa-aa60-8521ef677caa'::uuid),  -- eunicetjoaa (tiktok)          Entertainment › Music  [medium]
  ('6cdc37ba-be56-4b56-b1ea-41cc54187587'::uuid),  -- fadiljaidi (instagram)        Entertainment › Comedy  [medium]
  ('e9a6bc48-a3c9-409c-98d0-bd386263df1d'::uuid),  -- febbyrastanty (instagram)     Entertainment › Film & Series  [medium]
  ('3f8232fc-ac7f-447f-b0ec-5cee130ee3c6'::uuid),  -- iben_ma (tiktok)              Entertainment › Comedy  [medium]
  ('e8658a17-1a19-47cc-af37-cd77b51a5683'::uuid),  -- inul.d (instagram)            Entertainment › Music  [high]
  ('1783607a-75b8-497b-bd51-ba065d056ba8'::uuid),  -- raditya_dika (instagram)      Entertainment › Comedy  [high]
  ('1cfa6644-35e8-4e90-a947-85f71a444a40'::uuid),  -- soimah_pancawati (tiktok)     Entertainment › Music  [medium]
  ('15c30acd-118d-4841-bc5c-475b26ee80e9'::uuid),  -- wulanguritno (instagram)      Entertainment › Film & Series  [high]
  ('606c41ef-8944-4c37-8615-49db65400931'::uuid),  -- raffinagita1717 (instagram)   Finance › Business  [medium]
  ('8aab2b5f-4300-4267-bd53-4a3b60d3a027'::uuid),  -- andreastaulany (instagram)    Fitness › Gym & Strength  [medium]
  ('ce00cfff-7785-4582-b956-7b1885305396'::uuid),  -- nanakoot (tiktok)             Food › Culinary Review  [medium]
  ('24ddf147-0f3c-4591-8c2d-36ac6c0d991c'::uuid),  -- irwansyah_15 (instagram)      Home & Living › Interior  [medium]
  ('de8a4c94-f595-4f8e-9e20-2a671a82eac7'::uuid),  -- jennifer.coppen (tiktok)      Lifestyle › Daily Vlog  [medium]
  ('0f23dced-231f-4380-8b98-2349b05cab12'::uuid),  -- imeyhou (tiktok)              Parenting › Pregnancy & Newborn  [medium]
  ('f81149ca-2f45-4330-b3f1-ff7eb939bf07'::uuid),  -- niacnofitasari (instagram)    Parenting › Kids & Family  [medium]
  ('a20f97e7-6f0c-408f-9389-f9aedc2d448c'::uuid),  -- veliaveve_ (tiktok)           Parenting › Pregnancy & Newborn  [medium]
  ('38751070-7cea-44f7-9edf-79dcefe43663'::uuid)   -- folkative (instagram)         Travel › Domestic Travel  [medium]
  ) AS t(id)
 WHERE kd.id = t.id
   AND kd.category_id IS NULL
   AND kd.category_ids IS NULL
   AND kd.inferred_category_id IS NOT NULL
   AND kd.inferred_category_confidence IN ('high', 'medium');
