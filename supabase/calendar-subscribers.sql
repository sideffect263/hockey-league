-- Calendar-feed subscribers (2026-10-08) — the /admin "מנויי יומן" tab.
--
-- /api/calendar is fetched anonymously by calendar apps (Apple dataaccessd/CalendarAgent,
-- Google-Calendar-Importer, Outlook…), which re-poll every few hours. Nothing recorded
-- those fetches, so "how many people subscribed?" had no answer. Now the feed calls
-- log_calendar_fetch() on every request it serves.
--
-- One row per (day, who, team): `who` is sha256(salt || ip || user-agent) truncated —
-- the raw IP is never stored, and the salt lives in a table nobody can read. A row only
-- bumps `hits`, so storage is bounded by distinct subscribers per day, not by polls.
--
-- "Subscriber" = a distinct `who` that fetched from a CALENDAR APP in the window. Browser
-- fetches (someone opening the link) are counted separately and not as subscribers;
-- crawlers/scripts ('bot') are ignored.
-- CAVEAT shown on screen: Google fetches from its own servers, so many Google users can
-- collapse into a few `who`s — Google's number is a floor.
--
-- The logger is anon-callable (the Vercel function uses the anon key), so it caps itself:
-- inputs are length-limited and it stops writing after 5000 rows in a day.
--
-- Rollback: drop function public.log_calendar_fetch(text,text,text);
--           drop function public.analytics_calendar(int);
--           drop table public.calendar_fetches; drop table public.calendar_fetch_salt;

create table if not exists public.calendar_fetch_salt (
  id boolean primary key default true check (id),
  salt text not null default encode(extensions.gen_random_bytes(32), 'hex')
);
insert into public.calendar_fetch_salt default values on conflict do nothing;
alter table public.calendar_fetch_salt enable row level security;
revoke all on public.calendar_fetch_salt from anon, authenticated;

create table if not exists public.calendar_fetches (
  day date not null,
  who text not null,
  team text not null default '',   -- '' = the whole-league feed, else the ?team= value
  client text not null,            -- apple | google | outlook | other_app | browser | bot
  ua text,
  hits int not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (day, who, team)
);
alter table public.calendar_fetches enable row level security;
revoke all on public.calendar_fetches from anon, authenticated;

create or replace function public.calendar_client(p_ua text)
returns text language sql immutable as $$
  select case
    when p_ua is null or p_ua = '' then 'other_app'
    when p_ua ~* 'google-calendar|googlecalendar|calendar\.google' then 'google'
    when p_ua ~* 'bot|crawl|spider|slurp|preview|curl|wget|python|node-fetch|axios|go-http' then 'bot'
    when p_ua ~* 'dataaccessd|calendaragent|ical/|^iOS/|^macOS/' then 'apple'
    when p_ua ~* 'outlook|microsoft|exchange|office' then 'outlook'
    when p_ua ~* 'thunderbird|lightning' then 'other_app'
    when p_ua ~* 'mozilla|chrome|safari|firefox|edg/' then 'browser'
    else 'other_app'
  end
$$;

create or replace function public.log_calendar_fetch(p_ip text, p_ua text, p_team text default '')
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Jerusalem')::date;
  ua text := left(coalesce(p_ua, ''), 300);
  tm text := left(coalesce(p_team, ''), 120);
  h text;
begin
  if (select count(*) from public.calendar_fetches where day = today) >= 5000 then return; end if;
  select left(encode(extensions.digest(s.salt || '|' || left(coalesce(p_ip, ''), 64) || '|' || ua, 'sha256'), 'hex'), 32)
    into h from public.calendar_fetch_salt s;
  insert into public.calendar_fetches (day, who, team, client, ua)
  values (today, h, tm, public.calendar_client(ua), nullif(ua, ''))
  on conflict (day, who, team) do update
    set hits = calendar_fetches.hits + 1, last_at = now();
end $$;

revoke all on function public.log_calendar_fetch(text, text, text) from public;
grant execute on function public.log_calendar_fetch(text, text, text) to anon, authenticated;

-- Admin-only aggregates. Never returns a `who`.
create or replace function public.analytics_calendar(p_days int default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d int := greatest(1, least(coalesce(p_days, 7), 90));
  since date := (now() at time zone 'Asia/Jerusalem')::date - (d - 1);
  result jsonb;
begin
  if not public.is_admin() then raise exception 'not_authorized'; end if;

  with w as (select * from public.calendar_fetches where day >= since),
  apps as (select * from w where client not in ('browser', 'bot'))
  select jsonb_build_object(
    'days', d,
    'tracking_since', (select min(day) from public.calendar_fetches),
    'subscribers', (select count(distinct who) from apps),
    'active_today', (select count(distinct who) from apps where day = (now() at time zone 'Asia/Jerusalem')::date),
    'browser_opens', (select count(distinct who) from w where client = 'browser'),
    'fetches', (select coalesce(sum(hits), 0) from w),
    'by_client', coalesce((select jsonb_agg(jsonb_build_object('client', client, 'subscribers', n) order by n desc)
        from (select client, count(distinct who) n from w where client <> 'bot' group by client) x), '[]'::jsonb),
    'by_team', coalesce((select jsonb_agg(jsonb_build_object('team', team, 'subscribers', n) order by n desc)
        from (select team, count(distinct who) n from apps group by team) x), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', g::date, 'subscribers',
          (select count(distinct who) from apps a where a.day = g::date)) order by g)
        from generate_series(since, (now() at time zone 'Asia/Jerusalem')::date, interval '1 day') g), '[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke all on function public.analytics_calendar(int) from public;
grant execute on function public.analytics_calendar(int) to authenticated;
