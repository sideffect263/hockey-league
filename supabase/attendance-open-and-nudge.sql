-- attendance-open-and-nudge.sql  (2026-10-08, Ziv's asks)
-- ---------------------------------------------------------------------------
-- 1. game_attendance(game) — every SIGNED-IN user may see who is coming / not
--    coming on BOTH teams of a fixture ("as a player and as a viewer"). Status
--    only: no notes, no absence reasons, no medical state — those stay behind
--    the coach/admin RLS on game_availability. Test games stay hidden.
--
-- 2. coach_nudge_game(game, team) — the coach (or admin / league manager)
--    pushes a game_register_nudge to that team's players who have NOT answered
--    and could answer (can_register_for_game). Reuses the existing nudge type,
--    so no new copy/routing on the four notification surfaces. game_reminder_log
--    (kind 'coach_nudge', sent_for = today) caps it at one nudge per player per
--    game per day, however often the button is pressed.
-- ---------------------------------------------------------------------------

create or replace function public.game_attendance(p_game_id uuid)
returns table (player_id uuid, status text, team_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if public.is_test_game(p_game_id) and not coalesce(public.can_see_test(), false) then
    return;
  end if;
  return query
    select ga.player_id, ga.status::text, ga.team_id
      from public.game_availability ga
     where ga.game_id = p_game_id;
end $$;

revoke all on function public.game_attendance(uuid) from public, anon;
grant execute on function public.game_attendance(uuid) to authenticated;

create or replace function public.coach_nudge_game(p_game_id uuid, p_team_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  g    record;
  rec  record;
  base jsonb;
  n    int := 0;
begin
  if not (coalesce(public.is_admin(), false)
          or coalesce(public.is_league_manager(), false)
          or coalesce(public.is_coach_of(p_team_id), false)) then
    raise exception 'not authorized';
  end if;

  select gm.id, gm.game_date, gm.status, gm.home_team_id, gm.away_team_id,
         th.name as home_name, ta.name as away_name
    into g
    from public.games gm
    left join public.teams th on th.id = gm.home_team_id
    left join public.teams ta on ta.id = gm.away_team_id
   where gm.id = p_game_id;
  if not found then raise exception 'game not found'; end if;
  if p_team_id not in (g.home_team_id, g.away_team_id) then raise exception 'team not in game'; end if;
  if g.status <> 'scheduled' or g.game_date < now() then raise exception 'game not upcoming'; end if;

  base := jsonb_build_object('home_team', coalesce(g.home_name, ''),
                             'away_team', coalesce(g.away_name, ''),
                             'game_date', g.game_date);

  for rec in
    select distinct pr.id as user_id
      from public.players p
      join public.profiles pr on pr.player_id = p.id
     where (p.team_id = p_team_id
            or exists (select 1 from public.player_teams pt
                        where pt.player_id = p.id and pt.team_id = p_team_id))
       and public.can_register_for_game(p.id, g.id)
       and not exists (select 1 from public.game_availability ga
                        where ga.game_id = g.id and ga.player_id = p.id)
  loop
    insert into public.game_reminder_log (game_id, kind, user_id, sent_for)
    values (p_game_id, 'coach_nudge', rec.user_id, current_date) on conflict do nothing;
    if found then
      perform public.create_notification(rec.user_id, 'game_register_nudge', auth.uid(),
                                         'game', p_game_id::text, base);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

revoke all on function public.coach_nudge_game(uuid, uuid) from public, anon;
grant execute on function public.coach_nudge_game(uuid, uuid) to authenticated;
