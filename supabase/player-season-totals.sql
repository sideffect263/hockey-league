-- Derived season totals, maintained by the database (2026-10-10, after the opener).
--
-- players.goals / blue_cards / red_cards / games_played and
-- teams.wins / losses / ties / points / goals_for / goals_against are what every
-- stats page and the standings table read. Before this:
--   * players.* were only written by a manual client recalc that never ran, so
--     after the 2026-27 opener every player read 0;
--   * teams.* were recomputed by SOME result paths (judge save, game-form apply)
--     but not others (calendar delete, reopening a completed game, an admin edit
--     that failed half-way);
--   * the admin player/team edit forms wrote back whatever totals they had loaded,
--     silently reverting results that landed in between.
--
-- Now: (1) totals are recomputed by triggers from games / game_stats /
-- game_availability; (2) client roles can no longer write them at all.

-- ---------------------------------------------------------------------------
-- Players. Counts the games the site counts (countsForStats): completed, current
-- season, not test, not friendly, not tournament; playoffs DO count (team
-- standings are league-only, by design).
--
-- games_played = games the player is on the box score of OR confirmed "מגיע"
-- for. The box score alone only has scorers/carded players (the boards and the
-- paper form never write a row for someone who just played), which undercounted
-- almost everybody.
create or replace function public.recompute_player_season_stats(p_player_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  with ok as (
    select id from public.games
     where status = 'completed'
       and season_id = public.current_season_id()
       and not coalesce(is_test, false)
       and game_type is distinct from 'ידידותי'
       and tournament_id is null
  ),
  st as (
    select s.player_id,
           sum(coalesce(s.goals, 0))      as goals,
           sum(coalesce(s.blue_cards, 0)) as blue_cards,
           sum(coalesce(s.red_cards, 0))  as red_cards
      from public.game_stats s
     where s.game_id in (select id from ok) and s.player_id is not null
       and (p_player_ids is null or s.player_id = any(p_player_ids))
     group by s.player_id
  ),
  gp as (
    select player_id, count(distinct game_id) as n from (
      select player_id, game_id from public.game_stats
       where game_id in (select id from ok) and player_id is not null
      union
      select player_id, game_id from public.game_availability
       where game_id in (select id from ok) and status = 'available'
    ) x
     where p_player_ids is null or player_id = any(p_player_ids)
     group by player_id
  ),
  tot as (
    select p.id,
           coalesce(st.goals, 0) as goals, coalesce(st.blue_cards, 0) as blue_cards,
           coalesce(st.red_cards, 0) as red_cards, coalesce(gp.n, 0) as games_played
      from public.players p
      left join st on st.player_id = p.id
      left join gp on gp.player_id = p.id
     where p_player_ids is null or p.id = any(p_player_ids)
  )
  update public.players p
     set goals = t.goals, blue_cards = t.blue_cards,
         red_cards = t.red_cards, games_played = t.games_played
    from tot t
   where p.id = t.id
     and (p.goals, p.blue_cards, p.red_cards, p.games_played)
         is distinct from (t.goals, t.blue_cards, t.red_cards, t.games_played);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.recompute_player_season_stats(uuid[]) from public, anon, authenticated;

-- Box score written / edited / deleted (judge save, stats editor, game-form apply,
-- game delete via cascade).
create or replace function public.trg_game_stats_player_totals()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct player_id) into v_ids from new_rows where player_id is not null;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct player_id) into v_ids from old_rows where player_id is not null;
  else
    select array_agg(distinct player_id) into v_ids from (
      select player_id from new_rows union select player_id from old_rows) x where player_id is not null;
  end if;
  if v_ids is not null then perform public.recompute_player_season_stats(v_ids); end if;
  return null;
end $$;

drop trigger if exists trg_game_stats_totals_ins on public.game_stats;
drop trigger if exists trg_game_stats_totals_upd on public.game_stats;
drop trigger if exists trg_game_stats_totals_del on public.game_stats;
create trigger trg_game_stats_totals_ins after insert on public.game_stats
  referencing new table as new_rows for each statement execute function public.trg_game_stats_player_totals();
create trigger trg_game_stats_totals_upd after update on public.game_stats
  referencing new table as new_rows old table as old_rows for each statement execute function public.trg_game_stats_player_totals();
create trigger trg_game_stats_totals_del after delete on public.game_stats
  referencing old table as old_rows for each statement execute function public.trg_game_stats_player_totals();

-- Attendance feeds games_played. Same function shape (new_rows / old_rows).
drop trigger if exists trg_game_availability_totals_ins on public.game_availability;
drop trigger if exists trg_game_availability_totals_upd on public.game_availability;
drop trigger if exists trg_game_availability_totals_del on public.game_availability;
create trigger trg_game_availability_totals_ins after insert on public.game_availability
  referencing new table as new_rows for each statement execute function public.trg_game_stats_player_totals();
create trigger trg_game_availability_totals_upd after update on public.game_availability
  referencing new table as new_rows old table as old_rows for each statement execute function public.trg_game_stats_player_totals();
create trigger trg_game_availability_totals_del after delete on public.game_availability
  referencing old table as old_rows for each statement execute function public.trg_game_stats_player_totals();

-- ---------------------------------------------------------------------------
-- A game changing: recompute both teams' standings (old AND new teams, so a
-- swapped fixture fixes the team it left) and the players on its box score /
-- attendance. Covers every path — judge save, form apply, admin edit, calendar
-- delete, reopen, expiry — so no caller has to remember to.
create or replace function public.trg_games_derived_totals()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_team uuid; v_ids uuid[]; v_game uuid;
begin
  for v_team in
    select distinct x from unnest(array[
      case when tg_op <> 'INSERT' then old.home_team_id end,
      case when tg_op <> 'INSERT' then old.away_team_id end,
      case when tg_op <> 'DELETE' then new.home_team_id end,
      case when tg_op <> 'DELETE' then new.away_team_id end]) x
     where x is not null
  loop
    perform public.recompute_team_standings(v_team);
  end loop;

  -- On DELETE the game_stats cascade already recomputed its players; attendance
  -- rows cascade too, so only UPDATE needs the player pass.
  if tg_op = 'UPDATE' then
    v_game := new.id;
    select array_agg(distinct player_id) into v_ids from (
      select player_id from public.game_stats where game_id = v_game
      union select player_id from public.game_availability where game_id = v_game) x
     where player_id is not null;
    if v_ids is not null then perform public.recompute_player_season_stats(v_ids); end if;
  end if;
  return null;
end $$;

drop trigger if exists trg_games_player_totals on public.games;
drop function if exists public.trg_games_player_totals();
drop trigger if exists trg_games_derived_totals_upd on public.games;
drop trigger if exists trg_games_derived_totals_insdel on public.games;
create trigger trg_games_derived_totals_upd
  after update of status, home_score, away_score, game_type, season_id, is_test,
                  tournament_id, home_team_id, away_team_id on public.games
  for each row
  when (old.status is distinct from new.status
        or old.home_score is distinct from new.home_score or old.away_score is distinct from new.away_score
        or old.game_type is distinct from new.game_type or old.season_id is distinct from new.season_id
        or old.is_test is distinct from new.is_test or old.tournament_id is distinct from new.tournament_id
        or old.home_team_id is distinct from new.home_team_id or old.away_team_id is distinct from new.away_team_id)
  execute function public.trg_games_derived_totals();
create trigger trg_games_derived_totals_insdel
  after insert or delete on public.games
  for each row execute function public.trg_games_derived_totals();

-- ---------------------------------------------------------------------------
-- Client roles cannot write derived totals. Every legitimate writer
-- (recompute_*, close_season) is SECURITY DEFINER and so runs as the function
-- owner, not as `authenticated`. An admin edit form that sends stale totals along
-- with a rename now just has those fields ignored.
create or replace function public.trg_players_guard_totals()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.goals := 0; new.blue_cards := 0; new.red_cards := 0; new.games_played := 0;
    else
      new.goals := old.goals; new.blue_cards := old.blue_cards;
      new.red_cards := old.red_cards; new.games_played := old.games_played;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_players_guard_totals on public.players;
create trigger trg_players_guard_totals before insert or update on public.players
  for each row execute function public.trg_players_guard_totals();

create or replace function public.trg_teams_guard_standings()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.wins := 0; new.losses := 0; new.ties := 0; new.points := 0;
      new.goals_for := 0; new.goals_against := 0;
    else
      new.wins := old.wins; new.losses := old.losses; new.ties := old.ties;
      new.points := old.points; new.goals_for := old.goals_for; new.goals_against := old.goals_against;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_teams_guard_standings on public.teams;
create trigger trg_teams_guard_standings before insert or update on public.teams
  for each row execute function public.trg_teams_guard_standings();
