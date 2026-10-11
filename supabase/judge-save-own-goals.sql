-- Own goals from the judge board (2026-10-11).
--
-- games.home_own_goals / away_own_goals = own goals CREDITED TO that side (an away player
-- put it in his own net → home_own_goals), as game-form-results.sql and GameDetail read
-- them. The board never set them: an own goal went in as a goal with no scorer, so the
-- box score didn't add up and the page couldn't say "שער עצמי".
--
-- The 5-arg judge_save_game_result now reads p_report.ownGoals = {"home": n, "away": n}
-- (same meaning). Absent → left as is (old boards, 4-arg path unchanged).
-- Each side is capped at its score minus its attributed goals, so a mis-tap can't make
-- the box score exceed the result.

create or replace function public.judge_save_game_result(p_game_id uuid, p_home_score integer, p_away_score integer, p_stats jsonb, p_report jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_events jsonb := case when jsonb_typeof(p_report->'events') = 'array' then p_report->'events' end;
  v_snap jsonb := case when jsonb_typeof(p_report->'snapshot') = 'object' then p_report->'snapshot' end;
  v_period int := nullif(p_report->>'periodMS', '')::int;
  v_og jsonb := case when jsonb_typeof(p_report->'ownGoals') = 'object' then p_report->'ownGoals' end;
  g public.games;
  v_home_scored int; v_away_scored int;
begin
  if not (public.is_admin() or public.is_judge()) then raise exception 'not authorized to score games'; end if;
  if v_period is not null and (v_period < 60000 or v_period > 3600000) then v_period := null; end if;

  insert into public.game_reports (game_id, events, final_state, period_ms)
  values (p_game_id, coalesce(v_events, '[]'::jsonb), v_snap, v_period)
  on conflict (game_id) do update set
    events      = coalesce(v_events, game_reports.events),
    final_state = coalesce(v_snap, game_reports.final_state),
    period_ms   = coalesce(v_period, game_reports.period_ms),
    updated_at  = now();

  perform public.judge_save_game_result(p_game_id, p_home_score, p_away_score, p_stats);

  if v_og is not null then
    select * into g from public.games where id = p_game_id;
    -- Attributed goals per side (a loaned player counts for the side he played for).
    select coalesce(sum(st.goals) filter (where coalesce(st.played_for_team_id, pl.team_id) = g.home_team_id), 0),
           coalesce(sum(st.goals) filter (where coalesce(st.played_for_team_id, pl.team_id) = g.away_team_id), 0)
      into v_home_scored, v_away_scored
      from public.game_stats st left join public.players pl on pl.id = st.player_id
     where st.game_id = p_game_id;
    update public.games set
      home_own_goals = least(greatest(coalesce((v_og->>'home')::int, 0), 0), greatest(p_home_score - v_home_scored, 0)),
      away_own_goals = least(greatest(coalesce((v_og->>'away')::int, 0), 0), greatest(p_away_score - v_away_scored, 0))
    where id = p_game_id;
  end if;
end;
$function$;
revoke all on function public.judge_save_game_result(uuid, integer, integer, jsonb, jsonb) from public, anon;
grant execute on function public.judge_save_game_result(uuid, integer, integer, jsonb, jsonb) to authenticated;
