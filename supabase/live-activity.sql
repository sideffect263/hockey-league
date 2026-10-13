-- Live Activities: the live game on the iPhone Lock Screen + Dynamic Island (2026-10-13).
--
-- ADDITIVE ONLY: three new tables, four RPCs, two new AFTER triggers. Nothing existing is
-- altered. Rollback: live-activity-down.sql.
--
--   live_activity_tokens        one row per (device, game): the ActivityKit push token of
--                               a running activity. Tokens rotate → upsert.
--   live_activity_start_tokens  one row per device: the iOS 17.2+ push-to-start token, so
--                               the server can START an activity for a team's followers
--                               at kickoff without the app being opened.
--   live_activity_games         server-only bookkeeping per game: what was last pushed
--                               (dedupe + rate limit), when push-to-start went out.
--
-- `platform` is 'ios' today. Android will reuse both token tables with platform =
-- 'android' and its existing FCM token (an ongoing "Live Update" notification).
--
-- Delivery: an AFTER trigger on live_game_state (every judge broadcast) and on
-- games.status → 'completed' posts {game_id, op} to the `live-activity-push` edge function
-- through pg_net (async: queued, sent after commit). It only posts when somebody could
-- receive something, and every trigger body is wrapped in `exception when others` so a
-- failure here can NEVER break broadcast_game_state or the judge's save
-- (the live_game_state_archive pattern).

-- ---------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------
create table if not exists public.live_activity_tokens (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,   -- null = signed-out viewer
  device_id    text not null check (length(device_id) between 8 and 128),
  platform     text not null default 'ios' check (platform in ('ios', 'android')),
  token        text not null check (length(token) between 16 and 4096),
  environment  text not null default 'production' check (environment in ('sandbox', 'production')),
  app_version  integer,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (platform, device_id, game_id)
);
create index if not exists live_activity_tokens_game_idx on public.live_activity_tokens (game_id);
create index if not exists live_activity_tokens_user_idx on public.live_activity_tokens (user_id);

create table if not exists public.live_activity_start_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,
  device_id    text not null check (length(device_id) between 8 and 128),
  platform     text not null default 'ios' check (platform in ('ios', 'android')),
  token        text not null check (length(token) between 16 and 4096),
  environment  text not null default 'production' check (environment in ('sandbox', 'production')),
  app_version  integer,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (platform, device_id)
);
create index if not exists live_activity_start_tokens_user_idx on public.live_activity_start_tokens (user_id);

create table if not exists public.live_activity_games (
  game_id          uuid primary key references public.games(id) on delete cascade,
  last_sig         text,          -- visible-state signature of the last update pushed
  last_state       jsonb,         -- that ContentState
  last_event_id    text,          -- newest play-by-play event id it reflected
  last_sent_at     timestamptz,
  last_p5_at       timestamptz,   -- last low-priority (clock) push: ~1 per 10 s
  p5_pending_until timestamptz,   -- a deferred low-priority push is waiting until then
  start_sent_at    timestamptz,   -- push-to-start went out (once per game)
  ended_at         timestamptz,
  last_payload     jsonb,         -- debugging: the last APNs body sent
  last_result      jsonb,         -- debugging: per-token APNs statuses of the last send
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------
-- RLS: users see / manage only their own token rows. Writes go through the RPCs below
-- (they also accept signed-out viewers, keyed by the device id). live_activity_games is
-- service-role only.
-- ---------------------------------------------------------------------------------------
alter table public.live_activity_tokens enable row level security;
alter table public.live_activity_start_tokens enable row level security;
alter table public.live_activity_games enable row level security;

revoke all on public.live_activity_tokens, public.live_activity_start_tokens,
              public.live_activity_games from anon, authenticated;
grant select, insert, update, delete on public.live_activity_tokens, public.live_activity_start_tokens
  to authenticated;

drop policy if exists la_tokens_own on public.live_activity_tokens;
create policy la_tokens_own on public.live_activity_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists la_start_tokens_own on public.live_activity_start_tokens;
create policy la_start_tokens_own on public.live_activity_start_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------
-- The kick: one async POST to the edge function. Never raises.
-- ---------------------------------------------------------------------------------------
create or replace function public._live_activity_kick(p_game uuid, p_op text, p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_webhook_secret' limit 1;
  perform net.http_post(
    url     := 'https://slpwwoupbbxcgjivcspv.supabase.co/functions/v1/live-activity-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', coalesce(v_secret, '')),
    body    := jsonb_build_object('game_id', p_game, 'op', p_op) || coalesce(p_extra, '{}'::jsonb)
  );
exception when others then
  null;   -- best-effort, never abort the caller
end $$;
revoke all on function public._live_activity_kick(uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- RPCs (app)
-- ---------------------------------------------------------------------------------------
create or replace function public.register_live_activity_token(
  p_game_id uuid, p_device_id text, p_token text,
  p_platform text default 'ios', p_environment text default 'production', p_app_version integer default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.games where id = p_game_id and status <> 'completed') then
    return;   -- unknown or finished game: nothing to follow
  end if;
  insert into public.live_activity_tokens (game_id, user_id, device_id, platform, token, environment, app_version)
  values (p_game_id, auth.uid(), p_device_id, coalesce(p_platform, 'ios'), p_token,
          coalesce(p_environment, 'production'), p_app_version)
  on conflict (platform, device_id, game_id) do update
    set token = excluded.token, user_id = excluded.user_id, environment = excluded.environment,
        app_version = excluded.app_version, updated_at = now()
  returning id into v_id;
  -- Bring the new activity up to date right away (current score / clock), to this token only.
  perform public._live_activity_kick(p_game_id, 'register', jsonb_build_object('token_id', v_id));
end $$;

create or replace function public.unregister_live_activity_token(
  p_game_id uuid, p_device_id text, p_platform text default 'ios')
returns void language sql security definer set search_path = public as $$
  delete from public.live_activity_tokens
   where game_id = p_game_id and device_id = p_device_id and platform = coalesce(p_platform, 'ios');
$$;

create or replace function public.register_live_activity_start_token(
  p_device_id text, p_token text,
  p_platform text default 'ios', p_environment text default 'production', p_app_version integer default null)
returns void language sql security definer set search_path = public as $$
  insert into public.live_activity_start_tokens (user_id, device_id, platform, token, environment, app_version)
  values (auth.uid(), p_device_id, coalesce(p_platform, 'ios'), p_token,
          coalesce(p_environment, 'production'), p_app_version)
  on conflict (platform, device_id) do update
    set token = excluded.token, user_id = excluded.user_id, environment = excluded.environment,
        app_version = excluded.app_version, updated_at = now();
$$;

create or replace function public.unregister_live_activity_start_token(p_device_id text, p_platform text default 'ios')
returns void language sql security definer set search_path = public as $$
  delete from public.live_activity_start_tokens
   where device_id = p_device_id and platform = coalesce(p_platform, 'ios');
$$;

revoke all on function public.register_live_activity_token(uuid, text, text, text, text, integer) from public;
revoke all on function public.unregister_live_activity_token(uuid, text, text) from public;
revoke all on function public.register_live_activity_start_token(text, text, text, text, integer) from public;
revoke all on function public.unregister_live_activity_start_token(text, text) from public;
grant execute on function public.register_live_activity_token(uuid, text, text, text, text, integer) to anon, authenticated;
grant execute on function public.unregister_live_activity_token(uuid, text, text) to anon, authenticated;
grant execute on function public.register_live_activity_start_token(text, text, text, text, integer) to anon, authenticated;
grant execute on function public.unregister_live_activity_start_token(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- Triggers. Post only when someone can receive something:
--   • a device follows this game (has an activity token), or
--   • the clock is running, push-to-start has not gone out for this game yet and a
--     follower of either team has a start token.
-- ---------------------------------------------------------------------------------------
create or replace function public._live_activity_on_state()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g uuid := coalesce(new.game_id, old.game_id);
begin
  if exists (select 1 from public.live_activity_tokens where game_id = g) then
    perform public._live_activity_kick(g, case tg_op when 'DELETE' then 'deleted' else 'state' end);
  elsif tg_op <> 'DELETE' and coalesce(new.is_running, false)
        and not exists (select 1 from public.live_activity_games where game_id = g and start_sent_at is not null)
        and exists (
          select 1 from public.live_activity_start_tokens st
            join public.follows f on f.user_id = st.user_id and f.target_type = 'team' and f.notify
            join public.games gm on gm.id = g and f.target_id in (gm.home_team_id, gm.away_team_id)) then
    perform public._live_activity_kick(g, 'state');
  end if;
  return null;
exception when others then
  return null;   -- never break the judge's broadcast
end $$;

drop trigger if exists live_game_state_live_activity on public.live_game_state;
create trigger live_game_state_live_activity
  after insert or update or delete on public.live_game_state
  for each row execute function public._live_activity_on_state();

create or replace function public._live_activity_on_game_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed'
     and exists (select 1 from public.live_activity_tokens where game_id = new.id) then
    perform public._live_activity_kick(new.id, 'completed');
  end if;
  return null;
exception when others then
  return null;   -- never break the save
end $$;

drop trigger if exists games_live_activity_final on public.games;
create trigger games_live_activity_final
  after update of status on public.games
  for each row execute function public._live_activity_on_game_status();

revoke all on function public._live_activity_on_state() from public, anon, authenticated;
revoke all on function public._live_activity_on_game_status() from public, anon, authenticated;
