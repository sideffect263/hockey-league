-- Loan calls + the youth loan page (2026-10-12). Builds on loan-requests.sql.
--
-- Instead of inviting one player, a coach can raise a hand for a game: "we need players"
-- — field, goalkeeper, or both (loan_calls). Every player who could be borrowed sees the
-- open calls on /loans (השאלות למשחקים) and asks to join (ask_to_join_loan). The coach
-- approves or declines (respond_loan_join). An approved ask is a loan exactly like an
-- accepted invite: same five-field-player cap, same automatic removal.
--
-- A call is only shown while the team still has room of that kind and the game has not
-- started, so it switches itself off when the squad fills; the coach never has to.
--
-- loan_requests.initiated_by tells the two directions apart: 'coach' (an invite — the
-- player answers) or 'player' (an ask — the coach answers).

alter table public.loan_requests
  add column if not exists initiated_by text not null default 'coach'
  check (initiated_by in ('coach', 'player'));

create table if not exists public.loan_calls (
  game_id           uuid not null references public.games(id) on delete cascade,
  team_id           uuid not null references public.teams(id) on delete cascade,
  need_field        boolean not null default false,
  need_gk           boolean not null default false,
  note              text,
  created_by        uuid references auth.users(id) on delete set null,
  updated_at        timestamptz not null default now(),
  notified_field_at timestamptz,
  notified_gk_at    timestamptz,
  primary key (game_id, team_id)
);
alter table public.loan_calls enable row level security;
revoke all on public.loan_calls from anon, authenticated;
grant select on public.loan_calls to authenticated;
drop policy if exists loan_calls_read on public.loan_calls;
create policy loan_calls_read on public.loan_calls for select to authenticated using (true);

-- the App Store demo account writes only on test games, here as on every other table
drop trigger if exists zz_sandbox_guard on public.loan_requests;
create trigger zz_sandbox_guard before insert or delete or update on public.loan_requests
  for each row execute function public.sandbox_guard();
drop trigger if exists zz_sandbox_guard on public.loan_calls;
create trigger zz_sandbox_guard before insert or delete or update on public.loan_calls
  for each row execute function public.sandbox_guard();

-- ── who may use the loan page ─────────────────────────────────────────────────────
-- A goalkeeper of any age, or a field player whose date of birth proves he is under 18.
-- A field player with no date on file is told to add it (the coach could vouch for him
-- on an invite, but nobody vouches for a self-ask).
create or replace function public.my_loan_eligibility()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid; p record; v_age int; v_reason text;
begin
  v_pid := public.my_player_id();
  if v_pid is null then
    return jsonb_build_object('player_id', null, 'eligible', false, 'reason', 'no_player',
      'viewer', public.is_admin() or public.is_league_manager()
                or exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'coach'));
  end if;
  select id, "position", birth_date, team_id into p from public.players where id = v_pid;
  v_age := public.player_age(p.birth_date);
  v_reason := case
    when p."position" = 'Goalkeeper' then null
    when v_age is null then 'no_dob'
    when v_age >= 18 then 'too_old'
  end;
  return jsonb_build_object(
    'player_id', p.id, 'position', p."position", 'age', v_age, 'team_id', p.team_id,
    'eligible', v_reason is null, 'reason', v_reason,
    'viewer', public.is_admin() or public.is_league_manager()
              or exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'coach'));
end $$;

-- ── coach: raise / lower the hand ─────────────────────────────────────────────────
create or replace function public.set_loan_call(p_game_id uuid, p_team_id uuid,
  p_need_field boolean, p_need_gk boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare g record; c record; v_note text;
begin
  select id, home_team_id, away_team_id into g from public.games where id = p_game_id;
  if g.id is null then raise exception 'game not found'; end if;
  if p_team_id not in (g.home_team_id, g.away_team_id) then raise exception 'team not in this game'; end if;
  if not public.loan_game_open(p_game_id) then raise exception 'game already started'; end if;
  if not public.loan_can_manage(p_team_id, p_game_id) then raise exception 'not authorized'; end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');

  insert into public.loan_calls (game_id, team_id, need_field, need_gk, note, created_by, updated_at)
  values (p_game_id, p_team_id, coalesce(p_need_field, false), coalesce(p_need_gk, false), v_note, auth.uid(), now())
  on conflict (game_id, team_id) do update
    set need_field = excluded.need_field, need_gk = excluded.need_gk, note = excluded.note,
        created_by = excluded.created_by, updated_at = now()
  returning * into c;

  -- Tell the players who could actually come — once per kind per game, so a coach
  -- toggling the switch back and forth does not ping the same phones again.
  if c.need_field and c.notified_field_at is null
     and public.loan_slot_block(p_game_id, p_team_id, 'Field Player') is null then
    perform public.loan_notify_call(p_game_id, p_team_id, false, v_note);
    update public.loan_calls set notified_field_at = now() where game_id = p_game_id and team_id = p_team_id;
  end if;
  if c.need_gk and c.notified_gk_at is null
     and public.loan_slot_block(p_game_id, p_team_id, 'Goalkeeper') is null then
    perform public.loan_notify_call(p_game_id, p_team_id, true, v_note);
    update public.loan_calls set notified_gk_at = now() where game_id = p_game_id and team_id = p_team_id;
  end if;
end $$;

create or replace function public.loan_notify_call(p_game_id uuid, p_team_id uuid, p_gk boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_data jsonb; v_test boolean;
begin
  select coalesce(is_test, false) into v_test from public.teams where id = p_team_id;
  select jsonb_build_object('game_id', g.id, 'game_date', g.game_date, 'home_team', th.name, 'away_team', ta.name,
                            'team_id', t.id, 'team_name', t.name, 'need', case when p_gk then 'gk' else 'field' end,
                            'note', p_note)
    into v_data
    from public.games g
    join public.teams th on th.id = g.home_team_id
    join public.teams ta on ta.id = g.away_team_id
    join public.teams t on t.id = p_team_id
   where g.id = p_game_id;

  insert into public.notifications (user_id, type, actor_id, entity_type, entity_id, data)
  select pr.id, 'loan_call', auth.uid(), 'game', p_game_id::text, v_data
    from public.players pl
    join public.profiles pr on pr.player_id = pl.id
    left join public.teams pt on pt.id = pl.team_id
   where (pl."position" = 'Goalkeeper') = p_gk
     and (p_gk or coalesce(public.player_age(pl.birth_date), 99) < 18)
     and coalesce(pt.is_test, false) = v_test
     and public.loan_block_reason(p_game_id, p_team_id, pl.id) is null
     and pr.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
end $$;

-- ── the page ──────────────────────────────────────────────────────────────────────
-- Every open call that still has room, with the caller's own standing for each.
create or replace function public.loan_board()
returns table(game_id uuid, game_date timestamptz, venue text, home_team_id uuid, away_team_id uuid,
              home_team text, away_team text, team_id uuid, team_name text, team_logo text,
              need_field boolean, need_gk boolean, field_slots int, gk_slots int, note text,
              my_block text, my_request_id uuid, my_request_status text, my_request_by text)
language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid; v_test boolean;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  v_pid := public.my_player_id();
  v_test := public.is_admin() or public.is_sandbox_user();
  return query
  with open_calls as (
    select lc.*, g.game_date as gd, g.venue as gv, g.home_team_id as hid, g.away_team_id as aid,
           s.field_slots as fs, s.gk_slots as gs
      from public.loan_calls lc
      join public.games g on g.id = lc.game_id
      join public.teams t on t.id = lc.team_id
      cross join lateral (
        select greatest(0, 5 - c.own_field - c.loan_field) as field_slots, greatest(0, 1 - c.loan_gk) as gk_slots
          from public.loan_counts(lc.game_id, lc.team_id) c
      ) s
     where public.loan_game_open(lc.game_id)
       and (coalesce(t.is_test, false) = false or v_test)
  )
  select oc.game_id, oc.gd, oc.gv, oc.hid, oc.aid, th.name, ta.name, oc.team_id, t.name, t.logo_url,
         oc.need_field and oc.fs > 0, oc.need_gk and oc.gs > 0, oc.fs, oc.gs, oc.note,
         case when v_pid is null then 'no_player'
              else public.loan_block_reason(oc.game_id, oc.team_id, v_pid) end,
         lr.id, lr.status, lr.initiated_by
    from open_calls oc
    join public.teams th on th.id = oc.hid
    join public.teams ta on ta.id = oc.aid
    join public.teams t on t.id = oc.team_id
    left join lateral (
      select r.id, r.status, r.initiated_by from public.loan_requests r
       where r.game_id = oc.game_id and r.team_id = oc.team_id and r.player_id = v_pid
       order by r.created_at desc limit 1
    ) lr on true
   where (oc.need_field and oc.fs > 0) or (oc.need_gk and oc.gs > 0)
      or lr.status in ('pending', 'accepted')
   order by oc.gd, t.name;
end $$;

-- ── player: ask to join ───────────────────────────────────────────────────────────
create or replace function public.ask_to_join_loan(p_game_id uuid, p_team_id uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pid uuid; p record; v_age int; c record; v_block text; v_id uuid;
begin
  v_pid := public.my_player_id();
  if v_pid is null then raise exception 'no linked player'; end if;
  if not public.loan_game_open(p_game_id) then raise exception 'game already started'; end if;

  select id, "position", birth_date into p from public.players where id = v_pid;
  v_age := public.player_age(p.birth_date);
  if p."position" <> 'Goalkeeper' and v_age is null then raise exception 'loan_block:no_dob'; end if;

  select * into c from public.loan_calls where game_id = p_game_id and team_id = p_team_id;
  if c.game_id is null
     or (p."position" = 'Goalkeeper' and not c.need_gk)
     or (p."position" <> 'Goalkeeper' and not c.need_field) then
    raise exception 'loan_block:no_call';
  end if;

  v_block := public.loan_block_reason(p_game_id, p_team_id, v_pid);
  if v_block is not null then raise exception 'loan_block:%', v_block; end if;
  v_block := public.loan_slot_block(p_game_id, p_team_id, p."position");
  if v_block is not null then raise exception 'loan_block:%', v_block; end if;
  if exists (select 1 from public.loan_requests
              where game_id = p_game_id and player_id = v_pid and status in ('pending', 'accepted')) then
    raise exception 'loan_block:already_invited';
  end if;

  insert into public.loan_requests (game_id, team_id, player_id, requested_by, note, initiated_by)
  values (p_game_id, p_team_id, v_pid, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''), 'player')
  returning id into v_id;

  perform public.notify_team_reviewers(p_team_id, 'loan_join_request', auth.uid(), 'game', p_game_id::text,
    public.loan_notify_data(p_game_id, p_team_id, v_pid)
      || jsonb_build_object('request_id', v_id, 'position', p."position", 'age', v_age));
  return v_id;
end $$;

-- ── the accept, shared by both directions ─────────────────────────────────────────
-- Returns 'accepted' or 'filled'. Raises on a player who has become unable to play.
create or replace function public.loan_do_accept(p_request_id uuid, p_added_by uuid)
returns text language plpgsql security definer set search_path = public as $$
declare r record; v_pos text; v_block text;
begin
  select * into r from public.loan_requests where id = p_request_id;
  v_block := public.loan_block_reason(r.game_id, r.team_id, r.player_id);
  if v_block is not null then raise exception 'loan_block:%', v_block; end if;

  select "position" into v_pos from public.players where id = r.player_id;
  if public.loan_slot_block(r.game_id, r.team_id, v_pos) is not null then
    update public.loan_requests set status = 'filled', responded_at = clock_timestamp(), closed_at = now() where id = r.id;
    return 'filled';
  end if;

  update public.loan_requests set status = 'accepted', responded_at = clock_timestamp() where id = r.id;
  insert into public.game_availability (game_id, player_id, status, added_by, team_id, note, age_confirmed, updated_at)
  values (r.game_id, r.player_id, 'available', p_added_by, r.team_id, coalesce(r.note, 'שחקן בהשאלה'), true, now())
  on conflict (game_id, player_id) do update
    set status = 'available', added_by = excluded.added_by, team_id = excluded.team_id,
        note = excluded.note, age_confirmed = true, updated_at = now();

  if public.loan_slot_block(r.game_id, r.team_id, v_pos) is not null then
    perform public.loan_close_filled(r.game_id, r.team_id, v_pos = 'Goalkeeper');
  end if;
  return 'accepted';
end $$;

-- An invite (coach → player): the player answers.
create or replace function public.respond_loan(p_request_id uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare r record; v_data jsonb; v_out text;
begin
  select * into r from public.loan_requests where id = p_request_id for update;
  if r.id is null then raise exception 'request not found'; end if;
  if r.player_id is distinct from public.my_player_id() or r.initiated_by <> 'coach' then
    raise exception 'not authorized';
  end if;
  if r.status <> 'pending' then raise exception 'request closed'; end if;
  if not public.loan_game_open(r.game_id) then raise exception 'game already started'; end if;

  v_data := public.loan_notify_data(r.game_id, r.team_id, r.player_id) || jsonb_build_object('request_id', r.id);
  if not p_accept then
    update public.loan_requests set status = 'declined', responded_at = clock_timestamp(), closed_at = now() where id = r.id;
    perform public.notify_team_reviewers(r.team_id, 'loan_declined', auth.uid(), 'game', r.game_id::text, v_data);
    return 'declined';
  end if;

  v_out := public.loan_do_accept(r.id, r.requested_by);
  if v_out = 'accepted' then
    perform public.notify_team_reviewers(r.team_id, 'loan_accepted', auth.uid(), 'game', r.game_id::text, v_data);
  end if;
  return v_out;
end $$;

-- An ask (player → coach): the coach answers.
create or replace function public.respond_loan_join(p_request_id uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare r record; v_data jsonb; v_out text;
begin
  select * into r from public.loan_requests where id = p_request_id for update;
  if r.id is null then raise exception 'request not found'; end if;
  if r.initiated_by <> 'player' then raise exception 'not authorized'; end if;
  if not public.loan_can_manage(r.team_id, r.game_id) then raise exception 'not authorized'; end if;
  if r.status <> 'pending' then raise exception 'request closed'; end if;
  if not public.loan_game_open(r.game_id) then raise exception 'game already started'; end if;

  v_data := public.loan_notify_data(r.game_id, r.team_id, r.player_id) || jsonb_build_object('request_id', r.id);
  if not p_accept then
    update public.loan_requests set status = 'declined', responded_at = clock_timestamp(), closed_at = now() where id = r.id;
    perform public.loan_notify_player(r.player_id, 'loan_join_declined', auth.uid(), r.game_id, v_data);
    return 'declined';
  end if;

  v_out := public.loan_do_accept(r.id, auth.uid());
  perform public.loan_notify_player(r.player_id,
    case when v_out = 'accepted' then 'loan_join_approved' else 'loan_cancelled' end,
    auth.uid(), r.game_id,
    v_data || case when v_out = 'accepted' then '{}'::jsonb else jsonb_build_object('reason', 'filled') end);
  return v_out;
end $$;

-- Closing a call's last seat also closes pending asks of that kind — loan_close_filled
-- already covers both directions (it closes every pending request for the team/kind).

-- The coach cancels either kind; the player may withdraw his own ask.
create or replace function public.cancel_loan(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_own_ask boolean;
begin
  select * into r from public.loan_requests where id = p_request_id;
  if r.id is null then raise exception 'request not found'; end if;
  if r.status not in ('pending', 'accepted') then raise exception 'request closed'; end if;
  v_own_ask := r.initiated_by = 'player' and r.status = 'pending' and r.player_id = public.my_player_id();
  if not (v_own_ask or public.loan_can_manage(r.team_id, r.game_id)) then raise exception 'not authorized'; end if;

  update public.loan_requests set status = 'cancelled', closed_at = now() where id = r.id;
  if r.status = 'accepted' then
    delete from public.game_availability
     where game_id = r.game_id and player_id = r.player_id and team_id = r.team_id;
  end if;
  if not v_own_ask then
    perform public.loan_notify_player(r.player_id, 'loan_cancelled', auth.uid(), r.game_id,
      public.loan_notify_data(r.game_id, r.team_id, r.player_id)
        || jsonb_build_object('request_id', r.id, 'reason', 'coach'));
  end if;
end $$;

-- Now also says which direction each is (an ask shows "waiting for the coach").
drop function if exists public.my_loan_requests();
create function public.my_loan_requests()
returns table(id uuid, game_id uuid, team_id uuid, team_name text, status text, note text,
              game_date timestamptz, home_team text, away_team text, created_at timestamptz,
              initiated_by text)
language sql stable security definer set search_path = public as $$
  select r.id, r.game_id, r.team_id, t.name, r.status, r.note, g.game_date, th.name, ta.name, r.created_at,
         r.initiated_by
    from public.loan_requests r
    join public.games g on g.id = r.game_id
    join public.teams t on t.id = r.team_id
    join public.teams th on th.id = g.home_team_id
    join public.teams ta on ta.id = g.away_team_id
   where r.player_id = public.my_player_id()
     and public.loan_game_open(r.game_id)
     and r.status in ('pending', 'accepted')
   order by g.game_date
$$;

-- The coach's box also carries the call and which requests are asks.
create or replace function public.loan_summary(p_game_id uuid, p_team_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c record; lc record;
begin
  if not (public.is_admin() or public.is_league_manager() or public.is_judge()
          or public.is_coach_of(p_team_id)) then
    raise exception 'not authorized';
  end if;
  select * into c from public.loan_counts(p_game_id, p_team_id);
  select * into lc from public.loan_calls where game_id = p_game_id and team_id = p_team_id;
  return jsonb_build_object(
    'own_field', c.own_field, 'loan_field', c.loan_field, 'loan_gk', c.loan_gk,
    'field_target', 5,
    'field_slots', greatest(0, 5 - c.own_field - c.loan_field),
    'gk_slots', greatest(0, 1 - c.loan_gk),
    'open', public.loan_game_open(p_game_id),
    'call', case when lc.game_id is null then null
                 else jsonb_build_object('need_field', lc.need_field, 'need_gk', lc.need_gk, 'note', lc.note) end,
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'player_id', r.player_id, 'status', r.status, 'note', r.note,
               'initiated_by', r.initiated_by,
               'created_at', r.created_at, 'responded_at', r.responded_at,
               'player_name', btrim(coalesce(pl.first_name, '') || ' ' || coalesce(pl.last_name, '')),
               'position', pl."position", 'team_name', t.name, 'age', public.player_age(pl.birth_date))
             order by r.created_at desc)
        from public.loan_requests r
        join public.players pl on pl.id = r.player_id
        left join public.teams t on t.id = pl.team_id
       where r.game_id = p_game_id and r.team_id = p_team_id), '[]'::jsonb));
end $$;

-- ── sandbox: the new tables are game-scoped like game_availability ────────────────
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.sandbox_guard()'::regprocedure);
  if position('''loan_requests''' in v_def) = 0 then
    v_def := replace(v_def,
      '''game_form_submissions'', ''game_reminder_log'', ''markets'', ''player_suspensions'')',
      '''game_form_submissions'', ''game_reminder_log'', ''markets'', ''player_suspensions'',
              ''loan_requests'', ''loan_calls'')');
    if position('''loan_requests''' in v_def) = 0 then
      raise exception 'sandbox_guard: table list not found — update it by hand';
    end if;
    execute v_def;
  end if;
end $$;

-- ── grants ────────────────────────────────────────────────────────────────────────
revoke all on function public.loan_notify_call(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.loan_do_accept(uuid, uuid) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'my_loan_eligibility()', 'set_loan_call(uuid,uuid,boolean,boolean,text)', 'loan_board()',
    'ask_to_join_loan(uuid,uuid,text)', 'respond_loan(uuid,boolean)', 'respond_loan_join(uuid,boolean)',
    'cancel_loan(uuid)', 'my_loan_requests()', 'loan_summary(uuid,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
