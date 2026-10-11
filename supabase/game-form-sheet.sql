-- Match-sheet facts from the paper טופס שיפוט, kept on the game (2026-10-11).
--
-- The box score (game_stats) only ever held goals and cards. Team fouls, timeouts and the
-- half-time score lived in the judge board's live state and died with it on finish; since
-- 2026-10-11 the live_game_state_archive trigger keeps them in game_reports, but only for
-- games judged on a board — and the opener (2026-10-10) was judged before that existed.
--
-- These columns are the PAPER FORM's numbers, entered by a referee / LM / admin. They win
-- over anything derived from the archive (the paper is what the referee signed). NULL =
-- "not entered", and the reader falls back to the archive. The form photos themselves
-- live in the private `game-forms` bucket (see game-form-results.sql); `form_photos`
-- holds their storage paths.
--
-- Apply: Management API (see docs). Idempotent.

alter table public.game_reports
  add column if not exists home_fouls     smallint check (home_fouls between 0 and 99),
  add column if not exists away_fouls     smallint check (away_fouls between 0 and 99),
  add column if not exists halftime_home  smallint check (halftime_home between 0 and 50),
  add column if not exists halftime_away  smallint check (halftime_away between 0 and 50),
  -- { "home": { "first": [min|null, …], "second": […] }, "away": { … } }
  -- null in a list = a timeout taken, minute not written down.
  add column if not exists timeouts       jsonb,
  add column if not exists form_photos    text[] not null default '{}',
  add column if not exists sheet_by       uuid references auth.users(id) on delete set null,
  add column if not exists sheet_at       timestamptz;

create index if not exists game_reports_sheet_by_idx on public.game_reports(sheet_by);

-- ---- write: the paper numbers ------------------------------------------------
-- Who: whoever may enter a result from the paper form (admin / LM / judge) — never a
-- coach, same rule as game-form-results.sql. Every argument is the full new value
-- (null clears it), so the editor sends the whole sheet each time.
create or replace function public.set_game_sheet(
  p_game_id uuid,
  p_home_fouls int, p_away_fouls int,
  p_halftime_home int, p_halftime_away int,
  p_timeouts jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.can_enter_game_result(), false) then raise exception 'not authorized'; end if;
  if not exists (select 1 from games where id = p_game_id) then raise exception 'game not found'; end if;
  if p_timeouts is not null and jsonb_typeof(p_timeouts) <> 'object' then raise exception 'invalid timeouts'; end if;

  insert into game_reports (game_id, home_fouls, away_fouls, halftime_home, halftime_away, timeouts, sheet_by, sheet_at)
  values (p_game_id, p_home_fouls, p_away_fouls, p_halftime_home, p_halftime_away, p_timeouts, auth.uid(), now())
  on conflict (game_id) do update set
    home_fouls = excluded.home_fouls, away_fouls = excluded.away_fouls,
    halftime_home = excluded.halftime_home, halftime_away = excluded.halftime_away,
    timeouts = excluded.timeouts, sheet_by = excluded.sheet_by, sheet_at = excluded.sheet_at,
    updated_at = now();
end $$;
revoke all on function public.set_game_sheet(uuid,int,int,int,int,jsonb) from public, anon;
grant execute on function public.set_game_sheet(uuid,int,int,int,int,jsonb) to authenticated;

-- ---- write: attach / detach a form photo ---------------------------------------
-- The client uploads to game-forms/<game_id>/<uuid>.jpg (storage policy: same officials),
-- then records the path here.
create or replace function public.add_game_form_photos(p_game_id uuid, p_paths text[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.can_enter_game_result(), false) then raise exception 'not authorized'; end if;
  if exists (select 1 from unnest(p_paths) p where p not like p_game_id::text || '/%') then
    raise exception 'photo path must be under the game folder';
  end if;
  insert into game_reports (game_id, form_photos) values (p_game_id, p_paths)
  on conflict (game_id) do update
    set form_photos = (select array_agg(distinct x) from unnest(game_reports.form_photos || excluded.form_photos) x),
        updated_at = now();
end $$;
revoke all on function public.add_game_form_photos(uuid,text[]) from public, anon;
grant execute on function public.add_game_form_photos(uuid,text[]) to authenticated;

create or replace function public.remove_game_form_photo(p_game_id uuid, p_path text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.can_enter_game_result(), false) then raise exception 'not authorized'; end if;
  update game_reports set form_photos = array_remove(form_photos, p_path), updated_at = now()
   where game_id = p_game_id;
end $$;
revoke all on function public.remove_game_form_photo(uuid,text) from public, anon;
grant execute on function public.remove_game_form_photo(uuid,text) to authenticated;

-- ---- guard: a finished game's archive is final ----------------------------------
-- A second tab/device still open on the board, or a broadcast in flight when the judge
-- pressed save, used to resurrect live_game_state after judge_save_game_result deleted
-- it (game shown "live" for hours) and overwrite game_reports with a stale snapshot.
create or replace function public.broadcast_game_state(p_game_id uuid, p_home integer, p_away integer, p_clock_ends_at timestamp with time zone, p_clock_remaining_ms integer, p_is_running boolean, p_period text, p_phase text, p_state jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ends timestamptz := p_clock_ends_at;
  v_remaining integer := p_clock_remaining_ms;
  v_running boolean := coalesce(p_is_running, false);
begin
  if not (public.is_admin() or public.is_judge()) then raise exception 'not authorized to broadcast'; end if;
  if p_home < 0 or p_away < 0 or p_home > 50 or p_away > 50 then raise exception 'invalid score'; end if;
  -- Completed: the result is saved and the archive closed. Drop late broadcasts quietly
  -- (the sender is a stale board; an error would only alarm the judge).
  if exists (select 1 from public.games where id = p_game_id and status = 'completed') then return; end if;

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
