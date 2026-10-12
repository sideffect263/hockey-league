-- Telemetry: one append-only event stream for web + iOS + Android.
--
-- Why this exists: the bug class that keeps biting this project is INVISIBLE to the
-- Supabase edge logs. A Swift decode that throws, a runCatching that swallows a 403,
-- a React render that white-screens — every one of those is a clean HTTP 200 (or a
-- request that never leaves the device) and shows up nowhere. The only place that
-- knows is the client, so the client has to say so.
--
-- Data lives here, not in a third party: these events carry role and screen context
-- for accounts belonging to minors, and that stays inside the project's own database.

create table if not exists public.app_events (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  user_id      uuid references auth.users(id) on delete set null,
  -- Client-generated, per app session. Lets you follow one person's path through a
  -- screen without needing them to be signed in.
  session_id   text,
  platform     text not null check (platform in ('web','ios','android')),
  app_version  text,
  -- 'page'   — a screen was shown
  -- 'action' — the user did something deliberate (saved a game, approved a claim)
  -- 'error'  — something failed: a rejected request, a thrown render, a decode
  kind         text not null check (kind in ('page','action','error')),
  name         text not null,
  path         text,
  status       int,
  duration_ms  int,
  detail       jsonb not null default '{}'::jsonb
);

-- The dashboard reads "recent", "recent errors", and "recent for this user". All three
-- are time-ordered, so lead every index with created_at desc.
create index if not exists app_events_created_idx  on public.app_events (created_at desc);
create index if not exists app_events_kind_idx     on public.app_events (kind, created_at desc);
create index if not exists app_events_user_idx     on public.app_events (user_id, created_at desc) where user_id is not null;
create index if not exists app_events_platform_idx on public.app_events (platform, created_at desc);

alter table public.app_events enable row level security;

-- Readable ONLY by the people who already run the league. There is deliberately no
-- INSERT policy: writes come through log_app_events() under definer rights, so a
-- client can never forge a user_id or a timestamp, and can never read the stream back.
drop policy if exists "Managers read telemetry" on public.app_events;
create policy "Managers read telemetry" on public.app_events
  for select to authenticated
  using (public.is_admin() or public.is_league_manager());

revoke all on public.app_events from anon, authenticated;
grant select on public.app_events to authenticated;

/**
 * Record a batch of client events.
 *
 * Definer, so the table needs no client write grant at all. user_id is taken from the
 * JWT and never from the payload. Anonymous visitors may write (that is the point —
 * a crash on the public player page happens before anyone signs in), so the function
 * is deliberately defensive: it caps the batch, caps every string, drops unknown
 * enum values instead of raising, and rate-limits per caller.
 *
 * Returns the number of rows actually stored.
 */
create or replace function public.log_app_events(p_events jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_session text;
  v_stored  int;
  v_recent  int;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    return 0;
  end if;

  -- The batch cap is the first line of defence; the rate limit below is the second.
  if jsonb_array_length(p_events) > 50 then
    p_events := (select jsonb_agg(e) from (
      select e from jsonb_array_elements(p_events) e limit 50
    ) s);
  end if;

  v_session := left(nullif(p_events -> 0 ->> 'session_id', ''), 64);

  -- Rate limit: a looping client (a render error inside a retry, say) must not be able
  -- to fill the table. Signed-in callers are keyed by user, anonymous ones by session.
  select count(*) into v_recent
  from public.app_events
  where created_at > now() - interval '1 minute'
    and (case when v_uid is not null then user_id = v_uid
              else user_id is null and session_id is not distinct from v_session end);
  if v_recent > 600 then
    return 0;
  end if;

  with incoming as (
    select
      v_uid                                                        as user_id,
      left(nullif(e ->> 'session_id', ''), 64)                     as session_id,
      lower(coalesce(e ->> 'platform', 'web'))                     as platform,
      left(nullif(e ->> 'app_version', ''), 32)                    as app_version,
      lower(coalesce(e ->> 'kind', 'action'))                      as kind,
      left(coalesce(nullif(e ->> 'name', ''), 'unnamed'), 120)     as name,
      left(nullif(e ->> 'path', ''), 400)                          as path,
      nullif(e ->> 'status', '')::int                              as status,
      nullif(e ->> 'duration_ms', '')::int                         as duration_ms,
      case when jsonb_typeof(e -> 'detail') = 'object'
             and length((e -> 'detail')::text) <= 4000
           then e -> 'detail' else '{}'::jsonb end                 as detail,
      -- The client's own clock is not trusted for ordering, but a queued batch sent
      -- after a reconnect would otherwise all land at the same instant. Accept a
      -- client timestamp only when it is sane: not in the future, not older than a day.
      case when (e ->> 'at') ~ '^\d{4}-' then
        greatest(least((e ->> 'at')::timestamptz, now()), now() - interval '7 days')  -- 7d: queued offline events + next-launch crash reports (2026-10-12)
      else now() end                                               as created_at
    from jsonb_array_elements(p_events) e
  )
  insert into public.app_events
    (created_at, user_id, session_id, platform, app_version, kind, name, path, status, duration_ms, detail)
  select i.created_at, i.user_id, i.session_id, i.platform, i.app_version, i.kind, i.name, i.path, i.status, i.duration_ms, i.detail
  from incoming i
  -- Drop rather than raise: one malformed event must never cost the whole batch, and
  -- the client is fire-and-forget so it would never see the error anyway.
  where i.platform in ('web','ios','android')
    and i.kind in ('page','action','error')
    -- PostgREST sends EVERY rpc as a POST, read-only ones included, so the client
    -- cannot tell "the user approved a claim" from "the page fetched some badges".
    -- The database can: a function that only reads is declared STABLE or IMMUTABLE.
    -- Filtering here rather than with a client-side allowlist keeps the action log
    -- correct on its own as functions are added, and means an old app build can never
    -- drift out of step with it.
    --
    -- Errors are always kept: a STABLE function returning 403 is exactly the failure
    -- this whole table exists to catch.
    and not (
      i.kind = 'action'
      and exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = i.name and p.provolatile <> 'v'
      )
    );

  get diagnostics v_stored = row_count;
  return v_stored;
end;
$$;

revoke execute on function public.log_app_events(jsonb) from public;
grant execute on function public.log_app_events(jsonb) to anon, authenticated;

/**
 * Overview rollup for the dashboard's header cards: one row per (kind, platform) with
 * event, user and session counts over the window. Gated like the table it reads.
 */
create or replace function public.app_event_summary(p_hours int default 24)
returns table (kind text, platform text, events bigint, users bigint, sessions bigint)
language sql
stable
security definer
set search_path = public
as $$
  select e.kind, e.platform, count(*),
         count(distinct e.user_id), count(distinct e.session_id)
  from public.app_events e
  where (public.is_admin() or public.is_league_manager())
    and e.created_at > now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 720)))
  group by e.kind, e.platform
  order by 3 desc;
$$;

revoke execute on function public.app_event_summary(int) from public, anon;
grant execute on function public.app_event_summary(int) to authenticated;

/** Most-used screens and actions over the window, for the dashboard's two top lists. */
create or replace function public.app_event_top(p_kind text, p_hours int default 24, p_limit int default 20)
returns table (name text, path text, events bigint, users bigint)
language sql
stable
security definer
set search_path = public
as $$
  select e.name, e.path, count(*), count(distinct coalesce(e.user_id::text, e.session_id))
  from public.app_events e
  where (public.is_admin() or public.is_league_manager())
    and e.kind = p_kind
    and e.created_at > now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 720)))
  group by e.name, e.path
  order by 3 desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

revoke execute on function public.app_event_top(text, int, int) from public, anon;
grant execute on function public.app_event_top(text, int, int) to authenticated;

-- Retention. An append-only event stream with no expiry is a slow-motion storage bill
-- and, because these rows describe real people's sessions, a slowly growing liability.
-- 90 days is long enough to answer "when did this start?" about any release.
--
-- Definer + an explicit created_at predicate: `safeupdate` is preloaded for this
-- database and rejects a bare DELETE even inside a definer function, and a
-- `where id is not null` would be folded away by the planner on PG17 — so bound it on
-- the column actually being filtered.
create or replace function public.prune_app_events()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.app_events
  where created_at < now() - interval '90 days'
    and created_at > '-infinity'::timestamptz;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.prune_app_events() from public, anon, authenticated;

select cron.schedule('prune-app-events', '40 3 * * *', 'select public.prune_app_events();');
