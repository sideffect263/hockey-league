-- 2026-10-09 (LIVE, read-only): who may play in this game — for the three judge boards.
-- Both rosters (players.team_id + player_teams) + manual squad adds; suspension (not issued for
-- this game) and an approved medical valid ON THE GAME DATE. Admin / LM / judge only.
create or replace function public.game_player_eligibility(p_game_id uuid)
returns table(player_id uuid, team_id uuid, suspended boolean, suspension_games_remaining integer,
              medical_valid boolean, medical_expires_at date)
language plpgsql stable security definer set search_path = public as $$
declare g record;
begin
  if not (public.is_admin() or public.is_league_manager() or public.is_judge()) then
    raise exception 'not authorized';
  end if;
  select id, home_team_id, away_team_id, game_date into g from public.games where id = p_game_id;
  if g.id is null then return; end if;
  return query
  with squad as (
    select p.id pid, p.team_id tid from public.players p where p.team_id in (g.home_team_id, g.away_team_id)
    union
    select pt.player_id, pt.team_id from public.player_teams pt where pt.team_id in (g.home_team_id, g.away_team_id)
    union
    select ga.player_id, ga.team_id from public.game_availability ga
     where ga.game_id = p_game_id and ga.team_id in (g.home_team_id, g.away_team_id)
  ), one as (
    select distinct on (s.pid) s.pid, coalesce(ga.team_id, s.tid) tid
      from squad s left join public.game_availability ga on ga.game_id = p_game_id and ga.player_id = s.pid
     order by s.pid, (ga.team_id = s.tid) desc nulls last
  )
  select o.pid, o.tid,
         exists (select 1 from public.player_suspensions su where su.player_id = o.pid
                  and su.cleared_at is null and su.games_remaining > 0
                  and su.issued_game_id is distinct from p_game_id),
         (select max(su.games_remaining) from public.player_suspensions su where su.player_id = o.pid
                  and su.cleared_at is null and su.games_remaining > 0
                  and su.issued_game_id is distinct from p_game_id),
         exists (select 1 from public.medical_certificates mc where mc.player_id = o.pid
                  and mc.status = 'approved'
                  and (mc.expires_at is null or mc.expires_at >= (g.game_date at time zone 'Asia/Jerusalem')::date)),
         (select max(mc.expires_at)::date from public.medical_certificates mc
           where mc.player_id = o.pid and mc.status = 'approved')
    from one o;
end; $$;
revoke all on function public.game_player_eligibility(uuid) from public, anon;
grant execute on function public.game_player_eligibility(uuid) to authenticated;
