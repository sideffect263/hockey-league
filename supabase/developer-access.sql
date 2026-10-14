-- developer-access.sql (2026-10-15) — NOT APPLIED YET.
--
-- The video lab, 3D replay, media (face naming) and photo-cluster tools moved from /creators to
-- /devs. Their tables were gated to `is_admin() OR is_content_editor()`; this adds
-- `OR is_developer()` (supabase/developer-role.sql) to exactly those gates. Purely additive:
-- admins and content editors keep everything they had. Policy names and the existing terms are
-- copied from the live definitions (pg_policies, read 2026-10-15), so ALTER POLICY changes only
-- the expressions.
--
-- Not touched on purpose:
--   video_lab_reels         — feed drafts (FeedDrafts, still on /creators)
--   video_surveys*          — admin-only (/admin סקרים, the lab's "החלף בפיד" survey list)
--   cluster_suggestions     — insert is open to every member already; only the DELETE (used by
--                             "reopen cluster" in קבוצות תמונות) is widened below
--
-- What a developer can do after this: everything a content editor can in the lab (upload /
-- delete clips + their storage objects, labels, shots, rink points, match-event verdicts, 3D
-- scenes) and resolve / hide / reopen face clusters. They still cannot publish to the feed
-- (posts / feed_drafts gates are unchanged) and "החלף בפיד" stays admin-only in the UI.

begin;

-- ── video lab tables ───────────────────────────────────────────────────────────────────────────
alter policy "Editors manage video lab clips" on public.video_lab_clips
  using (is_admin() or is_content_editor() or (select public.is_developer()))
  with check (is_admin() or is_content_editor() or (select public.is_developer()));

alter policy "Editors manage video lab labels" on public.video_lab_labels
  using (is_admin() or is_content_editor() or (select public.is_developer()))
  with check (is_admin() or is_content_editor() or (select public.is_developer()));

alter policy "Editors manage video lab versions" on public.video_lab_versions
  using (is_admin() or is_content_editor() or (select public.is_developer()))
  with check (is_admin() or is_content_editor() or (select public.is_developer()));

alter policy "Editors manage video lab shots" on public.video_lab_shots
  using ((select is_admin()) or (select is_content_editor()) or (select public.is_developer()))
  with check ((select is_admin()) or (select is_content_editor()) or (select public.is_developer()));

alter policy "Editors manage match runs" on public.video_lab_match_runs
  using ((select is_admin()) or (select is_content_editor()) or (select public.is_developer()))
  with check ((select is_admin()) or (select is_content_editor()) or (select public.is_developer()));

alter policy "Editors manage match events" on public.video_lab_match_events
  using ((select is_admin()) or (select is_content_editor()) or (select public.is_developer()))
  with check ((select is_admin()) or (select is_content_editor()) or (select public.is_developer()));

alter policy "Editors manage rink sets" on public.video_lab_rink_sets
  using ((select is_admin()) or (select is_content_editor()) or (select public.is_developer()))
  with check ((select is_admin()) or (select is_content_editor()) or (select public.is_developer()));

alter policy "Editors manage rink frames" on public.video_lab_rink_frames
  using ((select is_admin()) or (select is_content_editor()) or (select public.is_developer()))
  with check ((select is_admin()) or (select is_content_editor()) or (select public.is_developer()));

alter policy "Editors manage rink points" on public.video_lab_rink_points
  using ((select is_admin()) or (select is_content_editor()) or (select public.is_developer()))
  with check ((select is_admin()) or (select is_content_editor()) or (select public.is_developer()));

-- 3D replay scenes
alter policy "Editors manage scenes" on public.video_lab_scenes
  using ((select is_admin()) or (select is_content_editor()) or (select public.is_developer()))
  with check ((select is_admin()) or (select is_content_editor()) or (select public.is_developer()));

-- ── video-lab storage bucket (public read is already open) ────────────────────────────────────
alter policy "video-lab editors insert" on storage.objects
  with check ((bucket_id = 'video-lab') and (is_admin() or is_content_editor() or (select public.is_developer())));

alter policy "video-lab editors update" on storage.objects
  using ((bucket_id = 'video-lab') and (is_admin() or is_content_editor() or (select public.is_developer())));

alter policy "video-lab editors delete" on storage.objects
  using ((bucket_id = 'video-lab') and (is_admin() or is_content_editor() or (select public.is_developer())));

-- ── face clusters (מדיה / קבוצות תמונות) ──────────────────────────────────────────────────────
alter policy "Admin manage clusters" on public.face_clusters
  using (is_admin() or is_content_editor() or (select public.is_developer()))
  with check (is_admin() or is_content_editor() or (select public.is_developer()));

-- Hidden clusters stay visible to whoever can un-hide them.
alter policy "Public read clusters" on public.face_clusters
  using ((status <> 'hidden') or is_admin() or is_content_editor() or (select public.is_developer()));

alter policy "Admin delete suggestions" on public.cluster_suggestions
  using (is_admin() or is_content_editor() or (select public.is_developer()));

commit;
