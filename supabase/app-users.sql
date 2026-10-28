-- App users (2026-09-26)
--
-- Nothing records an app INSTALL. What we do have is every trace a signed-in app
-- leaves behind, and together they are a reliable "this account uses the app":
--   * auth.sessions.user_agent — the iOS app sends `RinkHockeyIL/<build> CFNetwork…`,
--     the Android app `okhttp/<ver>`. Browsers never do. Sessions are deleted on
--     sign-out/expiry, so this alone under-counts old users…
--   * public.push_subscriptions (platform ios|android) — survives longer, carries
--     the Android version name;
--   * public.app_events (platform ios|android) — native telemetry.
--
-- Two readers:
--   admin_app_users()  — the /admin "משתמשי אפליקציה" tab. One row per account.
--   my_app_platforms() — the web asks "does THIS user already have the app?" so it
--                        stops showing them "download the app".
--
-- Both are SECURITY DEFINER because auth.sessions / auth.identities are not
-- readable from the client at all.

-- 2026-10-28: both apps now report versions the same way. Per platform the row
-- carries a label like "1.5.5 (69)" or "1.5.5" (newest day's trace wins; a full
-- "x (n)" from telemetry beats a bare push version name; an old iOS session with
-- only a build number reads "build 39"),
-- the numeric build for "is this the latest?", and that platform's last-seen.
-- The return type changed, hence the drop.
drop function if exists public.admin_app_users();
create function public.admin_app_users()
returns table (
  user_id           uuid,
  display_name      text,
  email             text,
  providers         text[],
  created_at        timestamptz,
  last_sign_in_at   timestamptz,
  player_id         uuid,
  player_name       text,
  has_ios           boolean,
  has_android       boolean,
  ios_version       text,
  android_version   text,
  ios_build         int,
  android_build     int,
  ios_last_seen     timestamptz,
  android_last_seen timestamptz,
  app_first_seen    timestamptz,
  app_last_seen     timestamptz,
  web_last_seen     timestamptz,
  push_devices      int,
  duplicate_of      uuid[]
)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  return query
  with raw as (
    select s.user_id,
           case when s.user_agent ilike 'RinkHockeyIL/%' then 'ios' else 'android' end as platform,
           s.created_at as first_at,
           coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) as last_at,
           null::text as ver,
           case when s.user_agent ilike 'RinkHockeyIL/%'
                then substring(s.user_agent from 'RinkHockeyIL/([0-9]+)')::int end as build
      from auth.sessions s
     where s.user_agent ilike 'RinkHockeyIL/%' or s.user_agent ilike 'okhttp/%'
    union all
    select p.user_id, p.platform, p.created_at, coalesce(p.last_seen_at, p.created_at),
           p.app_version_name, null::int
      from public.push_subscriptions p
     where p.platform in ('ios', 'android')
    union all
    select e.user_id, e.platform, e.created_at, e.created_at,
           e.app_version, substring(e.app_version from '\(([0-9]+)\)')::int
      from public.app_events e
     where e.platform in ('ios', 'android') and e.user_id is not null
  ),
  app as (
    select r.*,
           -- newest day first; within a day a full "x (n)" beats a bare name or build
           (r.last_at::date)::text || case when r.ver like '%(%' then '2' when r.ver is not null then '1' else '0' end as pick
      from raw r
  ),
  app_per_user as (
    select a.user_id,
           bool_or(a.platform = 'ios')     as has_ios,
           bool_or(a.platform = 'android') as has_android,
           (array_agg(a.ver order by a.pick desc, a.last_at desc) filter (where a.platform = 'ios' and a.ver is not null))[1]       as ios_ver,
           (array_agg(a.ver order by a.pick desc, a.last_at desc) filter (where a.platform = 'android' and a.ver is not null))[1]   as android_ver,
           (array_agg(a.build order by a.pick desc, a.last_at desc) filter (where a.platform = 'ios' and a.build is not null))[1]     as ios_build,
           (array_agg(a.build order by a.pick desc, a.last_at desc) filter (where a.platform = 'android' and a.build is not null))[1] as android_build,
           max(a.last_at) filter (where a.platform = 'ios')     as ios_last,
           max(a.last_at) filter (where a.platform = 'android') as android_last,
           min(a.first_at) as first_seen,
           max(a.last_at)  as last_seen
      from app a
     group by a.user_id
  ),
  web as (
    select w.user_id, max(w.at) as last_seen from (
      select s.user_id, coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) as at
        from auth.sessions s
       where coalesce(s.user_agent, '') not ilike 'RinkHockeyIL/%'
         and coalesce(s.user_agent, '') not ilike 'okhttp/%'
      union all
      select e.user_id, e.created_at from public.app_events e
       where e.platform = 'web' and e.user_id is not null
    ) w group by w.user_id
  ),
  -- A "name key" for spotting one person with two accounts: letters only, lower
  -- case. `oriraizler9372` (Apple relay username) and `Ori Raizler` (Google) both
  -- become `oriraizler`. Keys shorter than 4 letters are too generic to compare.
  keys as (
    select u.id, k.key
      from auth.users u
      left join public.profiles pr on pr.id = u.id
      cross join lateral (values
        (regexp_replace(lower(coalesce(pr.display_name, '')), '[^a-zא-ת]', '', 'g')),
        (regexp_replace(lower(split_part(coalesce(u.email, ''), '@', 1)), '[^a-zא-ת]', '', 'g'))
      ) as k(key)
     where length(k.key) >= 4
       and coalesce(pr.is_bot, false) = false
  ),
  dups as (
    select a.id, array_agg(distinct b.id) as others
      from keys a join keys b on a.key = b.key and a.id <> b.id
     group by a.id
  )
  select u.id,
         pr.display_name,
         u.email::text,
         coalesce(array(select jsonb_array_elements_text(u.raw_app_meta_data -> 'providers')),
                  array[u.raw_app_meta_data ->> 'provider']),
         u.created_at,
         u.last_sign_in_at,
         pr.player_id,
         nullif(trim(coalesce(pl.first_name, '') || ' ' || coalesce(pl.last_name, '')), ''),
         coalesce(ap.has_ios, false),
         coalesce(ap.has_android, false),
         coalesce(ap.ios_ver, 'build ' || ap.ios_build),
         coalesce(ap.android_ver, 'build ' || ap.android_build),
         ap.ios_build,
         ap.android_build,
         ap.ios_last,
         ap.android_last,
         ap.first_seen,
         ap.last_seen,
         wb.last_seen,
         (select count(*)::int from public.push_subscriptions ps where ps.user_id = u.id),
         d.others
    from auth.users u
    left join public.profiles pr on pr.id = u.id
    left join public.players pl  on pl.id = pr.player_id
    left join app_per_user ap    on ap.user_id = u.id
    left join web wb             on wb.user_id = u.id
    left join dups d             on d.id = u.id
   where coalesce(pr.is_bot, false) = false
   order by coalesce(ap.last_seen, wb.last_seen, u.last_sign_in_at) desc nulls last;
end;
$$;

revoke all on function public.admin_app_users() from public, anon;
grant execute on function public.admin_app_users() to authenticated;

-- The signed-in caller's own app platforms, e.g. {ios} / {android} / {} — nothing
-- about anyone else. Same three sources as above.
create or replace function public.my_app_platforms()
returns text[]
language sql stable security definer
set search_path = public, auth
as $$
  select coalesce(array_agg(distinct p order by p), '{}')
    from (
      select case when s.user_agent ilike 'RinkHockeyIL/%' then 'ios' else 'android' end as p
        from auth.sessions s
       where s.user_id = auth.uid()
         and (s.user_agent ilike 'RinkHockeyIL/%' or s.user_agent ilike 'okhttp/%')
      union all
      select ps.platform from public.push_subscriptions ps
       where ps.user_id = auth.uid() and ps.platform in ('ios', 'android')
      union all
      select e.platform from public.app_events e
       where e.user_id = auth.uid() and e.platform in ('ios', 'android')
    ) x
   where auth.uid() is not null;
$$;

revoke all on function public.my_app_platforms() from public, anon;
grant execute on function public.my_app_platforms() to authenticated;
