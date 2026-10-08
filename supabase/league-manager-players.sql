-- league-manager-players.sql
-- ---------------------------------------------------------------------------
-- League managers are GLOBAL (not team-scoped), but players/player_teams writes
-- were admin- or own-team-coach-only. A manager could open /admin שחקנים yet
-- not move a player between teams (Itai, 2026-10-04: Marcelo מוצקין → רמת ישי).
--
-- Grants managers INSERT/UPDATE on players and full write on player_teams
-- (the editor's membership sync deletes + inserts rows). Deliberately NOT
-- DELETE on players: a player delete CASCADES game_stats, so it stays admin-only;
-- a manager "removes" a player by clearing their teams (free agent).
-- ---------------------------------------------------------------------------

drop policy if exists "Manager insert players" on public.players;
create policy "Manager insert players" on public.players
  for insert with check (public.is_league_manager());

drop policy if exists "Manager update players" on public.players;
create policy "Manager update players" on public.players
  for update using (public.is_league_manager()) with check (public.is_league_manager());

drop policy if exists "Manager write player_teams" on public.player_teams;
create policy "Manager write player_teams" on public.player_teams
  for all using (public.is_league_manager()) with check (public.is_league_manager());
