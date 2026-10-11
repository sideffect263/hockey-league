-- Breaks (timeouts, halftime) count down for spectators.
--
-- Every judge board (web, iOS, Android) reports isRunning = (phase == running), so
-- during a break it broadcast a FROZEN clock (is_running false + remaining ms) and
-- spectators saw a stopped clock labelled "מושהה" instead of a timeout counting down.
-- A break clock always runs (the only control is "skip"), so here a breakTime
-- broadcast with a frozen value is turned into a running deadline. Done server-side so
-- the apps already installed get it with no release.
--
-- updated_at stays now(): the stream score overlay uses it to line state up with the
-- delayed video. Spectators skip the "judge gone" heartbeat check while phase is
-- breakTime instead (the boards only heartbeat in phase running).
--
-- Down: re-run the previous definition from supabase/game-broadcast.sql.
create or replace function public.broadcast_game_state(
  p_game_id uuid, p_home integer, p_away integer, p_clock_ends_at timestamptz,
  p_clock_remaining_ms integer, p_is_running boolean, p_period text, p_phase text, p_state jsonb)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_ends timestamptz := p_clock_ends_at;
  v_remaining integer := p_clock_remaining_ms;
  v_running boolean := coalesce(p_is_running, false);
begin
  if not (public.is_admin() or public.is_judge()) then raise exception 'not authorized to broadcast'; end if;
  if p_home < 0 or p_away < 0 or p_home > 50 or p_away > 50 then raise exception 'invalid score'; end if;

  if p_phase = 'breakTime' then
    if not v_running and coalesce(p_clock_remaining_ms, 0) > 0 then
      v_ends := now() + make_interval(secs => p_clock_remaining_ms / 1000.0);
      v_remaining := null;
      v_running := true;
    end if;
  end if;

  insert into public.live_game_state(game_id, home_score, away_score, clock_ends_at, clock_remaining_ms, is_running, period, phase, state, updated_by, updated_at)
  values (p_game_id, p_home, p_away, v_ends, v_remaining, v_running, p_period, p_phase, coalesce(p_state,'{}'::jsonb), auth.uid(), now())
  on conflict (game_id) do update set
    home_score = excluded.home_score, away_score = excluded.away_score,
    clock_ends_at = excluded.clock_ends_at, clock_remaining_ms = excluded.clock_remaining_ms,
    is_running = excluded.is_running, period = excluded.period, phase = excluded.phase,
    state = excluded.state, updated_by = excluded.updated_by, updated_at = now();
  update public.games set status = 'in_progress' where id = p_game_id and status in ('scheduled', 'waiting_result');
end $function$;
