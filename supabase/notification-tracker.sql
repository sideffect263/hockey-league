-- notification-tracker.sql (2026-10-14)
-- Applied to production via MCP as migration `notification_tracker`.
--
-- The /admin "התראות" tab: who got which notification, when, and on which device.
--
-- `notifications` already says WHO and WHEN (one bell row per recipient), but nothing
-- recorded what send-push did with it — the fan-out to devices left no trace beyond a
-- pg_net response that expires in hours. `push_deliveries` is that trace: send-push
-- writes one row per device it tried, plus one row when there was nothing to try
-- (no device, market type, email fallback). Rows only exist from this migration on;
-- older notifications show as "לפני המעקב" in the tab, not as failures.
--
-- Written by the edge function with the service role only. RLS on, no policies: the
-- only reader is the admin RPC below.

create table if not exists public.push_deliveries (
  id               bigint generated always as identity primary key,
  notification_id  uuid references public.notifications(id) on delete cascade,
  user_id          uuid not null,
  -- NOT a foreign key: a dead device is pruned in the same call that logs it, and
  -- the log must outlive the subscription it is about.
  subscription_id  uuid,
  platform         text not null,   -- web | ios | android | email | none
  status           text not null,   -- sent | failed | pruned | skipped | no_device | emailed
  detail           text,            -- provider status / reason, short
  app_version_name text,            -- snapshot at send time (iOS / Android)
  user_agent       text,            -- snapshot at send time (web)
  created_at       timestamptz not null default now()
);
create index if not exists push_deliveries_notification_idx on public.push_deliveries (notification_id);
create index if not exists push_deliveries_created_idx      on public.push_deliveries (created_at desc);
create index if not exists push_deliveries_user_idx         on public.push_deliveries (user_id, created_at desc);
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from anon, authenticated;

-- One row per notification in the window, newest first, with its recipient and the
-- per-device outcome. Admin only: it exposes every account's notifications.
create or replace function public.admin_notification_log(
  p_since timestamptz default now() - interval '7 days',
  p_limit int default 1000
)
returns table (
  id              uuid,
  created_at      timestamptz,
  type            text,
  user_id         uuid,
  recipient_name  text,
  recipient_email text,
  actor_name      text,
  entity_type     text,
  entity_id       text,
  data            jsonb,
  read_at         timestamptz,
  deliveries      jsonb
)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  return query
  select n.id, n.created_at, n.type, n.user_id,
         nullif(trim(rp.display_name), '')::text,
         u.email::text,
         nullif(trim(ap.display_name), '')::text,
         n.entity_type, n.entity_id, n.data, n.read_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'platform', d.platform, 'status', d.status, 'detail', d.detail,
                    'subscription_id', d.subscription_id,
                    'app_version_name', d.app_version_name, 'user_agent', d.user_agent,
                    'at', d.created_at) order by d.created_at)
             from public.push_deliveries d where d.notification_id = n.id
         ), '[]'::jsonb)
    from public.notifications n
    left join public.profiles rp on rp.id = n.user_id
    left join public.profiles ap on ap.id = n.actor_id
    left join auth.users u      on u.id  = n.user_id
   where n.created_at >= p_since
   order by n.created_at desc
   limit greatest(least(coalesce(p_limit, 1000), 5000), 1);
end;
$$;
revoke all on function public.admin_notification_log(timestamptz, int) from public, anon;
grant execute on function public.admin_notification_log(timestamptz, int) to authenticated;

-- Every registered device right now, with what happened to its sends in the window.
create or replace function public.admin_push_devices(
  p_since timestamptz default now() - interval '30 days'
)
returns table (
  subscription_id  uuid,
  user_id          uuid,
  recipient_name   text,
  recipient_email  text,
  platform         text,
  environment      text,
  app_version_name text,
  user_agent       text,
  created_at       timestamptz,
  last_seen_at     timestamptz,
  sent             int,
  failed           int,
  last_sent_at     timestamptz
)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  return query
  select s.id, s.user_id,
         nullif(trim(p.display_name), '')::text,
         u.email::text,
         s.platform, s.environment, s.app_version_name, s.user_agent,
         s.created_at, s.last_seen_at,
         coalesce(st.sent, 0)::int, coalesce(st.failed, 0)::int, st.last_sent_at
    from public.push_subscriptions s
    left join public.profiles p on p.id = s.user_id
    left join auth.users u      on u.id = s.user_id
    left join lateral (
      select count(*) filter (where d.status = 'sent')                 as sent,
             count(*) filter (where d.status in ('failed', 'pruned'))  as failed,
             max(d.created_at) filter (where d.status = 'sent')        as last_sent_at
        from public.push_deliveries d
       where d.subscription_id = s.id and d.created_at >= p_since
    ) st on true
   order by coalesce(s.last_seen_at, s.created_at) desc;
end;
$$;
revoke all on function public.admin_push_devices(timestamptz) from public, anon;
grant execute on function public.admin_push_devices(timestamptz) to authenticated;
