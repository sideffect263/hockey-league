-- "זה לא הכרטיס שלי" as a request — 2026-10-29. NOT APPLIED to prod yet (written on
-- branch roles-requests; apply after Ariel confirms). Undo: card-unlink-requests-down.sql.
--
-- Today an account linked to a player card can unlink itself instantly
-- (disconnect_my_pairing: web /me "נתק שיוך לשחקן", iOS הדף שלי "ניתוק השיוך לכרטיס").
-- Every linked card is an APPROVED link (profiles.player_id is only ever set by an approved
-- claim, a coach/admin link or an approved submission), so one tap could silently drop a
-- player's role, his card's sign-ups and medical view — by mistake, or on a borrowed phone.
-- From now the apps file a request instead and a league manager / admin approves it.
--
-- Approval does EXACTLY what disconnect_my_pairing does today, for the requester:
--   profiles.player_id = null; drop his 'player' user_roles rows; drop his approved claims.
-- disconnect_my_pairing itself is NOT changed here (older apps still call it). The same
-- three statements live in unlink_account_from_card(uid) below, callable only by
-- decide_card_unlink_request. Closing the old path on the server is a separate, optional
-- step: card-unlink-requests-enforce.sql (apply only once no supported app calls it).
--
-- Notifications (bell rows → trg_notify_push → send-push):
--   card_unlink_request   → every admin + league manager, on a NEW request
--   card_unlink_approved  → the user, on approval
--   card_unlink_rejected  → the user, on rejection

create table if not exists public.card_unlink_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  player_id   uuid not null references public.players(id) on delete cascade,
  reason      text,
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by  uuid references public.profiles(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);

create unique index if not exists card_unlink_requests_one_pending
  on public.card_unlink_requests (user_id) where status = 'pending';
create index if not exists card_unlink_requests_status_created
  on public.card_unlink_requests (status, created_at);

alter table public.card_unlink_requests enable row level security;

-- Reads: own rows + admins / league managers. Writes: only through the RPCs below.
drop policy if exists "Read own card unlink requests" on public.card_unlink_requests;
create policy "Read own card unlink requests" on public.card_unlink_requests
  for select using (user_id = auth.uid() or public.is_admin() or public.is_league_manager());

drop trigger if exists zz_sandbox_guard on public.card_unlink_requests;
create trigger zz_sandbox_guard before insert or update or delete on public.card_unlink_requests
  for each row execute function public.sandbox_guard();

-- ---------------------------------------------------------------------------------------
-- The body of disconnect_my_pairing(), for a given account instead of auth.uid().
-- Internal: not callable by app users (execute revoked below).
create or replace function public.unlink_account_from_card(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_uid is null then raise exception 'no account'; end if;
  update public.profiles set player_id = null where id = p_uid;
  delete from public.user_roles where user_id = p_uid and role = 'player';
  delete from public.player_claims where profile_id = p_uid and status = 'approved';
end; $$;
revoke all on function public.unlink_account_from_card(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- Requester side

-- Idempotent: one pending request per user; a second call updates its reason and returns
-- the same id. The card is the one the account is linked to right now.
create or replace function public.request_card_unlink(p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_player uuid; v_id uuid;
        v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select player_id into v_player from public.profiles where id = v_uid;
  if v_player is null then raise exception 'not-linked'; end if;

  update public.card_unlink_requests
     set reason = coalesce(v_reason, reason), player_id = v_player
   where user_id = v_uid and status = 'pending'
  returning id into v_id;
  if v_id is not null then return v_id; end if;

  begin
    insert into public.card_unlink_requests (user_id, player_id, reason)
    values (v_uid, v_player, v_reason)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.card_unlink_requests where user_id = v_uid and status = 'pending';
  end;
  return v_id;
end; $$;

create or replace function public.cancel_card_unlink_request()
returns boolean language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.card_unlink_requests
     set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
   where user_id = auth.uid() and status = 'pending';
  get diagnostics v_n = row_count;
  return v_n > 0;
end; $$;

-- ---------------------------------------------------------------------------------------
-- Admin / league-manager side

create or replace function public.pending_card_unlink_requests()
returns table(id uuid, user_id uuid, player_id uuid, reason text, created_at timestamptz,
              requester text, avatar_url text, player_name text, team_id uuid, team_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_league_manager()) then raise exception 'not authorized'; end if;
  return query
    select r.id, r.user_id, r.player_id, r.reason, r.created_at,
           pr.display_name as requester, pr.avatar_url,
           nullif(btrim(coalesce(pl.first_name, '') || ' ' || coalesce(pl.last_name, '')), '') as player_name,
           pl.team_id, t.name as team_name
      from public.card_unlink_requests r
      left join public.profiles pr on pr.id = r.user_id
      left join public.players pl on pl.id = r.player_id
      left join public.teams t on t.id = pl.team_id
     where r.status = 'pending'
     order by r.created_at asc;
end; $$;

-- Returns the outcome: 'approved' | 'rejected' | 'stale' (the account is no longer linked
-- to that card — e.g. an admin re-linked it meanwhile — so nothing is unlinked and the
-- request is closed as cancelled).
create or replace function public.decide_card_unlink_request(p_id uuid, p_approve boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_player uuid; v_now uuid; v_pname text;
begin
  if not (public.is_admin() or public.is_league_manager()) then raise exception 'not authorized'; end if;
  select user_id, player_id into v_user, v_player
    from public.card_unlink_requests where id = p_id and status = 'pending'
    for update;
  if v_user is null then raise exception 'request not found'; end if;

  select nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
    into v_pname from public.players where id = v_player;

  if p_approve then
    select player_id into v_now from public.profiles where id = v_user;
    if v_now is distinct from v_player then
      update public.card_unlink_requests
         set status = 'cancelled', decided_by = auth.uid(), decided_at = now()
       where id = p_id;
      return 'stale';
    end if;
    perform public.unlink_account_from_card(v_user);
  end if;

  update public.card_unlink_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;

  perform public.create_notification(v_user,
    case when p_approve then 'card_unlink_approved' else 'card_unlink_rejected' end,
    auth.uid(), 'player', v_player::text,
    jsonb_strip_nulls(jsonb_build_object('player_name', v_pname)));
  return case when p_approve then 'approved' else 'rejected' end;
end; $$;

-- ---------------------------------------------------------------------------------------
-- New request → bell + push for every admin and league manager.

create or replace function public.notify_admins_new_card_unlink_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_pname text;
begin
  select display_name into v_name from public.profiles where id = NEW.user_id;
  select nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
    into v_pname from public.players where id = NEW.player_id;
  insert into public.notifications(user_id, type, actor_id, entity_type, entity_id, data)
  select distinct r.uid, 'card_unlink_request', NEW.user_id, 'card_unlink_request', NEW.id::text,
         jsonb_strip_nulls(jsonb_build_object('requester', coalesce(v_name, ''), 'player_name', v_pname,
                                              'player_id', NEW.player_id, 'reason', NEW.reason))
  from (
    select au.id as uid from public.admin_users a join auth.users au on au.email = a.email
    union
    select ur.user_id as uid from public.user_roles ur where ur.role = 'league_manager'
  ) r
  where r.uid <> NEW.user_id;
  return null;
exception when others then return null;
end; $$;

drop trigger if exists trg_notify_new_card_unlink_request on public.card_unlink_requests;
create trigger trg_notify_new_card_unlink_request
  after insert on public.card_unlink_requests
  for each row execute function public.notify_admins_new_card_unlink_request();

revoke all on function public.notify_admins_new_card_unlink_request() from public, anon, authenticated;
revoke all on function public.request_card_unlink(text) from public, anon;
revoke all on function public.cancel_card_unlink_request() from public, anon;
revoke all on function public.pending_card_unlink_requests() from public, anon;
revoke all on function public.decide_card_unlink_request(uuid, boolean) from public, anon;
grant execute on function public.request_card_unlink(text) to authenticated;
grant execute on function public.cancel_card_unlink_request() to authenticated;
grant execute on function public.pending_card_unlink_requests() to authenticated;
grant execute on function public.decide_card_unlink_request(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
