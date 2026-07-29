-- Up Migration
-- Wire the idle l0_extra.*_fpk tables into the medallion.
--
-- Three tables in l0_extra are written by the CSV/FPK ingest path but read by
-- NO procedure and NO view, so their numbers never reach a dashboard:
--
--   l0_extra.ig_profile_fpk   profile_visit          (IG Profile Views)
--   l0_extra.tt_profile_fpk   video_views,
--                             profile_views, shares  (TikTok daily metrics)
--   l0_extra.tt_post_fpk      saves + 11 deeper
--                             per-post metrics
--
-- Measured on the existing `coba_fpk` test brand before this migration:
-- l1_silver.unified_profile.profile_visit summed to 0 for Instagram while
-- ig_profile_fpk held 33,489; TikTok content_views/profile_visit/shares summed
-- to 0 while tt_profile_fpk held 156,586,959 / 224,565 / 23,407.
--
-- Why the fix lives HERE and not in l1_silver: l0_harmonization already has
-- every column needed (instagram_profile.profile_visit, tiktok_profile
-- .video_views/.profile_views/.shares, tiktok_post.saves) and
-- l1_silver.sp_sync_unified_profile already copies them forward
-- (`tp.profile_views AS profile_visit`, `tp.video_views AS content_views`). The
-- break is purely upstream: sp_sync_*_from_raw cannot fill those columns because
-- l0_raw has no such columns, which is exactly why the ingest path parks the
-- values in l0_extra. Filling harmonization therefore needs ZERO changes to
-- silver or gold.
--
-- No existing procedure body is rewritten: the work goes in a NEW procedure and
-- sp_sync_all_from_raw only gains one CALL. That keeps the blast radius of a
-- mistake to CSV-sourced accounts.

CREATE OR REPLACE PROCEDURE l0_harmonization.sp_sync_fpk_extras()
LANGUAGE plpgsql
AS $procedure$
BEGIN
    -- ── Instagram: profile_visit ─────────────────────────────────────────
    -- INSERT-or-update, not a plain UPDATE: a brand may upload only the
    -- "Profile views per day" file, in which case no other Instagram file
    -- created a harmonization row for those dates.
    INSERT INTO l0_harmonization.instagram_profile AS tgt
        (brand_id, date, profile_visit, created_at)
    SELECT
        f.social_account_id,
        (f.fetched_at AT TIME ZONE 'Asia/Jakarta')::DATE,
        -- The source is unique on (social_account_id, fetched_at) — a timestamp —
        -- so two rows can collapse onto one Jakarta date. Take the largest
        -- non-null, matching the consolidation rule the ingest engine uses.
        MAX(f.profile_visit),
        NOW() AT TIME ZONE 'Asia/Jakarta'
    FROM l0_extra.ig_profile_fpk f
    WHERE f.profile_visit IS NOT NULL
      AND EXISTS (
          SELECT 1 FROM public.brand_social_accounts bsa
          WHERE bsa.social_account_id = f.social_account_id
      )
    GROUP BY 1, 2
    ON CONFLICT (brand_id, date) DO UPDATE
        SET profile_visit = COALESCE(EXCLUDED.profile_visit, tgt.profile_visit);

    -- ── TikTok: daily video views / profile views / shares ───────────────
    INSERT INTO l0_harmonization.tiktok_profile AS tgt
        (brand_id, date, video_views, profile_views, shares, created_at)
    SELECT
        f.social_account_id,
        (f.fetched_at AT TIME ZONE 'Asia/Jakarta')::DATE,
        MAX(f.video_views),
        MAX(f.profile_views),
        MAX(f.shares),
        NOW() AT TIME ZONE 'Asia/Jakarta'
    FROM l0_extra.tt_profile_fpk f
    WHERE COALESCE(f.video_views, f.profile_views, f.shares) IS NOT NULL
      AND EXISTS (
          SELECT 1 FROM public.brand_social_accounts bsa
          WHERE bsa.social_account_id = f.social_account_id
      )
    GROUP BY 1, 2
    ON CONFLICT (brand_id, date) DO UPDATE
        SET video_views   = COALESCE(EXCLUDED.video_views,   tgt.video_views),
            profile_views = COALESCE(EXCLUDED.profile_views, tgt.profile_views),
            shares        = COALESCE(EXCLUDED.shares,        tgt.shares);

    -- ── TikTok: per-post saves ───────────────────────────────────────────
    -- UPDATE only. tt_post_fpk carries no post_date/caption/link, so inserting
    -- from it alone would create a post row with no identity beyond its id. A
    -- row here always implies the Post file was uploaded too, which is what
    -- created the harmonization row in the first place.
    UPDATE l0_harmonization.tiktok_post tp
    SET saves = COALESCE(f.saves, tp.saves)
    FROM l0_extra.tt_post_fpk f
    WHERE tp.brand_id = f.social_account_id
      AND tp.post_id  = f.post_id
      AND f.saves IS NOT NULL
      AND tp.saves IS DISTINCT FROM f.saves;

    INSERT INTO l0_harmonization.sync_log (procedure_name, status, message)
    VALUES ('sp_sync_fpk_extras', 'SUCCESS', 'FPK extras disalin ke harmonization');

EXCEPTION WHEN OTHERS THEN
    INSERT INTO l0_harmonization.sync_log (procedure_name, status, message)
    VALUES ('sp_sync_fpk_extras', 'FAILED', SQLERRM);

    RAISE;
END;
$procedure$;

-- Body below is the deployed sp_sync_all_from_raw verbatim, with one CALL added
-- at the end. It runs LAST on purpose: the *_from_raw procedures must have
-- created their harmonization rows before the FPK values are merged onto them.
CREATE OR REPLACE PROCEDURE l0_harmonization.sp_sync_all_from_raw()
LANGUAGE plpgsql
AS $procedure$
BEGIN
    -- Facebook
    CALL l0_harmonization.sp_sync_facebook_profile_from_raw();
    CALL l0_harmonization.sp_sync_facebook_post_from_raw();
    CALL l0_harmonization.sp_sync_facebook_comment_from_raw();
    -- CALL l0_harmonization.sp_sync_facebook_audience_from_raw();

    -- Instagram
    CALL l0_harmonization.sp_sync_instagram_profile_from_raw();
    CALL l0_harmonization.sp_sync_instagram_post_from_raw();
    CALL l0_harmonization.sp_sync_instagram_tagged_post_from_raw();
    CALL l0_harmonization.sp_sync_instagram_comment_from_raw();
    CALL l0_harmonization.sp_sync_instagram_audience_from_raw();
	CALL l0_harmonization.sp_sync_instagram_story_from_raw();

    -- TikTok
    CALL l0_harmonization.sp_sync_tiktok_profile_from_raw();
    CALL l0_harmonization.sp_sync_tiktok_post_from_raw();

    -- CSV/FPK columns that l0_raw has no home for (see 041 migration).
    CALL l0_harmonization.sp_sync_fpk_extras();

    INSERT INTO l0_harmonization.sync_log
        (procedure_name, status, message)
    VALUES
        ('sp_sync_all_from_raw', 'SUCCESS', 'Semua procedure berhasil dijalankan');

EXCEPTION WHEN OTHERS THEN
    INSERT INTO l0_harmonization.sync_log
        (procedure_name, status, message)
    VALUES
        ('sp_sync_all_from_raw', 'FAILED', SQLERRM);

    RAISE;
END;
$procedure$;

-- Down Migration
-- Restores sp_sync_all_from_raw without the extra CALL and drops the new
-- procedure. Nothing else was modified, so this is a complete revert.
-- DROP PROCEDURE IF EXISTS l0_harmonization.sp_sync_fpk_extras();
