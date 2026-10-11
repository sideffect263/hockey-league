-- Game form: what the judge recorded, who captained, and digital signatures.
--
-- Three gaps in the exported טופס שיפוט, all closed here:
--
--  1. TEAM FOULS / TIMEOUTS / HALF-TIME SCORE. The judge board tracks all three, but
--     judge_save_game_result deletes the live_game_state row on finish, so they were
--     gone the moment the game ended. A trigger on live_game_state now keeps an archive
--     in game_reports on every broadcast — no client change, so the iOS and Android
--     judge boards are covered without a release.
--       * `final_state` = the web board's full engine snapshot (exact; native boards
--         don't send one).
--       * `events` = a running merge of the spectator play-by-play every board sends.
--         Clients cap that list at the last 40 events, so a long game would lose its
--         early fouls; the merge keeps whatever scrolled out of the window and lets the
--         window itself replace everything inside its range (so an undone foul that is
--         still inside the window disappears, as it should).
--
--  2. CAPTAINS. teams.captain_player_id is the season captain (coach / LM / admin).
--     game_reports.home_captain_id / away_captain_id override it for one game, and are
--     stamped from the team captain when the game completes — that's the record of who
--     actually captained, so the history survives a later change of captain.
--
--  3. SIGNATURES. game_signatures holds one finger-drawn PNG per role per game:
--     referee, medic, each coach, each captain. Each person signs from their own
--     account; eligibility is checked server-side. No direct table access — RPCs only.
--
-- Down: supabase/game-form-signing-down.sql

-- ---------------------------------------------------------------- captains
-- NO foreign key: an FK here gives PostgREST a second players↔teams relationship and every
-- players↔teams embed fails with PGRST201 (broke player pages + the medical queue on
-- 2026-10-11). Deleting a player clears it via a trigger instead — captain-fk-to-trigger.sql.
alter table public.teams
  add column if not exists captain_player_id uuid;

-- ---------------------------------------------------------------- game_reports
create table if not exists public.game_reports (
  game_id          uuid primary key references public.games(id) on delete cascade,
  final_state      jsonb,
  events           jsonb not null default '[]'::jsonb,
  home_captain_id  uuid references public.players(id) on delete set null,
  away_captain_id  uuid references public.players(id) on delete set null,
  updated_at       timestamptz not null default now()
);
create index if not exists game_reports_home_captain_idx on public.game_reports(home_captain_id);
create index if not exists game_reports_away_captain_idx on public.game_reports(away_captain_id);

alter table public.game_reports enable row level security;
-- Fouls, timeouts and captains are public match facts (the live feed already shows
-- them). Reading through games' own RLS keeps hidden test games hidden.
drop policy if exists game_reports_read on public.game_reports;
create policy game_reports_read on public.game_reports for select to anon, authenticated
  using (exists (select 1 from public.games g where g.id = game_id));
grant select on public.game_reports to anon, authenticated;

-- Chronological sort key for a play-by-play event: period, then elapsed time
-- (timeMS is the clock's REMAINING time, so larger = earlier).
create or replace function public._game_event_key(e jsonb)
returns bigint language sql immutable as $$
  select (case e->>'period'
            when '1' then 1 when '2' then 2 when '3' then 3
            when 'הארכה 1' then 4 when 'הארכה 2' then 5 else 0 end)::bigint * 100000000
         - coalesce(nullif(e->>'timeMS', '')::bigint, 0)
$$;

-- Clients send at most this many events (web/iOS/Android all use 40).
create or replace function public._archive_live_state()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  win jsonb := new.state->'events';
  snap jsonb := new.state->'snapshot';
  old_events jsonb;
  win_start bigint;
  merged jsonb;
begin
  if win is null or jsonb_typeof(win) <> 'array' then
    -- Nothing to merge; still keep a snapshot if one came.
    if snap is not null then
      insert into game_reports (game_id, final_state) values (new.game_id, snap)
      on conflict (game_id) do update set final_state = excluded.final_state, updated_at = now();
    end if;
    return new;
  end if;

  if jsonb_array_length(win) < 40 then
    merged := win;                          -- the window IS the whole game
  else
    select events into old_events from game_reports where game_id = new.game_id;
    select min(public._game_event_key(e)) into win_start from jsonb_array_elements(win) e;
    select coalesce(jsonb_agg(e order by public._game_event_key(e)), '[]'::jsonb) into merged
      from (
        select e from jsonb_array_elements(coalesce(old_events, '[]'::jsonb)) e
         where public._game_event_key(e) <= win_start  -- <=: a foul + card at one paused instant share a key; the id check dedupes
           and not exists (select 1 from jsonb_array_elements(win) w where w->>'id' = e->>'id')
        union all
        select e from jsonb_array_elements(win) e
      ) s;
  end if;

  insert into game_reports (game_id, events, final_state)
  values (new.game_id, merged, snap)
  on conflict (game_id) do update
    set events = excluded.events,
        final_state = coalesce(excluded.final_state, game_reports.final_state),
        updated_at = now();
  return new;
-- The archive must never cost the live broadcast: a failure here would otherwise
-- roll back the judge's upsert and freeze every spectator's scoreboard.
exception when others then
  return new;
end $$;

drop trigger if exists live_game_state_archive on public.live_game_state;
create trigger live_game_state_archive
  after insert or update of state on public.live_game_state
  for each row execute function public._archive_live_state();

-- Stamp the captains when a game completes (an override already set wins).
create or replace function public._stamp_game_captains()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    insert into game_reports (game_id, home_captain_id, away_captain_id)
    values (new.id,
            (select captain_player_id from teams where id = new.home_team_id),
            (select captain_player_id from teams where id = new.away_team_id))
    on conflict (game_id) do update
      set home_captain_id = coalesce(game_reports.home_captain_id, excluded.home_captain_id),
          away_captain_id = coalesce(game_reports.away_captain_id, excluded.away_captain_id),
          updated_at = now();
  end if;
  return new;
end $$;

drop trigger if exists games_stamp_captains on public.games;
create trigger games_stamp_captains
  after update of status on public.games
  for each row execute function public._stamp_game_captains();

-- Effective captain of one side: the game's override/stamp, else the team captain.
create or replace function public.game_captain(p_game_id uuid, p_side text)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    case when p_side = 'home' then gr.home_captain_id else gr.away_captain_id end,
    t.captain_player_id)
  from games g
  join teams t on t.id = case when p_side = 'home' then g.home_team_id else g.away_team_id end
  left join game_reports gr on gr.game_id = g.id
  where g.id = p_game_id
$$;
grant execute on function public.game_captain(uuid, text) to anon, authenticated;

-- A player belongs to a team via player_teams (multi-age) or the players.team_id mirror.
create or replace function public._player_on_team(p_player uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_teams where player_id = p_player and team_id = p_team)
      or exists (select 1 from players where id = p_player and team_id = p_team)
$$;

create or replace function public.set_team_captain(p_team_id uuid, p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(is_admin() or is_league_manager() or is_coach_of(p_team_id), false) then
    raise exception 'not authorized';
  end if;
  if p_player_id is not null and not _player_on_team(p_player_id, p_team_id) then
    raise exception 'player is not on this team';
  end if;
  update teams set captain_player_id = p_player_id where id = p_team_id;
end $$;
grant execute on function public.set_team_captain(uuid, uuid) to authenticated;

-- Per-game captain. A borrowed player who played for the side counts too.
create or replace function public.set_game_captain(p_game_id uuid, p_side text, p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare g games; tid uuid;
begin
  if p_side not in ('home', 'away') then raise exception 'bad side'; end if;
  select * into g from games where id = p_game_id;
  if not found then raise exception 'game not found'; end if;
  tid := case when p_side = 'home' then g.home_team_id else g.away_team_id end;
  if not coalesce(is_admin() or is_league_manager() or is_judge() or is_coach_of(tid), false) then
    raise exception 'not authorized';
  end if;
  if p_player_id is not null
     and not _player_on_team(p_player_id, tid)
     and not exists (select 1 from game_stats where game_id = p_game_id and player_id = p_player_id and played_for_team_id = tid) then
    raise exception 'player is not on this team';
  end if;
  insert into game_reports (game_id) values (p_game_id) on conflict do nothing;
  if p_side = 'home' then
    update game_reports set home_captain_id = p_player_id, updated_at = now() where game_id = p_game_id;
  else
    update game_reports set away_captain_id = p_player_id, updated_at = now() where game_id = p_game_id;
  end if;
end $$;
grant execute on function public.set_game_captain(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------- signatures
create table if not exists public.game_signatures (
  game_id     uuid not null references public.games(id) on delete cascade,
  role        text not null check (role in ('referee', 'medic', 'home_coach', 'away_coach', 'home_captain', 'away_captain')),
  user_id     uuid not null references auth.users(id) on delete cascade,
  signer_name text not null default '',
  image       text not null,
  signed_at   timestamptz not null default now(),
  primary key (game_id, role)
);
create index if not exists game_signatures_user_idx on public.game_signatures(user_id);
alter table public.game_signatures enable row level security;
-- No policies on purpose: read and write only through the RPCs below.

-- Can `uid` sign game `gid` as `role`?
create or replace function public._can_sign_game(gid uuid, p_role text, uid uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare g games; my_player uuid;
begin
  if uid is null then return false; end if;
  select * into g from games where id = gid;
  if not found then return false; end if;
  select player_id into my_player from profiles where id = uid;
  return case p_role
    when 'referee' then
      exists (select 1 from game_officials where game_id = gid and user_id = uid and role = 'judge' and status in ('assigned', 'approved'))
      or (my_player is not null and g.referee_id = my_player::text)
    when 'medic' then
      exists (select 1 from game_officials where game_id = gid and user_id = uid and role = 'medic' and status in ('assigned', 'approved'))
    when 'home_coach' then
      exists (select 1 from user_roles where user_id = uid and role = 'coach' and team_id = g.home_team_id)
    when 'away_coach' then
      exists (select 1 from user_roles where user_id = uid and role = 'coach' and team_id = g.away_team_id)
    when 'home_captain' then my_player is not null and my_player = game_captain(gid, 'home')
    when 'away_captain' then my_player is not null and my_player = game_captain(gid, 'away')
    else false
  end;
end $$;

-- The roles the caller may sign for this game (drives the "sign" buttons).
create or replace function public.game_sign_roles(p_game_id uuid)
returns setof text language sql stable security definer set search_path = public as $$
  select r from unnest(array['referee', 'medic', 'home_coach', 'away_coach', 'home_captain', 'away_captain']) r
  where public._can_sign_game(p_game_id, r, auth.uid())
$$;
grant execute on function public.game_sign_roles(uuid) to authenticated;

create or replace function public.sign_game_form(p_game_id uuid, p_role text, p_image text)
returns void language plpgsql security definer set search_path = public as $$
declare st text; existing uuid; nm text;
begin
  select status into st from games where id = p_game_id;
  if not found then raise exception 'game not found'; end if;
  if st <> 'completed' then raise exception 'game not completed'; end if;
  if not _can_sign_game(p_game_id, p_role, auth.uid()) then raise exception 'not authorized'; end if;
  if p_image is null or p_image not like 'data:image/png;base64,%' or length(p_image) > 400000 then
    raise exception 'invalid signature image';
  end if;
  select user_id into existing from game_signatures where game_id = p_game_id and role = p_role;
  -- Two coaches of one team can both hold the role; the first signature stands until
  -- its signer (or an admin) clears it.
  if existing is not null and existing <> auth.uid() then raise exception 'already signed'; end if;
  select coalesce(nullif(btrim(display_name), ''), '') into nm from profiles where id = auth.uid();
  insert into game_signatures (game_id, role, user_id, signer_name, image, signed_at)
  values (p_game_id, p_role, auth.uid(), coalesce(nm, ''), p_image, now())
  on conflict (game_id, role) do update
    set image = excluded.image, signer_name = excluded.signer_name, signed_at = now();
end $$;
grant execute on function public.sign_game_form(uuid, text, text) to authenticated;

create or replace function public.clear_game_signature(p_game_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(is_admin() or is_league_manager(), false) then
    delete from game_signatures where game_id = p_game_id and role = p_role;
  else
    delete from game_signatures where game_id = p_game_id and role = p_role and user_id = auth.uid();
  end if;
end $$;
grant execute on function public.clear_game_signature(uuid, text) to authenticated;

-- Who signed. Names + times for anyone involved in the game (the export set, plus
-- anyone who may sign it); the images go out with the same gate.
create or replace function public.game_form_signatures(p_game_id uuid)
returns table(role text, signer_name text, signed_at timestamptz, image text, is_mine boolean)
language plpgsql stable security definer set search_path = public as $$
declare g games;
begin
  select * into g from games where id = p_game_id;
  if not found then return; end if;
  if not coalesce(
       is_admin() or is_league_manager() or is_judge()
       or is_coach_of(g.home_team_id) or is_coach_of(g.away_team_id)
       or exists (select 1 from game_sign_roles(p_game_id)),
       false) then
    raise exception 'not authorized';
  end if;
  return query
    select s.role, s.signer_name, s.signed_at, s.image, s.user_id = auth.uid()
      from game_signatures s where s.game_id = p_game_id;
end $$;
grant execute on function public.game_form_signatures(uuid) to authenticated;

-- Internal helpers: not callable from the API.
revoke execute on function public._can_sign_game(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public._player_on_team(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._archive_live_state() from public, anon, authenticated;
revoke execute on function public._stamp_game_captains() from public, anon, authenticated;
