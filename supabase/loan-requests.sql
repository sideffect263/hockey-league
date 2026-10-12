-- Loan invites (2026-10-12).
--
-- A loan is still what it was: a game_availability row for a team the player is not on
-- (team_id = the borrowing side, added_by = the coach). What changes is how it gets there
-- and how many a team may have:
--
--   * The coach no longer just drops someone else's player into his squad. He picks from
--     loan_candidates() — every player in the league with the reason he can or cannot be
--     borrowed for THIS game — and request_loan() sends that player an invite. The player
--     accepts or declines (respond_loan). Only an accepted invite puts him in the squad.
--     The lending club's coach is not asked; the player decides.
--   * A team may borrow only up to FIVE FIELD PLAYERS: own field players who signed up
--     + loaned field players <= 5. Goalkeepers are not counted; one goalkeeper may be
--     borrowed on top.
--   * If own field players sign up after the loans and the team passes five, the LAST
--     loan accepted is removed (loan_removed to the player and the coaches). Only before
--     kick-off.
--
-- A player with no account cannot answer an invite, so for him the coach keeps the old
-- direct add (add_player_to_squad), under the same cap. A player WITH an account must be
-- invited — a coach can no longer add him without his say.

-- ── table ─────────────────────────────────────────────────────────────────────────
create table if not exists public.loan_requests (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,   -- the borrowing side
  player_id    uuid not null references public.players(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  status       text not null default 'pending'
               check (status in ('pending', 'accepted', 'declined', 'cancelled', 'filled', 'removed')),
  note         text,
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  closed_at    timestamptz
);
-- one open invite per player per game, whichever team sent it
create unique index if not exists loan_requests_open_uniq
  on public.loan_requests (game_id, player_id) where status in ('pending', 'accepted');
create index if not exists loan_requests_player_idx on public.loan_requests (player_id, status);
create index if not exists loan_requests_game_team_idx on public.loan_requests (game_id, team_id);

alter table public.loan_requests enable row level security;
revoke all on public.loan_requests from anon, authenticated;
grant select on public.loan_requests to authenticated;

drop policy if exists loan_requests_read on public.loan_requests;
create policy loan_requests_read on public.loan_requests for select to authenticated
  using (
    player_id = (select public.my_player_id())
    or public.is_coach_of(team_id)
    or (select public.is_admin()) or (select public.is_league_manager()) or (select public.is_judge())
  );

-- ── helpers ───────────────────────────────────────────────────────────────────────
create or replace function public.loan_game_open(p_game_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select g.game_date > now() and g.status in ('scheduled', 'postponed')
                     from public.games g where g.id = p_game_id), false)
$$;

create or replace function public.on_team_roster(p_player uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.players where id = p_player and team_id = p_team)
      or exists (select 1 from public.player_teams where player_id = p_player and team_id = p_team)
$$;

-- Who is signed up for team T in this game: own field players, loaned field players,
-- loaned goalkeepers. "Own" = on T's roster and signed for T (or for no side, the default).
create or replace function public.loan_counts(p_game_id uuid, p_team_id uuid,
  out own_field int, out loan_field int, out loan_gk int)
language sql stable security definer set search_path = public as $$
  select
    count(*) filter (where own and pl."position" <> 'Goalkeeper')::int,
    count(*) filter (where not own and pl."position" <> 'Goalkeeper')::int,
    count(*) filter (where not own and pl."position" = 'Goalkeeper')::int
  from (
    select ga.player_id, public.on_team_roster(ga.player_id, p_team_id) as own, ga.team_id
      from public.game_availability ga
     where ga.game_id = p_game_id and ga.status = 'available'
  ) s
  join public.players pl on pl.id = s.player_id
  where (s.own and (s.team_id is null or s.team_id = p_team_id))
     or (not s.own and s.team_id = p_team_id)
$$;

-- Why player P cannot be borrowed by team T for game G right now, or null if he can.
-- Squad-size limits are NOT here (they depend on the team, not the player) — see
-- loan_slot_block().
create or replace function public.loan_block_reason(p_game_id uuid, p_team_id uuid, p_player_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  g record; p record; v_day date; v_age int; v_other uuid;
begin
  select id, home_team_id, away_team_id, game_date into g from public.games where id = p_game_id;
  if g.id is null then return 'game_not_found'; end if;
  select id, team_id, "position", birth_date into p from public.players where id = p_player_id;
  if p.id is null then return 'player_not_found'; end if;
  v_other := case when p_team_id = g.home_team_id then g.away_team_id else g.home_team_id end;
  v_day := (g.game_date at time zone 'Asia/Jerusalem')::date;

  if public.on_team_roster(p_player_id, p_team_id) then return 'own_player'; end if;
  if public.on_team_roster(p_player_id, v_other) then return 'opponent'; end if;

  if exists (select 1 from public.game_availability ga
              where ga.game_id = p_game_id and ga.player_id = p_player_id and ga.status = 'available') then
    return 'in_squad';
  end if;

  if p."position" <> 'Goalkeeper' then
    v_age := public.player_age(p.birth_date);
    if v_age is not null and v_age >= 18 then return 'too_old'; end if;
  end if;

  if public.is_suspended(p_player_id) then return 'suspended'; end if;
  if public.is_unavailable(p_player_id, v_day) then return 'unavailable'; end if;
  if not exists (select 1 from public.medical_certificates mc
                  where mc.player_id = p_player_id and mc.status = 'approved'
                    and (mc.expires_at is null or mc.expires_at >= v_day)) then
    return 'no_medical';
  end if;

  -- Already playing somewhere within two hours of this game: signed up for another game
  -- (for his own team or on loan), or his own team has a game then.
  if exists (
    select 1 from public.games o
     where o.id <> p_game_id and o.status in ('scheduled', 'postponed', 'live', 'in_progress')
       and abs(extract(epoch from (o.game_date - g.game_date))) < 2 * 3600
       and (
         exists (select 1 from public.game_availability ga
                  where ga.game_id = o.id and ga.player_id = p_player_id and ga.status = 'available')
         or public.on_team_roster(p_player_id, o.home_team_id)
         or public.on_team_roster(p_player_id, o.away_team_id)
       )
  ) then
    return 'busy';
  end if;

  return null;
end $$;

-- Is there room on team T for one more loaned player of this position?
create or replace function public.loan_slot_block(p_game_id uuid, p_team_id uuid, p_position text)
returns text language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from public.loan_counts(p_game_id, p_team_id);
  if p_position = 'Goalkeeper' then
    return case when c.loan_gk >= 1 then 'gk_full' end;
  end if;
  return case when c.own_field + c.loan_field >= 5 then 'squad_full' end;
end $$;

create or replace function public.loan_notify_player(p_player uuid, p_type text, p_actor uuid,
  p_game_id uuid, p_data jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications(user_id, type, actor_id, entity_type, entity_id, data)
  select pr.id, p_type, p_actor, 'game', p_game_id::text, p_data
    from public.profiles pr where pr.player_id = p_player
$$;

create or replace function public.loan_notify_data(p_game_id uuid, p_team_id uuid, p_player_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'game_id', g.id, 'game_date', g.game_date,
    'home_team', th.name, 'away_team', ta.name,
    'team_id', t.id, 'team_name', t.name,
    'player_id', pl.id, 'player_name', btrim(coalesce(pl.first_name, '') || ' ' || coalesce(pl.last_name, '')))
  from public.games g
  join public.teams th on th.id = g.home_team_id
  join public.teams ta on ta.id = g.away_team_id
  join public.teams t on t.id = p_team_id
  join public.players pl on pl.id = p_player_id
  where g.id = p_game_id
$$;

create or replace function public.loan_can_manage(p_team_id uuid, p_game_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_league_manager()
      or (public.is_coach_of(p_team_id) and public.loan_game_open(p_game_id))
$$;

-- ── the coach's list ──────────────────────────────────────────────────────────────
create or replace function public.loan_candidates(p_game_id uuid, p_team_id uuid)
returns table(player_id uuid, first_name text, last_name text, jersey_number int, "position" text,
              team_id uuid, team_name text, age int, has_account boolean,
              block text, invite_id uuid, invite_status text)
language plpgsql stable security definer set search_path = public as $$
declare g record;
begin
  select id, home_team_id, away_team_id into g from public.games where id = p_game_id;
  if g.id is null or p_team_id not in (g.home_team_id, g.away_team_id) then
    raise exception 'team not in this game';
  end if;
  if not (public.is_admin() or public.is_league_manager() or public.is_judge()
          or public.is_coach_of(p_team_id)) then
    raise exception 'not authorized';
  end if;

  return query
  select pl.id, pl.first_name, pl.last_name, pl.jersey_number::int, pl."position",
         pl.team_id, t.name,
         public.player_age(pl.birth_date),
         exists (select 1 from public.profiles pr where pr.player_id = pl.id),
         public.loan_block_reason(p_game_id, p_team_id, pl.id),
         lr.id, lr.status
    from public.players pl
    left join public.teams t on t.id = pl.team_id
    left join lateral (
      select r.id, r.status from public.loan_requests r
       where r.game_id = p_game_id and r.team_id = p_team_id and r.player_id = pl.id
       order by r.created_at desc limit 1
    ) lr on true
   where not public.on_team_roster(pl.id, p_team_id)
     and coalesce(t.is_test, false) = coalesce((select tt.is_test from public.teams tt where tt.id = p_team_id), false);
end $$;

-- What the coach sees above the list: the count, and his invites for this game.
create or replace function public.loan_summary(p_game_id uuid, p_team_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  if not (public.is_admin() or public.is_league_manager() or public.is_judge()
          or public.is_coach_of(p_team_id)) then
    raise exception 'not authorized';
  end if;
  select * into c from public.loan_counts(p_game_id, p_team_id);
  return jsonb_build_object(
    'own_field', c.own_field, 'loan_field', c.loan_field, 'loan_gk', c.loan_gk,
    'field_target', 5,
    'field_slots', greatest(0, 5 - c.own_field - c.loan_field),
    'gk_slots', greatest(0, 1 - c.loan_gk),
    'open', public.loan_game_open(p_game_id),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'player_id', r.player_id, 'status', r.status, 'note', r.note,
               'created_at', r.created_at, 'responded_at', r.responded_at,
               'player_name', btrim(coalesce(pl.first_name, '') || ' ' || coalesce(pl.last_name, '')),
               'position', pl."position", 'team_name', t.name)
             order by r.created_at desc)
        from public.loan_requests r
        join public.players pl on pl.id = r.player_id
        left join public.teams t on t.id = pl.team_id
       where r.game_id = p_game_id and r.team_id = p_team_id), '[]'::jsonb));
end $$;

-- ── coach: invite / cancel ────────────────────────────────────────────────────────
create or replace function public.request_loan(p_game_id uuid, p_team_id uuid, p_player_id uuid,
  p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  g record; v_pos text; v_block text; v_id uuid;
begin
  select id, home_team_id, away_team_id into g from public.games where id = p_game_id;
  if g.id is null then raise exception 'game not found'; end if;
  if p_team_id not in (g.home_team_id, g.away_team_id) then raise exception 'team not in this game'; end if;
  if not public.loan_game_open(p_game_id) then raise exception 'game already started'; end if;
  if not public.loan_can_manage(p_team_id, p_game_id) then raise exception 'not authorized'; end if;

  v_block := public.loan_block_reason(p_game_id, p_team_id, p_player_id);
  if v_block is not null then raise exception 'loan_block:%', v_block; end if;

  select "position" into v_pos from public.players where id = p_player_id;
  v_block := public.loan_slot_block(p_game_id, p_team_id, v_pos);
  if v_block is not null then raise exception 'loan_block:%', v_block; end if;

  if not exists (select 1 from public.profiles where player_id = p_player_id) then
    raise exception 'loan_block:no_account';
  end if;
  if exists (select 1 from public.loan_requests
              where game_id = p_game_id and player_id = p_player_id and status in ('pending', 'accepted')) then
    raise exception 'loan_block:already_invited';
  end if;

  insert into public.loan_requests (game_id, team_id, player_id, requested_by, note)
  values (p_game_id, p_team_id, p_player_id, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  perform public.loan_notify_player(p_player_id, 'loan_request', auth.uid(), p_game_id,
    public.loan_notify_data(p_game_id, p_team_id, p_player_id)
      || jsonb_build_object('request_id', v_id, 'note', nullif(btrim(coalesce(p_note, '')), '')));
  return v_id;
end $$;

create or replace function public.cancel_loan(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.loan_requests where id = p_request_id;
  if r.id is null then raise exception 'request not found'; end if;
  if r.status not in ('pending', 'accepted') then raise exception 'request closed'; end if;
  if not public.loan_can_manage(r.team_id, r.game_id) then raise exception 'not authorized'; end if;

  update public.loan_requests set status = 'cancelled', closed_at = now() where id = r.id;
  if r.status = 'accepted' then
    delete from public.game_availability
     where game_id = r.game_id and player_id = r.player_id and team_id = r.team_id;
  end if;
  perform public.loan_notify_player(r.player_id, 'loan_cancelled', auth.uid(), r.game_id,
    public.loan_notify_data(r.game_id, r.team_id, r.player_id)
      || jsonb_build_object('request_id', r.id, 'reason', 'coach'));
end $$;

-- ── player: my invites / answer ───────────────────────────────────────────────────
create or replace function public.my_loan_requests()
returns table(id uuid, game_id uuid, team_id uuid, team_name text, status text, note text,
              game_date timestamptz, home_team text, away_team text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.game_id, r.team_id, t.name, r.status, r.note, g.game_date, th.name, ta.name, r.created_at
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

-- Returns 'accepted' | 'declined' | 'filled' (the squad filled before he answered).
create or replace function public.respond_loan(p_request_id uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  r record; v_pos text; v_block text; v_data jsonb;
begin
  select * into r from public.loan_requests where id = p_request_id for update;
  if r.id is null then raise exception 'request not found'; end if;
  if r.player_id is distinct from public.my_player_id() then raise exception 'not authorized'; end if;
  if r.status <> 'pending' then raise exception 'request closed'; end if;
  if not public.loan_game_open(r.game_id) then raise exception 'game already started'; end if;

  v_data := public.loan_notify_data(r.game_id, r.team_id, r.player_id) || jsonb_build_object('request_id', r.id);

  if not p_accept then
    update public.loan_requests set status = 'declined', responded_at = clock_timestamp(), closed_at = now() where id = r.id;
    perform public.notify_team_reviewers(r.team_id, 'loan_declined', auth.uid(), 'game', r.game_id::text, v_data);
    return 'declined';
  end if;

  v_block := public.loan_block_reason(r.game_id, r.team_id, r.player_id);
  if v_block is not null then raise exception 'loan_block:%', v_block; end if;

  select "position" into v_pos from public.players where id = r.player_id;
  if public.loan_slot_block(r.game_id, r.team_id, v_pos) is not null then
    update public.loan_requests set status = 'filled', responded_at = clock_timestamp(), closed_at = now() where id = r.id;
    return 'filled';
  end if;

  update public.loan_requests set status = 'accepted', responded_at = clock_timestamp() where id = r.id;
  insert into public.game_availability (game_id, player_id, status, added_by, team_id, note, age_confirmed, updated_at)
  values (r.game_id, r.player_id, 'available', r.requested_by, r.team_id, coalesce(r.note, 'שחקן בהשאלה'), true, now())
  on conflict (game_id, player_id) do update
    set status = 'available', added_by = excluded.added_by, team_id = excluded.team_id,
        note = excluded.note, age_confirmed = true, updated_at = now();

  perform public.notify_team_reviewers(r.team_id, 'loan_accepted', auth.uid(), 'game', r.game_id::text, v_data);

  -- That was the last seat: close the other open invites of the same kind.
  if public.loan_slot_block(r.game_id, r.team_id, v_pos) is not null then
    perform public.loan_close_filled(r.game_id, r.team_id, v_pos = 'Goalkeeper');
  end if;
  return 'accepted';
end $$;

create or replace function public.loan_close_filled(p_game_id uuid, p_team_id uuid, p_gk boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select lr.* from public.loan_requests lr join public.players pl on pl.id = lr.player_id
     where lr.game_id = p_game_id and lr.team_id = p_team_id and lr.status = 'pending'
       and (pl."position" = 'Goalkeeper') = p_gk
  loop
    update public.loan_requests set status = 'filled', closed_at = now() where id = r.id;
    perform public.loan_notify_player(r.player_id, 'loan_cancelled', null, r.game_id,
      public.loan_notify_data(r.game_id, r.team_id, r.player_id)
        || jsonb_build_object('request_id', r.id, 'reason', 'filled'));
  end loop;
end $$;

-- ── automatic removal ─────────────────────────────────────────────────────────────
-- Own field players signed up after the loans and the team is over five: drop the loan
-- that came in LAST, until it fits. Before kick-off only.
create or replace function public.enforce_loan_cap(p_game_id uuid, p_team_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record; v record; v_data jsonb;
begin
  if not public.loan_game_open(p_game_id) then return; end if;
  loop
    select * into c from public.loan_counts(p_game_id, p_team_id);
    exit when c.loan_field = 0 or c.own_field + c.loan_field <= 5;

    select ga.player_id, ga.created_at, lr.id as req_id
      into v
      from public.game_availability ga
      join public.players pl on pl.id = ga.player_id
      left join public.loan_requests lr
        on lr.game_id = ga.game_id and lr.player_id = ga.player_id and lr.status = 'accepted'
     where ga.game_id = p_game_id and ga.team_id = p_team_id and ga.status = 'available'
       and pl."position" <> 'Goalkeeper'
       and not public.on_team_roster(ga.player_id, p_team_id)
     order by coalesce(lr.responded_at, ga.updated_at) desc, ga.updated_at desc
     limit 1;
    exit when v.player_id is null;

    delete from public.game_availability where game_id = p_game_id and player_id = v.player_id;
    if v.req_id is not null then
      update public.loan_requests set status = 'removed', closed_at = now() where id = v.req_id;
    end if;

    v_data := public.loan_notify_data(p_game_id, p_team_id, v.player_id)
              || jsonb_build_object('own_field', c.own_field);
    perform public.loan_notify_player(v.player_id, 'loan_removed', null, p_game_id, v_data);
    perform public.notify_team_reviewers(p_team_id, 'loan_removed', null, 'game', p_game_id::text,
      v_data || jsonb_build_object('for_coach', true));
  end loop;
end $$;

create or replace function public.trg_game_availability_loan_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare g record;
begin
  if new.status <> 'available' then return null; end if;
  select home_team_id, away_team_id into g from public.games where id = new.game_id;
  if g.home_team_id is not null then perform public.enforce_loan_cap(new.game_id, g.home_team_id); end if;
  if g.away_team_id is not null then perform public.enforce_loan_cap(new.game_id, g.away_team_id); end if;
  return null;
end $$;

drop trigger if exists trg_game_availability_loan_cap on public.game_availability;
create trigger trg_game_availability_loan_cap
  after insert or update of status, team_id on public.game_availability
  for each row execute function public.trg_game_availability_loan_cap();

-- A player who signs out of a loan (לא מגיע) closes his invite, so the seat is free and
-- the coach's list says so.
create or replace function public.trg_game_availability_loan_withdraw()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if tg_op = 'DELETE' then
    update public.loan_requests set status = 'cancelled', closed_at = now()
     where game_id = old.game_id and player_id = old.player_id and status = 'accepted';
    return null;
  end if;
  if new.status <> 'available' then
    with closed as (
      update public.loan_requests set status = 'declined', closed_at = now()
       where game_id = new.game_id and player_id = new.player_id and status = 'accepted'
      returning id, team_id
    )
    select id, team_id into r from closed;
    if r.id is not null then
      perform public.notify_team_reviewers(r.team_id, 'loan_declined', auth.uid(), 'game', new.game_id::text,
        public.loan_notify_data(new.game_id, r.team_id, new.player_id)
          || jsonb_build_object('request_id', r.id, 'withdrew', true));
    end if;
  end if;
  return null;
end $$;

drop trigger if exists trg_game_availability_loan_withdraw on public.game_availability;
create trigger trg_game_availability_loan_withdraw
  after update of status or delete on public.game_availability
  for each row execute function public.trg_game_availability_loan_withdraw();

-- ── direct add: same cap, and a coach must invite anyone who has an account ───────
create or replace function public.add_player_to_squad(p_game_id uuid, p_player_id uuid, p_team_id uuid,
  p_note text default null, p_age_confirmed boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  g record; p record;
  v_not_started boolean; v_is_loan boolean; v_age int; v_official boolean; v_slot text;
begin
  select id, home_team_id, away_team_id, game_date, status
    into g from public.games where id = p_game_id;
  if g.id is null then raise exception 'game not found'; end if;

  if p_team_id is null or p_team_id not in (g.home_team_id, g.away_team_id) then
    raise exception 'team not in this game';
  end if;

  select id, team_id, "position", birth_date into p from public.players where id = p_player_id;
  if p.id is null then raise exception 'player not found'; end if;

  v_not_started := (g.game_date > now()) and (g.status in ('scheduled', 'postponed'));
  v_official := public.is_admin() or public.is_league_manager() or public.is_judge();

  if v_official then
    null;
  elsif public.is_coach_of(p_team_id) then
    if not v_not_started then raise exception 'game already started'; end if;
  else
    raise exception 'not authorized';
  end if;

  v_is_loan := not public.on_team_roster(p_player_id, p_team_id);

  if v_is_loan then
    -- a coach invites a player who can answer; the direct add is for those who cannot
    if not v_official and exists (select 1 from public.profiles where player_id = p_player_id) then
      raise exception 'loan needs invite';
    end if;
    if public.on_team_roster(p_player_id,
         case when p_team_id = g.home_team_id then g.away_team_id else g.home_team_id end) then
      raise exception 'loan_block:opponent';
    end if;
    v_age := public.player_age(p.birth_date);
    if p."position" = 'Goalkeeper' then
      null;                                   -- a borrowed keeper may be any age
    elsif v_age is not null then
      if v_age >= 18 then raise exception 'loan not youth'; end if;
    elsif not p_age_confirmed then
      raise exception 'age not confirmed';    -- no DOB on file → the coach vouches
    end if;
    v_slot := public.loan_slot_block(p_game_id, p_team_id, p."position");
    if v_slot is not null then raise exception 'loan_block:%', v_slot; end if;
  end if;

  if public.is_suspended(p_player_id) then raise exception 'suspended'; end if;

  if public.is_unavailable(p_player_id, g.game_date::date) then
    raise exception 'unavailable';
  end if;

  if not exists (
    select 1 from public.medical_certificates
    where player_id = p_player_id and status = 'approved'
      and (expires_at is null or expires_at >= current_date)
  ) then
    raise exception 'no valid medical';
  end if;

  insert into public.game_availability
    (game_id, player_id, status, added_by, team_id, note, age_confirmed, updated_at)
  values
    (p_game_id, p_player_id, 'available', (select auth.uid()), p_team_id,
     nullif(btrim(coalesce(p_note, '')), ''), true, now())
  on conflict (game_id, player_id) do update
    set status = 'available', added_by = excluded.added_by, team_id = excluded.team_id,
        note = excluded.note, age_confirmed = true, updated_at = now();
end;
$$;

-- ── grants ────────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'loan_game_open(uuid)', 'on_team_roster(uuid,uuid)', 'loan_counts(uuid,uuid)',
    'loan_block_reason(uuid,uuid,uuid)', 'loan_slot_block(uuid,uuid,text)',
    'loan_notify_player(uuid,text,uuid,uuid,jsonb)', 'loan_notify_data(uuid,uuid,uuid)',
    'loan_can_manage(uuid,uuid)', 'loan_close_filled(uuid,uuid,boolean)',
    'enforce_loan_cap(uuid,uuid)', 'trg_game_availability_loan_cap()',
    'trg_game_availability_loan_withdraw()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'loan_candidates(uuid,uuid)', 'loan_summary(uuid,uuid)', 'request_loan(uuid,uuid,uuid,text)',
    'cancel_loan(uuid)', 'my_loan_requests()', 'respond_loan(uuid,boolean)',
    'add_player_to_squad(uuid,uuid,uuid,text,boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
