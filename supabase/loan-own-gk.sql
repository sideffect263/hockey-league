-- Loans: an own goalkeeper who signed up closes the goalkeeper slot (2026-10-15).
--
-- Until now the keeper slot only counted LOANED keepers, so a team whose own keeper said
-- "מגיע" was still offered "אפשר להשאיל רק שוער". One keeper per side: own or loaned.

create or replace function public.loan_own_gk(p_game_id uuid, p_team_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
    from public.game_availability ga
    join public.players pl on pl.id = ga.player_id
   where ga.game_id = p_game_id and ga.status = 'available'
     and pl."position" = 'Goalkeeper'
     and public.on_team_roster(ga.player_id, p_team_id)
     and (ga.team_id is null or ga.team_id = p_team_id)
$$;

create or replace function public.loan_gk_slots(p_game_id uuid, p_team_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select case when public.loan_own_gk(p_game_id, p_team_id) > 0
                or (select c.loan_gk from public.loan_counts(p_game_id, p_team_id) c) >= 1
              then 0 else 1 end
$$;

create or replace function public.loan_slot_block(p_game_id uuid, p_team_id uuid, p_position text)
returns text language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from public.loan_counts(p_game_id, p_team_id);
  if p_position = 'Goalkeeper' then
    if public.loan_own_gk(p_game_id, p_team_id) > 0 then return 'gk_own'; end if;
    return case when c.loan_gk >= 1 then 'gk_full' end;
  end if;
  return case when c.own_field + c.loan_field >= 5 then 'squad_full' end;
end $$;

create or replace function public.loan_summary(p_game_id uuid, p_team_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c record; lc record; v_own_gk int;
begin
  if not (public.is_admin() or public.is_league_manager() or public.is_judge()
          or public.is_coach_of(p_team_id)) then
    raise exception 'not authorized';
  end if;
  select * into c from public.loan_counts(p_game_id, p_team_id);
  v_own_gk := public.loan_own_gk(p_game_id, p_team_id);
  select * into lc from public.loan_calls where game_id = p_game_id and team_id = p_team_id;
  return jsonb_build_object(
    'own_field', c.own_field, 'loan_field', c.loan_field, 'loan_gk', c.loan_gk,
    'own_gk', v_own_gk,
    'field_target', 5,
    'field_slots', greatest(0, 5 - c.own_field - c.loan_field),
    'gk_slots', case when v_own_gk > 0 or c.loan_gk >= 1 then 0 else 1 end,
    'open', public.loan_game_open(p_game_id),
    'call', case when lc.game_id is null then null
                 else jsonb_build_object('need_field', lc.need_field, 'need_gk', lc.need_gk, 'note', lc.note) end,
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'player_id', r.player_id, 'status', r.status, 'note', r.note,
               'initiated_by', r.initiated_by,
               'created_at', r.created_at, 'responded_at', r.responded_at,
               'player_name', btrim(coalesce(pl.first_name, '') || ' ' || coalesce(pl.last_name, '')),
               'position', pl."position", 'team_name', t.name, 'age', public.player_age(pl.birth_date))
             order by r.created_at desc)
        from public.loan_requests r
        join public.players pl on pl.id = r.player_id
        left join public.teams t on t.id = pl.team_id
       where r.game_id = p_game_id and r.team_id = p_team_id), '[]'::jsonb));
end $$;

create or replace function public.loan_board()
returns table(game_id uuid, game_date timestamptz, venue text, home_team_id uuid, away_team_id uuid,
              home_team text, away_team text, team_id uuid, team_name text, team_logo text,
              need_field boolean, need_gk boolean, field_slots int, gk_slots int, note text,
              my_block text, my_request_id uuid, my_request_status text, my_request_by text)
language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid; v_test boolean;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  v_pid := public.my_player_id();
  v_test := public.is_admin() or public.is_sandbox_user();
  return query
  with open_calls as (
    select lc.*, g.game_date as gd, g.venue as gv, g.home_team_id as hid, g.away_team_id as aid,
           s.field_slots as fs, s.gk_slots as gs
      from public.loan_calls lc
      join public.games g on g.id = lc.game_id
      join public.teams t on t.id = lc.team_id
      cross join lateral (
        select greatest(0, 5 - c.own_field - c.loan_field) as field_slots,
               public.loan_gk_slots(lc.game_id, lc.team_id) as gk_slots
          from public.loan_counts(lc.game_id, lc.team_id) c
      ) s
     where public.loan_game_open(lc.game_id)
       and (coalesce(t.is_test, false) = false or v_test)
  )
  select oc.game_id, oc.gd, oc.gv, oc.hid, oc.aid, th.name, ta.name, oc.team_id, t.name, t.logo_url,
         oc.need_field and oc.fs > 0, oc.need_gk and oc.gs > 0, oc.fs, oc.gs, oc.note,
         case when v_pid is null then 'no_player'
              else public.loan_block_reason(oc.game_id, oc.team_id, v_pid) end,
         lr.id, lr.status, lr.initiated_by
    from open_calls oc
    join public.teams th on th.id = oc.hid
    join public.teams ta on ta.id = oc.aid
    join public.teams t on t.id = oc.team_id
    left join lateral (
      select r.id, r.status, r.initiated_by from public.loan_requests r
       where r.game_id = oc.game_id and r.team_id = oc.team_id and r.player_id = v_pid
       order by r.created_at desc limit 1
    ) lr on true
   where (oc.need_field and oc.fs > 0) or (oc.need_gk and oc.gs > 0)
      or lr.status in ('pending', 'accepted')
   order by oc.gd, t.name;
end $$;

revoke all on function public.loan_own_gk(uuid, uuid) from public, anon, authenticated;
revoke all on function public.loan_gk_slots(uuid, uuid) from public, anon, authenticated;
