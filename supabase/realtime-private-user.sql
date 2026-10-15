-- Per-user realtime (bell + DMs) over PRIVATE Broadcast instead of postgres_changes (2026-10-15).
--
-- Same reason as realtime-broadcast.sql: postgres_changes runs every insert past every
-- subscriber's RLS on the database. These were the last two web features still on it.
--
-- Topics are PRIVATE: Realtime only lets a socket join `user:<uid>` when the RLS policy below
-- says so, i.e. the JWT's sub is that uid. So a payload may carry exactly what that user can
-- already SELECT — and both rows qualify:
--   * notifications    "read own notifications"  user_id = auth.uid()          → sent to user:<user_id>
--   * direct_messages  "read own dms"            recipient_id = auth.uid() ... → sent to user:<recipient_id>
--
-- Topics (client: src/lib/realtimeTopics.js, listenPrivateTopic):
--   user:<uid>   event 'notification'   { row } notifications row; or { ping } if the row is huge
--   user:<uid>   event 'dm'             { row } direct_messages row (body is capped at 2000 chars)
--
-- Both tables stay in the supabase_realtime publication so already-installed clients that still
-- use postgres_changes keep working. Undo: realtime-private-user-down.sql.

create or replace function public.rt_send_private(p_topic text, p_event text, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(p_payload, p_event, p_topic, true);
exception when others then
  -- Never let a realtime hiccup fail the notification / message insert.
  raise warning 'rt_send_private % failed: %', p_topic, sqlerrm;
end $$;
revoke all on function public.rt_send_private(text, text, jsonb) from public, anon, authenticated;

create or replace function public.rt_notifications() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null then
    -- `data` is free-form jsonb: a row over ~200 KB would hit Realtime's message cap → ping.
    perform public.rt_send_private('user:' || new.user_id, 'notification',
      case when octet_length(to_jsonb(new)::text) > 200000 then jsonb_build_object('ping', true)
           else jsonb_build_object('row', to_jsonb(new)) end);
  end if;
  return null;
end $$;

create or replace function public.rt_direct_messages() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.recipient_id is not null then
    perform public.rt_send_private('user:' || new.recipient_id, 'dm',
      jsonb_build_object('row', to_jsonb(new)));
  end if;
  return null;
end $$;

revoke all on function public.rt_notifications() from public, anon, authenticated;
revoke all on function public.rt_direct_messages() from public, anon, authenticated;

drop trigger if exists zz_rt_private on public.notifications;
create trigger zz_rt_private after insert on public.notifications
  for each row execute function public.rt_notifications();

drop trigger if exists zz_rt_private on public.direct_messages;
create trigger zz_rt_private after insert on public.direct_messages
  for each row execute function public.rt_direct_messages();

-- Who may RECEIVE on a private topic: only the owner of `user:<uid>`, broadcast only (no
-- presence). There is deliberately no INSERT policy — clients cannot send on these topics;
-- only the triggers above (security definer) write to realtime.messages.
drop policy if exists "rt user topic: own only" on realtime.messages;
create policy "rt user topic: own only" on realtime.messages
  for select to authenticated
  using (
    (select realtime.topic()) = 'user:' || (select auth.uid())::text
    and realtime.messages.extension = 'broadcast'
  );
