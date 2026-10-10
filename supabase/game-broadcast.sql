-- Multi-camera phase 2 (2026-10-11): the director's control room.
--
-- 1. game_videos.hidden — a camera stays invisible until the admin approves it. Only the
--    admin and the streamer themself can see a hidden row (restrictive RLS, so realtime
--    and every app honour it with no client change). A trigger owns the flag: new rows of
--    a camera start hidden unless the inserter is the admin or that camera was already
--    approved in this game; only the admin may flip it afterwards. (Content editors can
--    write game_videos directly, so this can't be left to the edge function.)
-- 2. game_broadcast — one row per game of director state: the camera on air ("program")
--    that viewers follow unless they picked their own, score-overlay settings, the cap on
--    simultaneous cameras and a lock on new streams (both enforced in stream-golive).
--    Public read (viewers follow it live), admin-only write.

alter table public.game_videos add column if not exists hidden boolean not null default false;

create or replace function public.game_videos_guard_hidden() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean := coalesce(public.is_admin(), false);
begin
  if tg_op = 'INSERT' then
    if new.camera_no is not null and not v_admin then
      new.hidden := not exists (
        select 1 from public.game_videos
        where game_id = new.game_id and camera_no = new.camera_no and not hidden);
    end if;
  -- No user (service role, SQL maintenance) = not a request to police.
  elsif new.hidden is distinct from old.hidden and not v_admin and auth.uid() is not null then
    raise exception 'only the admin can approve or hide a camera' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists game_videos_guard_hidden on public.game_videos;
create trigger game_videos_guard_hidden before insert or update on public.game_videos
  for each row execute function public.game_videos_guard_hidden();

drop policy if exists "hidden cameras: admin + streamer only" on public.game_videos;
create policy "hidden cameras: admin + streamer only" on public.game_videos
  as restrictive for select
  using (not hidden or (select public.is_admin()) or created_by = (select auth.uid()));

create table if not exists public.game_broadcast (
  game_id           uuid primary key references public.games(id) on delete cascade,
  program_camera_no smallint check (program_camera_no between 1 and 99),
  overlay_score     boolean not null default true,
  overlay_position  text not null default 'top-right' check (overlay_position in ('top-right', 'top-left')),
  max_cameras       smallint not null default 4 check (max_cameras between 1 and 12),
  streaming_locked  boolean not null default false,
  updated_at        timestamptz not null default now(),
  updated_by        uuid default auth.uid()
);

alter table public.game_broadcast enable row level security;

drop policy if exists "Public read game_broadcast" on public.game_broadcast;
create policy "Public read game_broadcast" on public.game_broadcast for select using (true);
drop policy if exists "hide test games" on public.game_broadcast;
create policy "hide test games" on public.game_broadcast as restrictive for select
  using (not public.is_test_game(game_id) or (select public.can_see_test()));
drop policy if exists "Admin writes game_broadcast" on public.game_broadcast;
create policy "Admin writes game_broadcast" on public.game_broadcast for all
  using ((select public.is_admin())) with check ((select public.is_admin()));

grant select on public.game_broadcast to anon, authenticated;
grant insert, update, delete on public.game_broadcast to authenticated;

create or replace function public.game_broadcast_touch() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists game_broadcast_touch on public.game_broadcast;
create trigger game_broadcast_touch before update on public.game_broadcast
  for each row execute function public.game_broadcast_touch();

do $$ begin
  alter publication supabase_realtime add table public.game_broadcast;
exception when duplicate_object then null; end $$;
