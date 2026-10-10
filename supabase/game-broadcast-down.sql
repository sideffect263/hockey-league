alter publication supabase_realtime drop table public.game_broadcast;
drop table if exists public.game_broadcast;
drop function if exists public.game_broadcast_touch();
drop policy if exists "hidden cameras: admin + streamer only" on public.game_videos;
drop trigger if exists game_videos_guard_hidden on public.game_videos;
drop function if exists public.game_videos_guard_hidden();
alter table public.game_videos drop column if exists hidden;
