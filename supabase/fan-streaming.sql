-- Multi-camera phase 3 (2026-10-11): any signed-in user may go live from the app.
--
-- can_stream_game() stays what it was (content editor + admin): it is ALSO the write
-- policy on game_videos (rename, hide, delete any video), so it must not widen. Going
-- live gets its own rule instead, used only by stream-golive:
--   can_broadcast_game(game) = staff (can_stream_game), or any signed-in user on a game
--   that isn't over, from 6h before kick-off; test games stay admin-only.
-- A fan's row is inserted by stream-golive with the service role (fans have no write
-- policy) and starts hidden until the admin approves the camera (game_videos_guard_hidden).
-- Fans may delete only their own never-aired row (still on its live input) — that is
-- what the apps do when a start fails; a recording is never theirs to remove.

create or replace function public.can_broadcast_game(p_game_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    public.can_stream_game(p_game_id)
    or (
      auth.uid() is not null
      and exists (
        select 1 from public.games g
        where g.id = p_game_id
          and g.status <> 'completed'
          and g.game_date > now() - interval '12 hours'
          and g.game_date < now() + interval '6 hours'
          and (not coalesce(g.is_test, false) or public.can_see_test())
      )
    ), false)
$$;
revoke all on function public.can_broadcast_game(uuid) from public;
grant execute on function public.can_broadcast_game(uuid) to authenticated;

drop policy if exists "Streamer deletes own unaired video" on public.game_videos;
create policy "Streamer deletes own unaired video" on public.game_videos for delete
  using (created_by = (select auth.uid()) and cf_live_input is not null and video_id = cf_live_input);
