-- Approving a fan's stream tells the fan (2026-10-25): the fan waiting room.
--
-- Before, an approved fan only found out by pressing "שדר" again. Now approval inserts a
-- 'stream_approved' notification (bell + push via trg_notify_push). The push opens the
-- game with section "broadcast" (send-push): new apps go on to the broadcast screen,
-- older ones stay on the game page. The app's own waiting screen polls and goes live by itself; the
-- push is for a fan who left that screen. Only a change TO approved notifies.
-- Same function as stream-requests.sql plus that insert.

create or replace function public.decide_stream_request(p_id uuid, p_approve boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_before text;
  r record;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'only the admin can approve streams' using errcode = '42501';
  end if;
  select status into v_before from public.stream_requests where id = p_id;
  update public.stream_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_at = now(), decided_by = auth.uid(), updated_at = now()
   where id = p_id
  returning status into v_status;
  if v_status is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  if v_status = 'approved' and v_before is distinct from 'approved' then
    select s.user_id, s.game_id, ht.name as home_team, at.name as away_team into r
      from public.stream_requests s
      join public.games g on g.id = s.game_id
      left join public.teams ht on ht.id = g.home_team_id
      left join public.teams at on at.id = g.away_team_id
     where s.id = p_id;
    insert into public.notifications (user_id, type, actor_id, entity_type, entity_id, data)
    values (r.user_id, 'stream_approved', auth.uid(), 'game', r.game_id::text,
            jsonb_build_object('home_team', r.home_team, 'away_team', r.away_team));
  end if;
  return v_status;
end $$;
revoke all on function public.decide_stream_request(uuid, boolean) from public, anon;
grant execute on function public.decide_stream_request(uuid, boolean) to authenticated;
