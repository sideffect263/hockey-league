-- Stored Storage URLs → the custom domain (2026-10-15). Undo: storage-urls-api-host-down.sql.
--
-- Rows saved full public URLs on https://slpwwoupbbxcgjivcspv.supabase.co. That host belongs
-- to THIS project, so it dies when the project moves (Tokyo → Frankfurt). Same objects, same
-- paths, now under https://api.rinkhockeyil.com, which will point at whichever project is live.
--
-- Triggers are off for this one transaction (session_replication_role = replica): this changes
-- the host only, so it must not stamp updated_at, re-run teams_shrink_crest on every crest,
-- or trip the sandbox guards. app_events.detail (telemetry history) is left as it was.
begin;
set local session_replication_role = replica;

update public.teams          set logo_url  = replace(logo_url,  'https://slpwwoupbbxcgjivcspv.supabase.co/', 'https://api.rinkhockeyil.com/') where logo_url  like 'https://slpwwoupbbxcgjivcspv.supabase.co/%';
update public.profiles       set avatar_url = replace(avatar_url, 'https://slpwwoupbbxcgjivcspv.supabase.co/', 'https://api.rinkhockeyil.com/') where avatar_url like 'https://slpwwoupbbxcgjivcspv.supabase.co/%';
update public.posts          set image_url = replace(image_url, 'https://slpwwoupbbxcgjivcspv.supabase.co/', 'https://api.rinkhockeyil.com/') where image_url like 'https://slpwwoupbbxcgjivcspv.supabase.co/%';
update public.photos         set image_url = replace(image_url, 'https://slpwwoupbbxcgjivcspv.supabase.co/', 'https://api.rinkhockeyil.com/') where image_url like 'https://slpwwoupbbxcgjivcspv.supabase.co/%';
update public.player_cutouts set image_url = replace(image_url, 'https://slpwwoupbbxcgjivcspv.supabase.co/', 'https://api.rinkhockeyil.com/') where image_url like 'https://slpwwoupbbxcgjivcspv.supabase.co/%';
update public.face_clusters  set cover_url = replace(cover_url, 'https://slpwwoupbbxcgjivcspv.supabase.co/', 'https://api.rinkhockeyil.com/') where cover_url like 'https://slpwwoupbbxcgjivcspv.supabase.co/%';
update public.video_lab_reels set picks = replace(picks::text, 'https://slpwwoupbbxcgjivcspv.supabase.co/', 'https://api.rinkhockeyil.com/')::jsonb where picks::text like '%https://slpwwoupbbxcgjivcspv.supabase.co/%';

commit;
