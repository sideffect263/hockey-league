-- Undo supabase/creator-posting.sql. Photos already uploaded stay in the bucket (delete by hand).
select cron.unschedule('instagram-sync');
drop function if exists public.run_instagram_sync();
drop function if exists public.instagram_sync_disconnect(uuid);
drop function if exists public.instagram_sync_settings(uuid, text, text);
drop view if exists public.instagram_sync_status;
drop table if exists public.instagram_sync;
drop function if exists public.create_feed_post(text, text, text, text, real, uuid, uuid, boolean);
drop policy if exists "Staff upload feed photos" on storage.objects;
drop policy if exists "Owner delete feed photos" on storage.objects;
-- publish_feed_draft: re-apply the version in supabase/creators-studio.sql, then:
-- alter table public.feed_drafts drop column if exists external_guid, drop column if exists source_link;
