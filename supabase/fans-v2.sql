-- fans-v2.sql (2026-10-19)
-- ---------------------------------------------------------------------------
-- The fan (follows) feature, refined. Ariel's rule: a player is NOT a fan of their
-- own team. Before this, 22 of the 24 team "fans" were that team's own players,
-- so the count on every team page was really a roster count.
--
--  1. is_real_fan()           one definition of "fan": the follow row, minus the
--                             team's own players (players.team_id or player_teams),
--                             minus a player following himself.
--  2. follower_counts()       counts real fans only (same signature, so the web and
--                             BOTH native apps pick it up with no release).
--  3. game_followers()        stops pushing a game's goals/result to users whose own
--                             player is in that game's squad (they are on the court).
--     game_fans(game, true)   the day-before "game tomorrow" alert also skips the
--                             teams' own players: they already get the sign-up reminder.
--  4. fan_badges()            "אוהד/ת <team>" next to a commenter's name + fan-since.
--  5. game_watchers           NEW: a signed-in fan marks "אני בא/ה לצפות" on an
--                             upcoming game. Counts only are public.
--     set_game_watch(), game_fan_summary()
--  6. team_fan_stats()        coach / admin / league manager: fans over time, bell on,
--                             new this month, coming to the next game. Counts only.
--     admin_fan_overview()    admin / league manager: the same per team.
--
-- Rows in follows are NOT deleted: a player who fanned his own team keeps the row
-- (it still ranks his team up in his feed); it just is not counted or pushed as a fan.
-- Rollback: fans-v2-down.sql
-- ---------------------------------------------------------------------------

-- 1. -------------------------------------------------------------------------
create or replace function public.is_real_fan(p_user uuid, p_type text, p_target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.profiles pr
     where pr.id = p_user and pr.player_id is not null
       and (
         (p_type = 'player' and pr.player_id = p_target)
         or (p_type = 'team' and (
               exists (select 1 from public.players p
                        where p.id = pr.player_id and p.team_id = p_target)
               or exists (select 1 from public.player_teams pt
                           where pt.player_id = pr.player_id and pt.team_id = p_target)))
       )
  )
$$;
revoke all on function public.is_real_fan(uuid, text, uuid) from public, anon, authenticated;

-- The viewer's own teams (as a player). Lets the fan button say "הקבוצה שלי".
create or replace function public.my_roster_team_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.team_id from public.profiles pr
    join public.players p on p.id = pr.player_id
   where pr.id = auth.uid() and p.team_id is not null
  union
  select pt.team_id from public.profiles pr
    join public.player_teams pt on pt.player_id = pr.player_id
   where pr.id = auth.uid()
$$;
revoke all on function public.my_roster_team_ids() from public, anon;
grant execute on function public.my_roster_team_ids() to authenticated;

-- 2. -------------------------------------------------------------------------
create or replace function public.follower_counts(p_type text, p_ids uuid[])
returns table (target_id uuid, followers bigint)
language sql stable security definer set search_path = public as $$
  select f.target_id, count(*)::bigint
  from public.follows f
  where f.target_type = p_type and f.target_id = any(p_ids)
    and public.is_real_fan(f.user_id, f.target_type, f.target_id)
  group by f.target_id
$$;
grant execute on function public.follower_counts(text, uuid[]) to authenticated, anon;

-- 3. -------------------------------------------------------------------------
-- p_skip_roster = also drop the two teams' own players, whether or not they play.
create or replace function public.game_fans(p_game uuid, p_skip_roster boolean)
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select distinct f.user_id
  from public.follows f
  join public.games g on g.id = p_game
  where f.notify
    and (
      (f.target_type = 'team' and f.target_id in (g.home_team_id, g.away_team_id))
      or (f.target_type = 'player' and exists (
            select 1 from public.players p
            where p.id = f.target_id
              and (p.team_id in (g.home_team_id, g.away_team_id)
                   or exists (select 1 from public.player_teams pt
                              where pt.player_id = p.id
                                and pt.team_id in (g.home_team_id, g.away_team_id)))))
    )
    -- on the court for this game: signed up as coming, or already in the box score
    and not exists (
      select 1 from public.profiles pr
       where pr.id = f.user_id and pr.player_id is not null
         and (exists (select 1 from public.game_availability ga
                       where ga.game_id = p_game and ga.player_id = pr.player_id
                         and ga.status::text = 'available')
              or exists (select 1 from public.game_stats gs
                          where gs.game_id = p_game and gs.player_id = pr.player_id)))
    and (not p_skip_roster or (
          public.is_real_fan(f.user_id, 'team', g.home_team_id)
          and public.is_real_fan(f.user_id, 'team', g.away_team_id)))
$$;
revoke all on function public.game_fans(uuid, boolean) from public, anon, authenticated;

create or replace function public.game_followers(p_game uuid)
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select user_id from public.game_fans(p_game, false)
$$;
revoke all on function public.game_followers(uuid) from public, anon;
grant execute on function public.game_followers(uuid) to authenticated;

-- The day-before alert lives inside send_game_reminder. Swap only that one call,
-- in place, so the rest of the (long, prod-tuned) function is untouched.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.send_game_reminder(text,uuid,date,uuid)'::regprocedure);
  v_new := replace(v_def, 'public.game_followers(p_game)', 'public.game_fans(p_game, true)');
  if v_new = v_def then
    raise exception 'send_game_reminder: game_followers(p_game) call not found';
  end if;
  execute v_new;
end $$;

-- 4. -------------------------------------------------------------------------
-- One badge per commenter: the team they have been a fan of longest. Public on
-- purpose (it is a badge next to something they posted publicly); never a list.
create or replace function public.fan_badges(p_user_ids uuid[])
returns table (user_id uuid, team_id uuid, team_name text, since timestamptz)
language sql stable security definer set search_path = public as $$
  select distinct on (f.user_id) f.user_id, t.id, t.name, f.created_at
  from public.follows f
  join public.teams t on t.id = f.target_id
  where f.target_type = 'team'
    and f.user_id = any(p_user_ids)
    and coalesce(t.is_test, false) = false
    and public.is_real_fan(f.user_id, 'team', f.target_id)
  order by f.user_id, f.created_at
$$;
grant execute on function public.fan_badges(uuid[]) to authenticated, anon;

-- 5. -------------------------------------------------------------------------
create table if not exists public.game_watchers (
  game_id    uuid not null references public.games(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (game_id, user_id)
);
create index if not exists game_watchers_user_idx on public.game_watchers(user_id);

-- Own rows only; writes go through set_game_watch (it checks the game is open).
alter table public.game_watchers enable row level security;
drop policy if exists "read own watch" on public.game_watchers;
create policy "read own watch" on public.game_watchers
  for select using (user_id = (select auth.uid()));

-- Which side a watcher sits on: a fan of exactly one of the two teams.
create or replace function public.game_fan_summary(p_game uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g record; v_uid uuid := auth.uid(); r jsonb;
begin
  select id, home_team_id, away_team_id, status, game_date, coalesce(is_test, false) as is_test
    into g from public.games where id = p_game;
  if not found then return null; end if;
  if g.is_test and not coalesce(public.can_see_test(), false) then return null; end if;

  with fans as (
    select f.user_id, f.target_id from public.follows f
     where f.target_type = 'team' and f.target_id in (g.home_team_id, g.away_team_id)
       and public.is_real_fan(f.user_id, 'team', f.target_id)
  ), w as (
    select gw.user_id,
           bool_or(fh.user_id is not null) as home, bool_or(fa.user_id is not null) as away
      from public.game_watchers gw
      left join fans fh on fh.user_id = gw.user_id and fh.target_id = g.home_team_id
      left join fans fa on fa.user_id = gw.user_id and fa.target_id = g.away_team_id
     where gw.game_id = p_game
     group by gw.user_id
  )
  select jsonb_build_object(
    'home_fans',   (select count(*) from fans where target_id = g.home_team_id),
    'away_fans',   (select count(*) from fans where target_id = g.away_team_id),
    'coming',      (select count(*) from w),
    'home_coming', (select count(*) from w where home and not away),
    'away_coming', (select count(*) from w where away and not home),
    'open',        (g.status = 'scheduled' and g.game_date > now() - interval '3 hours'),
    'me_coming',   (v_uid is not null and exists (select 1 from public.game_watchers
                                                   where game_id = p_game and user_id = v_uid)),
    'me_roster',   (v_uid is not null and not (public.is_real_fan(v_uid, 'team', g.home_team_id)
                                               and public.is_real_fan(v_uid, 'team', g.away_team_id)))
  ) into r;
  return r;
end $$;
grant execute on function public.game_fan_summary(uuid) to authenticated, anon;

create or replace function public.set_game_watch(p_game uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select id, home_team_id, away_team_id, status, game_date, coalesce(is_test, false) as is_test
    into g from public.games where id = p_game;
  if not found then raise exception 'game not found'; end if;
  if g.is_test and not coalesce(public.can_see_test(), false) then raise exception 'game not found'; end if;

  if coalesce(p_on, true) then
    if g.status <> 'scheduled' or g.game_date <= now() - interval '3 hours' then
      raise exception 'game not open';
    end if;
    -- the two teams' own players are playing, not watching
    if not (public.is_real_fan(v_uid, 'team', g.home_team_id)
            and public.is_real_fan(v_uid, 'team', g.away_team_id)) then
      raise exception 'player in game';
    end if;
    insert into public.game_watchers (game_id, user_id) values (p_game, v_uid)
    on conflict do nothing;
  else
    delete from public.game_watchers where game_id = p_game and user_id = v_uid;
  end if;
  return public.game_fan_summary(p_game);
end $$;
revoke all on function public.set_game_watch(uuid, boolean) from public, anon;
grant execute on function public.set_game_watch(uuid, boolean) to authenticated;

-- 6. -------------------------------------------------------------------------
create or replace function public.team_fan_stats(p_team uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_next record;
begin
  if not (coalesce(public.is_admin(), false) or coalesce(public.is_league_manager(), false)
          or coalesce(public.is_coach_of(p_team), false)) then
    raise exception 'not authorized';
  end if;

  select id, game_date, case when home_team_id = p_team then away_team_id else home_team_id end as opp
    into v_next
    from public.games
   where (home_team_id = p_team or away_team_id = p_team)
     and status = 'scheduled' and game_date > now() - interval '3 hours'
     and coalesce(is_test, false) = false
   order by game_date limit 1;

  with fans as (
    select f.user_id, f.notify, f.created_at from public.follows f
     where f.target_type = 'team' and f.target_id = p_team
       and public.is_real_fan(f.user_id, 'team', p_team)
  ), weeks as (
    select generate_series(date_trunc('week', now()) - interval '11 weeks',
                           date_trunc('week', now()), interval '1 week') as wk
  )
  select jsonb_build_object(
    'fans',        (select count(*) from fans),
    'notify',      (select count(*) from fans where notify),
    'new_30d',     (select count(*) from fans where created_at > now() - interval '30 days'),
    'weekly',      (select jsonb_agg(jsonb_build_object(
                       'week', wk::date,
                       'total', (select count(*) from fans where created_at < wk + interval '1 week'))
                     order by wk) from weeks),
    'next_game',   case when v_next.id is null then null else jsonb_build_object(
                     'id', v_next.id, 'game_date', v_next.game_date,
                     'opponent', (select name from public.teams where id = v_next.opp),
                     'coming', (select count(*) from public.game_watchers where game_id = v_next.id),
                     'fans_coming', (select count(*) from public.game_watchers w
                                      join fans on fans.user_id = w.user_id
                                     where w.game_id = v_next.id)) end
  ) into r;
  return r;
end $$;
revoke all on function public.team_fan_stats(uuid) from public, anon;
grant execute on function public.team_fan_stats(uuid) to authenticated;

create or replace function public.admin_fan_overview()
returns table (team_id uuid, team_name text, fans bigint, notify bigint, new_30d bigint,
               roster_follows bigint, next_game_id uuid, next_game_date timestamptz, coming_next bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (coalesce(public.is_admin(), false) or coalesce(public.is_league_manager(), false)) then
    raise exception 'not authorized';
  end if;
  return query
  select t.id, t.name,
    count(f.*) filter (where f.real),
    count(f.*) filter (where f.real and f.notify),
    count(f.*) filter (where f.real and f.created_at > now() - interval '30 days'),
    count(f.*) filter (where f.user_id is not null and not f.real),
    ng.id, ng.game_date,
    (select count(*) from public.game_watchers w where w.game_id = ng.id)
  from public.teams t
  left join lateral (
    select fo.user_id, fo.notify, fo.created_at,
           public.is_real_fan(fo.user_id, 'team', t.id) as real
      from public.follows fo where fo.target_type = 'team' and fo.target_id = t.id
  ) f on true
  left join lateral (
    select gm.id, gm.game_date from public.games gm
     where (gm.home_team_id = t.id or gm.away_team_id = t.id)
       and gm.status = 'scheduled' and gm.game_date > now() - interval '3 hours'
       and coalesce(gm.is_test, false) = false
     order by gm.game_date limit 1
  ) ng on true
  where coalesce(t.is_test, false) = false
  group by t.id, t.name, ng.id, ng.game_date
  order by 3 desc, t.name;
end $$;
revoke all on function public.admin_fan_overview() from public, anon;
grant execute on function public.admin_fan_overview() to authenticated;
