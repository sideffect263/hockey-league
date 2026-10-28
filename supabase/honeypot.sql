-- Honeypot: decoy RPCs that no client of ours ever calls (2026-10-28).
--
-- Anyone holding the public anon key can read PostgREST's OpenAPI schema and see every
-- function they may execute. These four are bait in that list: names and comments that
-- look like an admin back door. Our web/iOS/Android code never calls them, so a call is
-- by definition someone probing the API — it is logged to honeypot_hits and the admins
-- get one notification per prober per hour (/admin?tab=honeypot).
--
-- The traps grant nothing. Each one records the hit and returns a believable fake answer
-- (an exception would roll back the log row, so they never raise). Volatile on purpose:
-- PostgREST refuses GET for volatile functions — a GET runs read-only and could not log.
--
-- Down: honeypot-down.sql.

create table if not exists public.honeypot_hits (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  trap        text not null,
  user_id     uuid,
  email       text,
  is_admin    boolean not null default false,  -- an admin testing the trap, not a prober
  ip          text,
  user_agent  text,
  origin      text,
  args        jsonb,
  notified    boolean not null default false,
  dismissed   boolean not null default false
);
create index if not exists honeypot_hits_created_idx on public.honeypot_hits (created_at desc);

alter table public.honeypot_hits enable row level security;
revoke all on public.honeypot_hits from anon, authenticated;
grant select, update (dismissed) on public.honeypot_hits to authenticated;
grant usage on sequence public.honeypot_hits_id_seq to authenticated;

drop policy if exists "honeypot admin read" on public.honeypot_hits;
create policy "honeypot admin read" on public.honeypot_hits
  for select to authenticated using ((select public.is_admin()));
drop policy if exists "honeypot admin dismiss" on public.honeypot_hits;
create policy "honeypot admin dismiss" on public.honeypot_hits
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- The one writer. Not callable from the API: only the traps below reach it.
create or replace function public._honeypot_record(p_trap text, p_args jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  h       jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_uid   uuid  := auth.uid();
  v_email text  := auth.jwt() ->> 'email';
  v_admin boolean := coalesce(public.is_admin(), false);
  v_ip    text  := coalesce(h->>'cf-connecting-ip', nullif(trim(split_part(h->>'x-forwarded-for', ',', 1)), ''), h->>'x-real-ip');
  v_actor text;
  v_notify boolean;
  v_args  jsonb;
begin
  v_actor := coalesce(v_uid::text, v_ip, 'unknown');

  -- A flood must not fill the database: cap per prober and overall.
  if (select count(*) from public.honeypot_hits
       where created_at > now() - interval '1 hour'
         and coalesce(user_id::text, ip, 'unknown') = v_actor) >= 200
     or (select count(*) from public.honeypot_hits where created_at > now() - interval '1 day') >= 5000 then
    return;
  end if;

  -- Keep what they sent, but bounded: every value cut to 300 chars, at most 20 keys.
  select jsonb_object_agg(key, left(value #>> '{}', 300))
    into v_args
    from (select key, value from jsonb_each(coalesce(p_args, '{}'::jsonb)) limit 20) a;

  v_notify := not exists (
    select 1 from public.honeypot_hits
     where notified and created_at > now() - interval '1 hour'
       and coalesce(user_id::text, ip, 'unknown') = v_actor);

  insert into public.honeypot_hits (trap, user_id, email, is_admin, ip, user_agent, origin, args, notified)
  values (p_trap, v_uid, v_email, v_admin, left(v_ip, 64), left(h->>'user-agent', 400),
          left(coalesce(h->>'origin', h->>'referer'), 200), v_args, v_notify);

  if v_notify then
    -- 'announcement' already renders as title + body + in-app link in the bell, the
    -- push function and both apps, so the alert needs no client release.
    insert into public.notifications (user_id, type, entity_type, entity_id, data)
    select au.id, 'announcement', 'honeypot', p_trap,
           jsonb_build_object(
             'title', case when v_admin then 'בדיקת מלכודת' else 'מישהו נכנס למלכודת' end,
             'body',  p_trap || ' — ' || coalesce(v_email, v_ip, 'לא ידוע'),
             'href',  '/admin?tab=honeypot')
      from public.admin_users a join auth.users au on lower(au.email) = lower(a.email)
     -- An admin testing from the tab alerts only themself, not every admin's phone.
     where not v_admin or au.id = v_uid;
  end if;
exception when others then
  return;  -- a trap must never error out and tip its hand
end;
$function$;
revoke all on function public._honeypot_record(text, jsonb) from public, anon, authenticated;

-- ── the traps ────────────────────────────────────────────────────────────────

create or replace function public.admin_grant_role(p_email text, p_role text default 'admin')
returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $function$
begin
  perform public._honeypot_record('admin_grant_role', jsonb_build_object('p_email', p_email, 'p_role', p_role));
  return jsonb_build_object('ok', true, 'status', 'pending_approval', 'request_id', gen_random_uuid());
end; $function$;
comment on function public.admin_grant_role(text, text) is 'Admin: grant a role (admin | league_manager | judge) to a user by email.';

create or replace function public.export_all_users(p_limit int default 1000)
returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $function$
begin
  perform public._honeypot_record('export_all_users', jsonb_build_object('p_limit', p_limit));
  return jsonb_build_object('ok', true, 'status', 'queued', 'job_id', gen_random_uuid(),
                            'message', 'Export is being prepared and will be emailed to the requesting admin.');
end; $function$;
comment on function public.export_all_users(int) is 'Admin: export users with emails and phone numbers (CSV, emailed).';

create or replace function public.debug_sql(p_query text)
returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $function$
begin
  perform public._honeypot_record('debug_sql', jsonb_build_object('p_query', p_query));
  return jsonb_build_object('error', 'canceling statement due to statement timeout', 'code', '57014');
end; $function$;
comment on function public.debug_sql(text) is 'Internal: run a diagnostic query (dev builds).';

create or replace function public.reset_admin_password(p_email text)
returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $function$
begin
  perform public._honeypot_record('reset_admin_password', jsonb_build_object('p_email', p_email));
  return jsonb_build_object('ok', true, 'sent', true);
end; $function$;
comment on function public.reset_admin_password(text) is 'Admin: issue a password reset link for an account.';

grant execute on function public.admin_grant_role(text, text)  to anon, authenticated;
grant execute on function public.export_all_users(int)        to anon, authenticated;
grant execute on function public.debug_sql(text)              to anon, authenticated;
grant execute on function public.reset_admin_password(text)   to anon, authenticated;
