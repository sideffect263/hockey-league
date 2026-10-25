-- 2026-10-25: a saved game kept ONLY the players who scored or got a card. The boards sent
-- engine.boxScore() — goals + cards — and never the lineup, so everyone who played without
-- scoring was missing from the game page and his game log (every game of 2026-27 until now;
-- 50 rows backfilled from the "מגיע" sign-ups the same day).
--
-- Who played = the box score (goals, cards, clean sheets) + every "מגיע" sign-up for either
-- side + any 0-goal row a board sends (a borrowed player) − rows a board marks
-- {"absent": true} (a signed-up player the judge hid: he did not come). The native boards
-- do not load sign-ups, so the server, not the board, adds them; an old installed board
-- sends no absent rows and simply gets every sign-up. Rows for one player are merged.
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
  insert into public.game_stats (game_id, player_id, goals, blue_cards, red_cards, clean_sheet, played_for_team_id)
  select p_game_id, (r->>'player_id')::uuid,
         sum(coalesce((r->>'goals')::int, 0)), sum(coalesce((r->>'blue_cards')::int, 0)),
         sum(coalesce((r->>'red_cards')::int, 0)), bool_or(coalesce((r->>'clean_sheet')::boolean, false)),
         max(nullif(r->>'played_for_team_id', ''))::uuid
  from jsonb_array_elements(coalesce(p_stats, '[]'::jsonb)) r
  where (r->>'player_id') is not null and not coalesce((r->>'absent')::boolean, false)
  group by (r->>'player_id')::uuid;

  insert into public.game_stats (game_id, player_id, goals, blue_cards, red_cards, clean_sheet, played_for_team_id)
    select p_game_id, ga.player_id, 0, 0, 0, false,
           -- a loan sign-up for a side he is not rostered on → he played for that side
           case when ga.team_id in (g.home_team_id, g.away_team_id)
                 and not exists (select 1 from public.player_teams pt where pt.player_id = ga.player_id and pt.team_id = ga.team_id)
                then ga.team_id end
      from public.game_availability ga
     where ga.game_id = p_game_id and ga.status = 'available'
       and (ga.team_id in (g.home_team_id, g.away_team_id)
            or exists (select 1 from public.player_teams pt where pt.player_id = ga.player_id and pt.team_id in (g.home_team_id, g.away_team_id)))
       and not exists (select 1 from public.game_stats st where st.game_id = p_game_id and st.player_id = ga.player_id)
       and not exists (select 1 from jsonb_array_elements(coalesce(p_stats, '[]'::jsonb)) r
                        where coalesce((r->>'absent')::boolean, false) and (r->>'player_id')::uuid = ga.player_id);

  update public.games set home_score = p_home_score, away_score = p_away_score, status = 'completed' where id = p_game_id;
  perform public.recompute_team_standings(g.home_team_id);
  perform public.recompute_team_standings(g.away_team_id);
  -- A red card shown and then taken back on the board: the final box score is the truth.
  update public.player_suspensions s
     set cleared_at = now(), games_remaining = 0
   where s.issued_game_id = p_game_id and s.cleared_at is null and s.reason like 'כרטיס אדום%'
     and not exists (select 1 from public.game_stats st
                      where st.game_id = p_game_id and st.player_id = s.player_id and st.red_cards > 0);
  delete from public.live_game_state where game_id = p_game_id;
end;
$function$;
