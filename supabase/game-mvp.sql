-- game-mvp.sql  (2026-10-08, Yarden's idea: "the referee picks a game MVP and it counts in the stats")
-- ---------------------------------------------------------------------------
-- games.mvp_player_id — one MVP per game, set through set_game_mvp() only (no
-- direct column write path is added). Who may set it: admin, league manager, or
-- a judge. The player must have played: a game_stats row for this game, or be on
-- either team's roster (players.team_id / player_teams). NULL clears it.
-- Counted in the stats like everything else: friendly / test games excluded on the
-- client by the same countsForStats filter.
-- ---------------------------------------------------------------------------

alter table public.games
  add column if not exists mvp_player_id uuid references public.players(id) on delete set null;

create index if not exists games_mvp_player_id_idx on public.games(mvp_player_id);

create or replace function public.set_game_mvp(p_game_id uuid, p_player_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare g record;
begin
  if not (coalesce(public.is_admin(), false)
          or coalesce(public.is_league_manager(), false)
          or coalesce(public.is_judge(), false)) then
    raise exception 'not authorized';
  end if;
  select id, home_team_id, away_team_id into g from public.games where id = p_game_id;
  if not found then raise exception 'game not found'; end if;
  if p_player_id is not null and not (
       exists (select 1 from public.game_stats s where s.game_id = p_game_id and s.player_id = p_player_id)
    or exists (select 1 from public.players p where p.id = p_player_id
                  and p.team_id in (g.home_team_id, g.away_team_id))
    or exists (select 1 from public.player_teams pt where pt.player_id = p_player_id
                  and pt.team_id in (g.home_team_id, g.away_team_id))
  ) then
    raise exception 'player not in game';
  end if;
  update public.games set mvp_player_id = p_player_id where id = p_game_id;
end $$;

revoke all on function public.set_game_mvp(uuid, uuid) from public, anon;
grant execute on function public.set_game_mvp(uuid, uuid) to authenticated;
