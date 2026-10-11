-- Judge boards: the match report travels WITH the save, and red-card undo (2026-10-11).
--
-- 1. judge_save_game_result(…, p_report jsonb) — a 5-arg overload. The board's full,
--    uncapped play-by-play (+ the web engine snapshot, + the half length) is written to
--    game_reports in the SAME transaction as the result. Before this, the report reached
--    the archive only through live broadcasts, which every client fires best-effort — a
--    dead connection at the end of the game saved the score but lost the last fouls and
--    timeouts, and >40 events missed while offline fell out of the 40-event window for
--    good. The 4-arg version stays for builds already installed.
--    p_report: { "events": [ {id,type,side,period,timeMS,…} ], "snapshot": {…}|null,
--                "periodMS": int|null }
-- 2. game_reports.period_ms — native boards never said how long a half was, so the form's
--    timeout minutes assumed 25:00. Filled from the save report or a broadcast's
--    state.periodMS.
-- 3. revoke_red_card_suspension(game, player) — a board files the 1-game suspension the
--    moment a red card is shown; removing the card on the board left it standing.
--    And the save now clears red-card suspensions issued for this game to anyone the
--    final box score gives no red card (the sync_red_card_suspension trigger only fires
--    for players who HAVE a stats row).
--
-- Apply: Management API / MCP. Idempotent.

alter table public.game_reports add column if not exists period_ms integer
  check (period_ms between 60000 and 3600000);

-- ---- 3. revoke ------------------------------------------------------------------
-- Matches the suspension this game's red card created: issued for this game, or — what
-- every board filed until now — no game id, a red-card reason, created by this caller in
-- the last 6 hours.
create or replace function public.revoke_red_card_suspension(p_game_id uuid, p_player_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (coalesce(public.is_admin(), false) or coalesce(public.is_judge(), false) or coalesce(public.is_league_manager(), false)) then
    raise exception 'not authorized';
  end if;
  select id into v_id from player_suspensions
   where player_id = p_player_id and cleared_at is null and games_remaining > 0
     and reason like 'כרטיס אדום%'
     and (issued_game_id = p_game_id
          or (issued_game_id is null and created_by = auth.uid() and created_at > now() - interval '6 hours'))
   order by created_at desc limit 1;
  if v_id is not null then
    update player_suspensions set cleared_at = now(), games_remaining = 0 where id = v_id;
  end if;
end $$;
revoke all on function public.revoke_red_card_suspension(uuid, uuid) from public, anon;
grant execute on function public.revoke_red_card_suspension(uuid, uuid) to authenticated;

-- ---- the 4-arg save, + stale red-card cleanup ------------------------------------
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
         coalesce((r->>'goals')::int, 0), coalesce((r->>'blue_cards')::int, 0),
         coalesce((r->>'red_cards')::int, 0), coalesce((r->>'clean_sheet')::boolean, false),
         nullif(r->>'played_for_team_id', '')::uuid
  from jsonb_array_elements(coalesce(p_stats, '[]'::jsonb)) r
  where (r->>'player_id') is not null;
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

-- ---- 1. the 5-arg save: report + result in one transaction ------------------------
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
begin
  if not (public.is_admin() or public.is_judge()) then raise exception 'not authorized to score games'; end if;
  if v_period is not null and (v_period < 60000 or v_period > 3600000) then v_period := null; end if;

  -- The report first: the 4-arg save raises on a completed game, rolling this back with it.
  insert into public.game_reports (game_id, events, final_state, period_ms)
  values (p_game_id, coalesce(v_events, '[]'::jsonb), v_snap, v_period)
  on conflict (game_id) do update set
    -- The board's own full list wins over the archive's window-merged copy.
    events      = coalesce(v_events, game_reports.events),
    final_state = coalesce(v_snap, game_reports.final_state),
    period_ms   = coalesce(v_period, game_reports.period_ms),
    updated_at  = now();

  perform public.judge_save_game_result(p_game_id, p_home_score, p_away_score, p_stats);
end;
$function$;
revoke all on function public.judge_save_game_result(uuid, integer, integer, jsonb, jsonb) from public, anon;
grant execute on function public.judge_save_game_result(uuid, integer, integer, jsonb, jsonb) to authenticated;

-- ---- 2. broadcasts carry the half length too ---------------------------------------
create or replace function public._archive_period_ms()
returns trigger language plpgsql security definer set search_path = public as $$
declare v int;
begin
  v := nullif(coalesce(new.state->>'periodMS', new.state->'snapshot'->'settings'->>'periodMS'), '')::int;
  if v between 60000 and 3600000 then
    update game_reports set period_ms = v where game_id = new.game_id and period_ms is distinct from v;
  end if;
  return new;
exception when others then
  return new;   -- never cost the live broadcast
end $$;

drop trigger if exists live_game_state_period_ms on public.live_game_state;
-- Named to sort after live_game_state_archive (which creates the game_reports row).
create trigger live_game_state_period_ms
  after insert or update of state on public.live_game_state
  for each row execute function public._archive_period_ms();
