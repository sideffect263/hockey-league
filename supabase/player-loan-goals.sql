-- Goals scored on loan this season, per player (2026-10-12).
--
-- players.goals is the player's whole season (recompute_player_season_stats) — loan games
-- included, because they are his goals. The team page wants to split that: goals for his
-- own team, and goals as a loaned player. A loan line is a game_stats row with
-- played_for_team_id set (game_stats_fill_played_for sets it only when he is on neither
-- side's roster). Same game filter as recompute_player_season_stats, so the two add up.
-- Public: it is the same data the box scores already show.
create or replace function public.player_loan_goals(p_player_ids uuid[])
returns table(player_id uuid, loan_goals int, loan_games int)
language sql stable security definer set search_path = public as $$
  select s.player_id, sum(coalesce(s.goals, 0))::int, count(distinct s.game_id)::int
    from public.game_stats s
    join public.games g on g.id = s.game_id
   where s.player_id = any(p_player_ids)
     and s.played_for_team_id is not null
     and g.status = 'completed'
     and g.season_id = public.current_season_id()
     and not coalesce(g.is_test, false)
     and g.game_type is distinct from 'ידידותי'
     and g.tournament_id is null
   group by s.player_id
$$;
revoke all on function public.player_loan_goals(uuid[]) from public;
grant execute on function public.player_loan_goals(uuid[]) to anon, authenticated;
