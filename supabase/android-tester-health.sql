-- Android tester tracking (2026-10-19)
--
-- Google Play's closed test needs 12+ testers opted in for 14 days in a row, and Play
-- Console only ever shows a COUNT of opted-in testers — never who. This adds the two
-- things the /admin "בודקי אפליקציה" tab needs to run the test:
--
-- 1. android_tester_status — what only the admin knows, ticked by hand per Google
--    address: on the Play tester list, in the WhatsApp group, opted in, a note.
--    Keyed by email (the Play list is a list of emails, and some entries — e.g. an admin
--    testing with a second Google account — match no app user at all).
--
-- 2. admin_android_tester_health() — what the app's own telemetry says per Android
--    user (supabase/telemetry.sql, app_events):
--      * last Android activity, version, active days in the last 14 (Play's window)
--      * device / OS / installer from the latest app_open (installer arrives with
--        Android ≥ 1.5.2 (62); "com.android.vending" = installed from Play)
--      * startup crashes on that device MODEL: app_crash events carry no user (the app
--        dies before it can attach one), so they are matched by detail.device, either
--        directly or through a telemetry session that also carries the user. A crash
--        newer than the user's last successful event = "crashing now".
--      * a phone number to reach them (user_contact, else Podium) — admin-only.
--
-- Admin-only. SECURITY DEFINER because auth.* and other users' events are not
-- readable from the client.

create table if not exists public.android_tester_status (
  email         text primary key check (email = lower(email)),
  on_play_list  boolean not null default false,
  in_group      boolean not null default false,
  opted_in      boolean not null default false,
  note          text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid default auth.uid()
);

alter table public.android_tester_status enable row level security;

drop policy if exists android_tester_status_admin on public.android_tester_status;
create policy android_tester_status_admin on public.android_tester_status
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Upsert one row (only the fields passed as non-null change).
create or replace function public.admin_set_android_tester_status(
  p_email text,
  p_on_play_list boolean default null,
  p_in_group boolean default null,
  p_opted_in boolean default null,
  p_note text default null
)
returns public.android_tester_status
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.android_tester_status;
  v_email text := lower(trim(p_email));
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if v_email is null or v_email = '' or position('@' in v_email) = 0 then
    raise exception 'bad email';
  end if;

  insert into public.android_tester_status as s (email, on_play_list, in_group, opted_in, note, updated_at, updated_by)
  values (v_email, coalesce(p_on_play_list, false), coalesce(p_in_group, false), coalesce(p_opted_in, false),
          nullif(trim(p_note), ''), now(), auth.uid())
  on conflict (email) do update set
    on_play_list = coalesce(p_on_play_list, s.on_play_list),
    in_group     = coalesce(p_in_group, s.in_group),
    opted_in     = coalesce(p_opted_in, s.opted_in),
    note         = case when p_note is null then s.note else nullif(trim(p_note), '') end,
    updated_at   = now(),
    updated_by   = auth.uid()
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.admin_android_tester_health()
returns table (
  user_id          uuid,
  last_android_at  timestamptz,
  active_days_14   integer,
  events_7d        integer,
  app_version      text,
  device           text,
  os               text,
  installer        text,
  errors_7d        integer,
  crashes_7d       integer,
  last_crash_at    timestamptz,
  last_crash       text,
  phone            text
)
language plpgsql
stable
security definer
set search_path to 'public', 'auth'
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  return query
  with ev as (
    select e.* from public.app_events e
     where e.platform = 'android' and e.created_at > now() - interval '30 days'
  ),
  -- a telemetry session belongs to whoever is signed in on any of its events
  sess as (
    select session_id, (array_agg(ev.user_id order by ev.created_at desc) filter (where ev.user_id is not null))[1] as uid
      from ev where session_id is not null group by session_id
  ),
  owned as (   -- every Android event we can attribute to a user
    select ev.*, coalesce(ev.user_id, s.uid) as owner
      from ev left join sess s on s.session_id = ev.session_id
  ),
  users as (
    select o.owner,
           max(o.created_at) filter (where o.name not in ('app_crash', 'app_exit'))             as last_ok,
           count(distinct (o.created_at at time zone 'Asia/Jerusalem')::date)
             filter (where o.created_at > now() - interval '14 days')                            as days14,
           count(*) filter (where o.created_at > now() - interval '7 days')                      as n7,
           (array_agg(o.app_version order by o.created_at desc))[1]                              as ver,
           count(*) filter (where o.kind = 'error' and o.name not in ('app_crash', 'app_exit')
                              and o.created_at > now() - interval '7 days')                      as err7
      from owned o where o.owner is not null group by o.owner
  ),
  last_open as (   -- device facts from the newest event that carries them
    select distinct on (o.owner) o.owner, o.detail->>'device' as device, o.detail->>'os' as os,
           o.detail->>'installer' as installer
      from owned o
     where o.owner is not null and o.detail ? 'device'
     order by o.owner, (o.name = 'app_open') desc, o.created_at desc
  ),
  crashes as (
    select lo.owner,
           count(*) filter (where c.created_at > now() - interval '7 days') as n7,
           max(c.created_at) as last_at,
           (array_agg(left(coalesce(c.detail->>'message', c.detail->>'reason', ''), 160) order by c.created_at desc))[1] as last_msg
      from last_open lo
      join ev c on c.name = 'app_crash' and c.detail->>'device' = lo.device
     group by lo.owner
  )
  select u.owner,
         u.last_ok,
         u.days14::int,
         u.n7::int,
         u.ver,
         lo.device,
         lo.os,
         lo.installer,
         u.err7::int,
         coalesce(c.n7, 0)::int,
         c.last_at,
         c.last_msg,
         coalesce(
           nullif(trim(uc.phone), ''),
           (select nullif(trim(pa.phone), '') from public.podium_athletes pa
             where pa.player_id = pr.player_id and coalesce(pa.phone, '') <> ''
             order by pa.synced_at desc nulls last limit 1)
         )
    from users u
    left join last_open lo on lo.owner = u.owner
    left join crashes c on c.owner = u.owner
    left join public.profiles pr on pr.id = u.owner
    left join public.user_contact uc on uc.user_id = u.owner;
end;
$$;

revoke all on function public.admin_android_tester_health() from public, anon;
revoke all on function public.admin_set_android_tester_status(text, boolean, boolean, boolean, text) from public, anon;
grant execute on function public.admin_android_tester_health() to authenticated;
grant execute on function public.admin_set_android_tester_status(text, boolean, boolean, boolean, text) to authenticated;
