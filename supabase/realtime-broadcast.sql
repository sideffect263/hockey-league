-- Live-game realtime over Broadcast instead of postgres_changes (2026-10-15).
--
-- postgres_changes checks every change against every subscriber's RLS, one at a time, on the
-- database — it was the heaviest thing the DB did, and it caps a big game's audience. Broadcast
-- fans one message out from the Realtime server with no per-viewer DB work.
--
-- Topics are PUBLIC (anon spectators listen), so a payload may only carry what anon can already
-- SELECT. Two RLS rules decide that:
--   * test games are hidden from non-admins → test-game messages are a bare ping (no row); the
--     client refetches through RLS, so admins still see their test games update.
--   * game_videos has hidden cameras → video messages are always a bare ping.
--
-- Topics (client: src/lib/realtimeTopics.js):
--   live:all        event 'change'    ping — some game's live state changed
--   live:<game>     event 'state'     { row } live_game_state row, row=null on delete; or { ping }
--   bcast:<game>    event 'settings'  { row } game_broadcast row; or { ping }
--   video:<game>    event 'change'    ping
--
-- The tables stay in the supabase_realtime publication so already-installed clients that still
-- use postgres_changes keep working. Undo: realtime-broadcast-down.sql.

create or replace function public.rt_send(p_topic text, p_event text, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(p_payload, p_event, p_topic, false);
exception when others then
  -- Never let a realtime hiccup fail the judge's score write.
  raise warning 'rt_send % failed: %', p_topic, sqlerrm;
end $$;
revoke all on function public.rt_send(text, text, jsonb) from public, anon, authenticated;

create or replace function public.rt_live_game_state() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g uuid := coalesce(new.game_id, old.game_id);
  test boolean := g is not null and public.is_test_game(g);
begin
  perform public.rt_send('live:all', 'change', '{}'::jsonb);
  if g is not null then
    -- A row over ~200 KB (a long event log in `state`) would hit Realtime's message cap: ping instead.
    perform public.rt_send('live:' || g, 'state',
      case when test or (tg_op <> 'DELETE' and octet_length(to_jsonb(new)::text) > 200000)
             then jsonb_build_object('ping', true)
           when tg_op = 'DELETE' then jsonb_build_object('row', null)
           else jsonb_build_object('row', to_jsonb(new)) end);
  end if;
  return null;
end $$;

create or replace function public.rt_game_broadcast() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g uuid := coalesce(new.game_id, old.game_id);
begin
  perform public.rt_send('bcast:' || g, 'settings',
    case when public.is_test_game(g) then jsonb_build_object('ping', true)
         when tg_op = 'DELETE' then jsonb_build_object('row', null)
         else jsonb_build_object('row', to_jsonb(new)) end);
  return null;
end $$;

create or replace function public.rt_game_videos() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g uuid := coalesce(new.game_id, old.game_id);
begin
  if g is not null then
    perform public.rt_send('video:' || g, 'change', '{}'::jsonb);
  end if;
  return null;
end $$;

revoke all on function public.rt_live_game_state() from public, anon, authenticated;
revoke all on function public.rt_game_broadcast() from public, anon, authenticated;
revoke all on function public.rt_game_videos() from public, anon, authenticated;

drop trigger if exists zz_rt_broadcast on public.live_game_state;
create trigger zz_rt_broadcast after insert or update or delete on public.live_game_state
  for each row execute function public.rt_live_game_state();

drop trigger if exists zz_rt_broadcast on public.game_broadcast;
create trigger zz_rt_broadcast after insert or update or delete on public.game_broadcast
  for each row execute function public.rt_game_broadcast();

drop trigger if exists zz_rt_broadcast on public.game_videos;
create trigger zz_rt_broadcast after insert or update or delete on public.game_videos
  for each row execute function public.rt_game_videos();
