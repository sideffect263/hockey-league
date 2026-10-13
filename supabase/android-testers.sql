-- Android testers (2026-10-13)
--
-- Google Play's closed test needs 12+ testers who opt in with a GOOGLE account on an
-- ANDROID device, and keep it installed for 14 days. This lists every account that
-- could be one: it has used the Android app AND it has a Google address.
--
-- Android usage — same traces as admin_app_users() (supabase/app-users.sql):
--   * auth.sessions.user_agent 'okhttp/%'       (the Android app's HTTP client)
--   * public.push_subscriptions platform android (carries app_version_name)
--   * public.app_events platform android         (native telemetry)
--
-- Google address — the one to paste into Play Console:
--   * the email on a `google` row in auth.identities (preferred: that IS the Google
--     account; it can differ from auth.users.email after an account merge), else
--   * auth.users.email when it ends in @gmail.com / @googlemail.com.
--
-- Admin-only, SECURITY DEFINER because auth.* is not readable from the client.

create or replace function public.admin_android_testers()
returns table (
  user_id          uuid,
  display_name     text,
  auth_email       text,
  google_email     text,
  play_email       text,
  player_id        uuid,
  player_name      text,
  team_name        text,
  android_version  text,
  android_last_seen timestamptz
)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  return query
  with android as (
    select s.user_id,
           coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) as last_at,
           null::text as ver
      from auth.sessions s
     where s.user_agent ilike 'okhttp/%'
    union all
    select p.user_id, coalesce(p.last_seen_at, p.created_at), p.app_version_name
      from public.push_subscriptions p
     where p.platform = 'android'
    union all
    select e.user_id, e.created_at, e.app_version
      from public.app_events e
     where e.platform = 'android' and e.user_id is not null
  ),
  per_user as (
    select a.user_id,
           max(a.last_at) as last_seen,
           (array_agg(a.ver order by a.last_at desc) filter (where a.ver is not null))[1] as ver
      from android a
     group by a.user_id
  ),
  google as (
    select distinct on (i.user_id) i.user_id, lower(i.identity_data ->> 'email') as email
      from auth.identities i
     where i.provider = 'google' and coalesce(i.identity_data ->> 'email', '') <> ''
     order by i.user_id, i.last_sign_in_at desc nulls last
  )
  select u.id,
         pr.display_name,
         u.email::text,
         g.email,
         coalesce(g.email, lower(u.email::text)),
         pr.player_id,
         nullif(trim(coalesce(pl.first_name, '') || ' ' || coalesce(pl.last_name, '')), ''),
         t.name,
         pu.ver,
         pu.last_seen
    from per_user pu
    join auth.users u            on u.id = pu.user_id
    left join public.profiles pr on pr.id = u.id
    left join public.players pl  on pl.id = pr.player_id
    left join public.teams t     on t.id = pl.team_id
    left join google g           on g.user_id = u.id
   where coalesce(pr.is_bot, false) = false
     and (g.email is not null
          or lower(u.email::text) like '%@gmail.com'
          or lower(u.email::text) like '%@googlemail.com')
   order by pu.last_seen desc nulls last;
end;
$$;

revoke all on function public.admin_android_testers() from public, anon;
grant execute on function public.admin_android_testers() to authenticated;
