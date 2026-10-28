-- Referee / secretary role request — 2026-10-29. NOT APPLIED to prod yet (written on
-- branch roles-requests; apply after Ariel confirms). Undo: official-role-requests-down.sql.
--
-- Until now there was no way to ASK for the referee/secretary role: an admin gave it by
-- hand in /admin תפקידים (user_roles role 'judge'), and the onboarding "שופט או מזכירות"
-- step could only explain that. This adds a request the user files (onboarding, or later)
-- and a league manager / admin approves or rejects, like coach_requests.
--
-- ROLE MAPPING. There is exactly one official role on the server: user_roles.role =
-- 'judge' (team_id null — all 15 existing judge rows are league-wide). It is what opens
-- the judge board (web JudgeGate = hasRole('judge'), iOS isJudgeRole), lets a person
-- apply for a game's judge slot (OfficialSelfSubmit), enter results, and — through
-- trg_user_roles_resync_referee — sets players.is_referee on the linked card. A
-- "secretary" (מזכירות · שופט שולחן) runs the SAME judge board, so there is no separate
-- secretary role: approving either box (or both) grants 'judge'. The two booleans are kept
-- on the request so the league manager sees what the person asked for, and so a separate
-- role can be split out later without asking everyone again. Per-game work still goes
-- through game_officials (apply → approve) exactly as today; nothing here touches it.
--
-- Notifications (bell rows → trg_notify_push → send-push, so they also push; every row is
-- an action item or a decision, allowed by the notification policy):
--   official_role_request   → every admin + league manager, on a NEW request (insert only;
--                             editing a pending request does not re-notify)
--   role_granted            → the user, when approval inserts the judge row (the existing
--                             trg_notify_role_grant on user_roles — same as the coach flow)
--   official_role_approved  → the user, when approved but he already had the judge role
--                             (no role row inserted, so no role_granted)
--   official_role_rejected  → the user, on rejection

create table if not exists public.official_role_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  wants_referee   boolean not null default false,
  wants_secretary boolean not null default false,
  note            text,
  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by      uuid references public.profiles(id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint official_role_requests_wants_something check (wants_referee or wants_secretary)
);

-- One open request per user (request_official_role updates it instead of adding a second).
create unique index if not exists official_role_requests_one_pending
  on public.official_role_requests (user_id) where status = 'pending';
create index if not exists official_role_requests_status_created
  on public.official_role_requests (status, created_at);

alter table public.official_role_requests enable row level security;

-- Reads: own rows, plus admins / league managers (same checks as coach_requests).
-- Writes: none directly — every insert/update goes through the SECURITY DEFINER RPCs
-- below, which check who is asking.
drop policy if exists "Read own official role requests" on public.official_role_requests;
create policy "Read own official role requests" on public.official_role_requests
  for select using (user_id = auth.uid() or public.is_admin() or public.is_league_manager());

-- The demo (sandbox) account must not file real requests, like coach_requests.
drop trigger if exists zz_sandbox_guard on public.official_role_requests;
create trigger zz_sandbox_guard before insert or update or delete on public.official_role_requests
  for each row execute function public.sandbox_guard();

-- ---------------------------------------------------------------------------------------
-- Requester side

-- Idempotent: one pending request per user. A second call updates the pending one (new
-- boxes / note) and returns its id. Returns NULL when the account already holds the judge
-- role (nothing to ask for) — callers treat that as success.
create or replace function public.request_official_role(
  p_referee boolean, p_secretary boolean, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not (coalesce(p_referee, false) or coalesce(p_secretary, false)) then
    raise exception 'pick-referee-or-secretary';
  end if;
  if exists (select 1 from public.user_roles where user_id = v_uid and role = 'judge') then
    return null;
  end if;

  update public.official_role_requests
     set wants_referee = coalesce(p_referee, false),
         wants_secretary = coalesce(p_secretary, false),
         note = coalesce(v_note, note)
   where user_id = v_uid and status = 'pending'
  returning id into v_id;
  if v_id is not null then return v_id; end if;

  begin
    insert into public.official_role_requests (user_id, wants_referee, wants_secretary, note)
    values (v_uid, coalesce(p_referee, false), coalesce(p_secretary, false), v_note)
    returning id into v_id;
  exception when unique_violation then
    -- a parallel call won the race: that pending row is ours
    select id into v_id from public.official_role_requests where user_id = v_uid and status = 'pending';
  end;
  return v_id;
end; $$;

-- Cancels the caller's pending request. Returns true when one was cancelled.
create or replace function public.cancel_official_role_request()
returns boolean language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.official_role_requests
     set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
   where user_id = auth.uid() and status = 'pending';
  get diagnostics v_n = row_count;
  return v_n > 0;
end; $$;

-- ---------------------------------------------------------------------------------------
-- Admin / league-manager side

create or replace function public.pending_official_role_requests()
returns table(id uuid, user_id uuid, wants_referee boolean, wants_secretary boolean, note text,
              created_at timestamptz, requester text, avatar_url text, player_id uuid, player_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_league_manager()) then raise exception 'not authorized'; end if;
  return query
    select r.id, r.user_id, r.wants_referee, r.wants_secretary, r.note, r.created_at,
           pr.display_name as requester, pr.avatar_url,
           pr.player_id,
           nullif(btrim(coalesce(pl.first_name, '') || ' ' || coalesce(pl.last_name, '')), '') as player_name
      from public.official_role_requests r
      left join public.profiles pr on pr.id = r.user_id
      left join public.players pl on pl.id = pr.player_id
     where r.status = 'pending'
     order by r.created_at asc;
end; $$;

-- Approve = grant user_roles 'judge' (league-wide, team_id null) the way /admin תפקידים
-- does; the existing triggers then notify the user (role_granted) and set
-- players.is_referee on his card. Reject = bell row for the user.
create or replace function public.decide_official_role_request(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_ref boolean; v_sec boolean; v_granted int := 0;
begin
  if not (public.is_admin() or public.is_league_manager()) then raise exception 'not authorized'; end if;
  select user_id, wants_referee, wants_secretary into v_user, v_ref, v_sec
    from public.official_role_requests where id = p_id and status = 'pending'
    for update;
  if v_user is null then raise exception 'request not found'; end if;

  if p_approve then
    -- team_id is null, so the (user_id, role, team_id) unique key never conflicts
    -- (nulls are distinct) — hence "where not exists" instead of "on conflict".
    insert into public.user_roles (user_id, role, team_id)
    select v_user, 'judge', null
     where not exists (select 1 from public.user_roles where user_id = v_user and role = 'judge');
    get diagnostics v_granted = row_count;
  end if;

  update public.official_role_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;

  if not p_approve then
    perform public.create_notification(v_user, 'official_role_rejected', auth.uid(), 'official_role_request', p_id::text,
      jsonb_build_object('wants_referee', v_ref, 'wants_secretary', v_sec));
  elsif v_granted = 0 then
    perform public.create_notification(v_user, 'official_role_approved', auth.uid(), 'official_role_request', p_id::text,
      jsonb_build_object('wants_referee', v_ref, 'wants_secretary', v_sec));
  end if;
end; $$;

-- ---------------------------------------------------------------------------------------
-- New request → bell + push for every admin and league manager (same recipients and
-- shape as notify_admins_new_coach_request).

create or replace function public.notify_admins_new_official_role_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select display_name into v_name from public.profiles where id = NEW.user_id;
  insert into public.notifications(user_id, type, actor_id, entity_type, entity_id, data)
  select distinct r.uid, 'official_role_request', NEW.user_id, 'official_role_request', NEW.id::text,
         jsonb_build_object('requester', coalesce(v_name, ''),
                            'wants_referee', NEW.wants_referee, 'wants_secretary', NEW.wants_secretary)
  from (
    select au.id as uid from public.admin_users a join auth.users au on au.email = a.email
    union
    select ur.user_id as uid from public.user_roles ur where ur.role = 'league_manager'
  ) r
  where r.uid <> NEW.user_id;
  return null;
exception when others then return null;
end; $$;

drop trigger if exists trg_notify_new_official_role_request on public.official_role_requests;
create trigger trg_notify_new_official_role_request
  after insert on public.official_role_requests
  for each row execute function public.notify_admins_new_official_role_request();

revoke all on function public.notify_admins_new_official_role_request() from public, anon, authenticated;
revoke all on function public.request_official_role(boolean, boolean, text) from public, anon;
revoke all on function public.cancel_official_role_request() from public, anon;
revoke all on function public.pending_official_role_requests() from public, anon;
revoke all on function public.decide_official_role_request(uuid, boolean) from public, anon;
grant execute on function public.request_official_role(boolean, boolean, text) to authenticated;
grant execute on function public.cancel_official_role_request() to authenticated;
grant execute on function public.pending_official_role_requests() to authenticated;
grant execute on function public.decide_official_role_request(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
