-- Sandbox accounts (2026-10-11): the App Store review demo account may act ONLY on the
-- hidden 🧪 test teams/games. Enforced in the DB so it holds for web + every app build.
--
-- Why: Apple's reviewer (rinkhockeyiltestuser@gmail.com) is coach + judge and has run live
-- games on real fixtures (real suspensions, closed markets) and filed player claims on real
-- players — again on 2026-10-11 during the 1.4.10 review.
--
-- How: one BEFORE INSERT/UPDATE/DELETE trigger on every public table. It does nothing unless
-- auth.uid() is in sandbox_accounts. For a sandbox user, a top-level write (pg_trigger_depth()
-- = 1 — side effects of an allowed write, fired from other triggers, pass) is allowed only if
--   * the table is personal plumbing (telemetry, push tokens, blocks/reports, own notifications…), or
--   * the row is tied to a test game/team (game_id / issued_game_id / team_id / home/away_team_id),
-- and the own profile may not change player_id (no player ownership). Everything else raises
-- 42501 "sandbox_account". Sandbox users also SEE test games/teams (can_see_test()).
--
-- Down: supabase/sandbox-accounts-down.sql

create table if not exists public.sandbox_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note    text,
  created_at timestamptz not null default now()
);
alter table public.sandbox_accounts enable row level security;  -- no policies: invisible to clients
revoke all on public.sandbox_accounts from anon, authenticated;

create or replace function public.is_sandbox_user()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from public.sandbox_accounts where user_id = auth.uid())
$$;

-- Test rows are visible to admins AND sandbox accounts.
create or replace function public.can_see_test()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_admin(), false) or public.is_sandbox_user()
$$;

-- "Anyone signed in can stream" — a sandbox account only on test games.
create or replace function public.can_broadcast_game(p_game_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (not public.is_sandbox_user() or public.is_test_game(p_game_id))
    and (
      public.can_stream_game(p_game_id)
      or (
        auth.uid() is not null
        and exists (
          select 1 from public.games g
          where g.id = p_game_id
            and g.status <> 'completed'
            and g.game_date > now() - interval '12 hours'
            and g.game_date < now() + interval '6 hours'
            and (not coalesce(g.is_test, false) or public.can_see_test())
        )
      )
    ), false)
$$;

create or replace function public.sandbox_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  o jsonb;
  t text := tg_table_name;
  gid uuid;
  ok boolean := false;
begin
  if pg_trigger_depth() > 1 or not public.is_sandbox_user() then
    return coalesce(new, old);
  end if;

  r := to_jsonb(coalesce(new, old));
  o := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;

  -- Personal plumbing: harmless, needed for the app to work, never visible to other users.
  if t in ('app_events', 'feed_impressions', 'push_subscriptions', 'user_contact',
           'user_blocks', 'content_reports', 'notifications', 'follows') then
    return coalesce(new, old);
  end if;

  -- Own profile: name/avatar/settings fine, player ownership never.
  if t = 'profiles' then
    if (r->>'id')::uuid = auth.uid() and tg_op = 'UPDATE'
       and (r->>'player_id') is not distinct from (o->>'player_id') then
      return new;
    end if;
    raise exception using errcode = '42501', message = 'sandbox_account',
      detail = 'חשבון ההדגמה לא יכול לשייך את עצמו לשחקן.';
  end if;

  if t = 'games' then
    ok := coalesce((r->>'is_test')::boolean, false)
          and (tg_op <> 'UPDATE' or coalesce((o->>'is_test')::boolean, false));
  elsif t in ('game_stats', 'live_game_state', 'game_officials', 'game_reports', 'game_signatures',
              'game_broadcast', 'game_videos', 'game_availability', 'game_change_requests',
              'game_form_submissions', 'game_reminder_log', 'markets', 'player_suspensions') then
    gid := coalesce(r->>'game_id', r->>'issued_game_id')::uuid;
    ok := gid is not null and public.is_test_game(gid);
    if ok and tg_op = 'UPDATE' then
      gid := coalesce(o->>'game_id', o->>'issued_game_id')::uuid;
      ok := gid is not null and public.is_test_game(gid);
    end if;
  elsif t = 'game_video_markers' then
    ok := (r ? 'team_id') and exists (select 1 from public.teams where id = (r->>'team_id')::uuid and is_test);
  end if;

  if ok then
    return coalesce(new, old);
  end if;

  raise exception using errcode = '42501', message = 'sandbox_account',
    detail = format('חשבון ההדגמה פועל רק על קבוצות ומשחקי הבדיקה 🧪 (%s).', t);
end $$;

revoke execute on function public.sandbox_guard() from public, anon, authenticated;

-- Attach to every public base table (except the registry itself).
do $$
declare tbl text;
begin
  for tbl in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'sandbox_accounts'
  loop
    execute format('drop trigger if exists zz_sandbox_guard on public.%I', tbl);
    execute format('create trigger zz_sandbox_guard before insert or update or delete on public.%I
                    for each row execute function public.sandbox_guard()', tbl);
  end loop;
end $$;

-- The App Store review demo account.
insert into public.sandbox_accounts (user_id, note)
select id, 'App Store review demo account' from auth.users
where email = 'rinkhockeyiltestuser@gmail.com'
on conflict do nothing;

-- Its coach role moves from a real team to the 🧪 test team.
update public.user_roles
set team_id = (select id from public.teams where is_test and name like '%בדיקה א%' limit 1)
where role = 'coach'
  and user_id in (select user_id from public.sandbox_accounts);
