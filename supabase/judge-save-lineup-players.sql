-- 2026-10-01: the judge board can now borrow players from other teams for a game
-- (game-day lineup editor), and rosters come from player_teams — so a player whose
-- PRIMARY team_id is neither side (multi-team member, borrowed player) is legit.
-- The old check rejected the WHOLE save for such a row. Now: the player must exist.
-- Only admins/judges can call this, and they are the ones who saw who played.
create or replace function public.judge_save_game_result(p_game_id uuid, p_home_score integer, p_away_score integer, p_stats jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  g public.games;
  bad int;
begin
  if not (public.is_admin() or public.is_judge()) then raise exception 'not authorized to score games'; end if;
  if p_home_score is null or p_away_score is null or p_home_score < 0 or p_away_score < 0 or p_home_score > 50 or p_away_score > 50 then
    raise exception 'invalid score (must be 0..50)';
  end if;
  select * into g from public.games where id = p_game_id for update;
  if not found then raise exception 'game not found'; end if;
  if g.status = 'completed' then raise exception 'game already completed'; end if;
  select count(*) into bad
  from jsonb_array_elements(coalesce(p_stats, '[]'::jsonb)) r
  where (r->>'player_id') is not null
    and (
      not exists (select 1 from public.players pl where pl.id = (r->>'player_id')::uuid)
      or coalesce((r->>'goals')::int, 0) < 0 or coalesce((r->>'blue_cards')::int, 0) < 0 or coalesce((r->>'red_cards')::int, 0) < 0
    );
  if bad > 0 then raise exception 'box score has % invalid row(s) (unknown player, or negative count)', bad; end if;
  delete from public.game_stats where game_id = p_game_id;
  insert into public.game_stats (game_id, player_id, goals, blue_cards, red_cards, clean_sheet)
  select p_game_id, (r->>'player_id')::uuid,
         coalesce((r->>'goals')::int, 0), coalesce((r->>'blue_cards')::int, 0),
         coalesce((r->>'red_cards')::int, 0), coalesce((r->>'clean_sheet')::boolean, false)
  from jsonb_array_elements(coalesce(p_stats, '[]'::jsonb)) r
  where (r->>'player_id') is not null;
  update public.games set home_score = p_home_score, away_score = p_away_score, status = 'completed' where id = p_game_id;
  perform public.recompute_team_standings(g.home_team_id);
  perform public.recompute_team_standings(g.away_team_id);
  delete from public.live_game_state where game_id = p_game_id;
end;
$function$;
