-- players.goals / blue_cards / red_cards / games_played = CURRENT-SEASON totals
-- (archive_season zeroes them at rollover). Every stats page reads these columns,
-- but nothing kept them up to date: the client's recalculatePlayerStats() was
-- manual-only, so after the 2026-27 opener every card still read 0.
--
-- Now derived from game_stats automatically. Counts the same games the site
-- does (countsForStats + standings): completed, active season, not a test game,
-- not a friendly, not a tournament game. Playoffs count.

create or replace function public.recompute_player_season_stats(p_player_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_season uuid; v_n integer;
begin
  select id into v_season from public.seasons where status = 'active' order by created_at desc limit 1;

  with tot as (
    select s.player_id,
           coalesce(sum(s.goals), 0)      as goals,
           coalesce(sum(s.blue_cards), 0) as blue_cards,
           coalesce(sum(s.red_cards), 0)  as red_cards,
           count(*)                       as games_played
      from public.game_stats s
      join public.games g on g.id = s.game_id
     where s.player_id is not null
       and g.status = 'completed'
       and g.season_id is not distinct from v_season
       and not coalesce(g.is_test, false)
       and g.game_type is distinct from 'ידידותי'
       and g.tournament_id is null
       and (p_player_ids is null or s.player_id = any(p_player_ids))
     group by s.player_id
  )
  update public.players p
     set goals        = coalesce(t.goals, 0),
         blue_cards   = coalesce(t.blue_cards, 0),
         red_cards    = coalesce(t.red_cards, 0),
         games_played = coalesce(t.games_played, 0)
    from public.players p2
    left join tot t on t.player_id = p2.id
   where p.id = p2.id
     and (p_player_ids is null or p.id = any(p_player_ids))
     and (p.goals, p.blue_cards, p.red_cards, p.games_played)
         is distinct from (coalesce(t.goals, 0), coalesce(t.blue_cards, 0),
                           coalesce(t.red_cards, 0), coalesce(t.games_played, 0));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.recompute_player_season_stats(uuid[]) from public, anon, authenticated;

-- Box score written / edited / deleted (judge save, stats editor, game-form apply).
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

-- A game changing whether it counts (completed / un-completed, type, season, test flag).
create or replace function public.trg_games_player_totals()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_ids uuid[];
begin
  select array_agg(distinct player_id) into v_ids
    from public.game_stats where game_id = new.id and player_id is not null;
  if v_ids is not null then perform public.recompute_player_season_stats(v_ids); end if;
  return null;
end $$;

drop trigger if exists trg_games_player_totals on public.games;
create trigger trg_games_player_totals
  after update of status, game_type, season_id, is_test, tournament_id on public.games
  for each row
  when (old.status is distinct from new.status or old.game_type is distinct from new.game_type
        or old.season_id is distinct from new.season_id or old.is_test is distinct from new.is_test
        or old.tournament_id is distinct from new.tournament_id)
  execute function public.trg_games_player_totals();
