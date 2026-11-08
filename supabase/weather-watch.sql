-- ============================================================================
-- weather-watch — rain decision engine for upcoming games.
--
-- Hourly cron → edge fn `weather-watch` reads the Open-Meteo forecast at each
-- upcoming game's venue (next 72 h), decides ok / watch / move, stores the
-- verdict here, and pushes admins + league managers when a game should move
-- (with dry, free alternative venues) or when a move alert is called off.
-- Down: weather-watch-down.sql
-- ============================================================================

create table if not exists public.game_weather_checks (
  game_id        uuid primary key references public.games(id) on delete cascade,
  level          text not null check (level in ('ok', 'watch', 'move')),
  reasons        text[] not null default '{}',
  details        jsonb  not null default '{}'::jsonb,   -- metrics + alternatives
  kickoff        timestamptz,
  venue          text,
  notified_level text,                                   -- last level we pushed about
  notified_at    timestamptz,
  checked_at     timestamptz not null default now()
);

alter table public.game_weather_checks enable row level security;

-- Read: admins + league managers (a future /admin view). Writes: service role only.
drop policy if exists game_weather_checks_staff_read on public.game_weather_checks;
create policy game_weather_checks_staff_read on public.game_weather_checks
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.user_roles r
               where r.user_id = (select auth.uid()) and r.role = 'league_manager')
  );

-- Who gets a weather alert: every admin (admin_users by email) + every league manager.
create or replace function public.weather_alert_recipients()
returns table (user_id uuid)
language sql stable security definer set search_path = public
as $$
  select u.id from auth.users u
   where lower(u.email) in (select lower(email) from public.admin_users)
  union
  select r.user_id from public.user_roles r where r.role = 'league_manager'
$$;
revoke all on function public.weather_alert_recipients() from public, anon, authenticated;

-- Cron entry point (same pattern as run_stream_sweep).
create or replace function public.run_weather_watch()
returns void
language plpgsql security definer set search_path = public
as $$
declare v_key text;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'ingest_service_key' limit 1;
  if v_key is null then
    raise warning 'ingest_service_key missing from vault — skipping weather watch';
    return;
  end if;
  perform net.http_post(
    url     := 'https://slpwwoupbbxcgjivcspv.supabase.co/functions/v1/weather-watch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;
revoke all on function public.run_weather_watch() from public, anon, authenticated;

select cron.unschedule('weather-watch') where exists (select 1 from cron.job where jobname = 'weather-watch');
select cron.schedule('weather-watch', '35 * * * *', 'select public.run_weather_watch();');
