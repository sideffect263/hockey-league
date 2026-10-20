-- Tester activity over Play's 14-day window (2026-10-20)
--
-- admin_android_tester_health() only knows people who have used the Android APP. The
-- Play tester list also holds people who so far use the WEBSITE on an Android phone
-- (they were added to recruit testers), and they showed up in /admin "בודקי אפליקציה"
-- as bare emails. This returns one row per ACCOUNT that is either on that list (matched
-- by login email or any Google identity email) or has used the Android app, with how
-- much they used the app and the site in the last 14 days:
--   * android_opens_14 / android_days_14 — app_open events and distinct days (app)
--   * web_visits_14 / web_days_14        — distinct telemetry sessions and days (site)
--   * active_days_14                     — days with any of the two
--   * last_seen_at                       — newest event on any platform
-- Days are Israel-time calendar days. Admin-only, SECURITY DEFINER (auth.*, other
-- users' events).

create or replace function public.admin_android_tester_activity()
returns table (
  user_id           uuid,
  auth_email        text,
  google_email      text,
  display_name      text,
  player_id         uuid,
  player_name       text,
  team_name         text,
  android_opens_14  integer,
  android_days_14   integer,
  web_visits_14     integer,
  web_days_14       integer,
  active_days_14    integer,
  last_seen_at      timestamptz,
  phone             text
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
  with google as (
    select distinct on (i.user_id) i.user_id, lower(i.identity_data ->> 'email') as email
      from auth.identities i
     where i.provider = 'google' and coalesce(i.identity_data ->> 'email', '') <> ''
     order by i.user_id, i.last_sign_in_at desc nulls last
  ),
  listed as (   -- accounts behind an address on the hand-kept tester list
    select u.id from auth.users u
      join public.android_tester_status s on s.email = lower(u.email::text)
    union
    select g.user_id from google g
      join public.android_tester_status s on s.email = g.email
  ),
  android_users as (
    select e.user_id from public.app_events e where e.platform = 'android' and e.user_id is not null
    union select p.user_id from public.push_subscriptions p where p.platform = 'android'
    union select s.user_id from auth.sessions s where s.user_agent ilike 'okhttp/%'
  ),
  who as (select id as uid from listed union select user_id from android_users),
  ev as (
    select e.user_id, e.platform, e.name, e.session_id, e.created_at,
           (e.created_at at time zone 'Asia/Jerusalem')::date as day
      from public.app_events e
     where e.user_id in (select uid from who)
       -- today + the 13 days before it, as Israel calendar days (a plain 14×24h window
       -- touches 15 dates)
       and e.created_at >= ((now() at time zone 'Asia/Jerusalem')::date - 13)::timestamp at time zone 'Asia/Jerusalem'
  ),
  agg as (
    select ev.user_id,
           count(*) filter (where ev.platform = 'android' and ev.name = 'app_open')  as a_opens,
           count(distinct ev.day) filter (where ev.platform = 'android')            as a_days,
           count(distinct ev.session_id) filter (where ev.platform = 'web')         as w_visits,
           count(distinct ev.day) filter (where ev.platform = 'web')                as w_days,
           count(distinct ev.day)                                                   as any_days
      from ev group by ev.user_id
  ),
  seen as (
    select e.user_id, max(e.created_at) as last_at
      from public.app_events e where e.user_id in (select uid from who) group by e.user_id
  )
  select u.id,
         lower(u.email::text),
         g.email,
         pr.display_name,
         pr.player_id,
         nullif(trim(coalesce(pl.first_name, '') || ' ' || coalesce(pl.last_name, '')), ''),
         t.name,
         coalesce(a.a_opens, 0)::int,
         coalesce(a.a_days, 0)::int,
         coalesce(a.w_visits, 0)::int,
         coalesce(a.w_days, 0)::int,
         coalesce(a.any_days, 0)::int,
         sn.last_at,
         coalesce(
           nullif(trim(uc.phone), ''),
           (select nullif(trim(pa.phone), '') from public.podium_athletes pa
             where pa.player_id = pr.player_id and coalesce(pa.phone, '') <> ''
             order by pa.synced_at desc nulls last limit 1)
         )
    from who w
    join auth.users u            on u.id = w.uid
    left join google g           on g.user_id = u.id
    left join public.profiles pr on pr.id = u.id
    left join public.players pl  on pl.id = pr.player_id
    left join public.teams t     on t.id = pl.team_id
    left join agg a              on a.user_id = u.id
    left join seen sn            on sn.user_id = u.id
    left join public.user_contact uc on uc.user_id = u.id
   where coalesce(pr.is_bot, false) = false;
end;
$$;

revoke all on function public.admin_android_tester_activity() from public, anon;
grant execute on function public.admin_android_tester_activity() to authenticated;
