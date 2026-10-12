-- Player linking hardening (2026-10-12)
--
-- The two ways an account becomes a player — CLAIM an existing card (player_claims)
-- or SUBMIT a new one (player_submissions) — were guarded only within their own
-- table. One account could hold a pending claim AND a pending submission; approving
-- both re-pointed the profile at one player and left the other card ownerless (the
-- duplicate-card mess the league already paid for once). This closes that and a few
-- neighbours found in the same audit:
--
--  1. One open request per account ACROSS both tables, and none once linked
--     (BEFORE INSERT guard → 'request_already_pending' / 'profile_already_linked').
--  2. approve_claim refuses a non-pending claim and never overwrites an existing link;
--     approve_player_submission refuses when the submitter is already linked (it used
--     to create the players row anyway and silently skip the link → orphan card).
--  3. reject_claim on a FREE AGENT raised 'claim not found' for everyone (it looked the
--     claim up through the player's team_id). Free-agent claims are now reviewable by
--     admins and league managers, matching free-agent submissions.
--  4. Claim rejection takes an optional reason (player_claims.decision_note) and the
--     notification carries it.
--  5. New claims notify the team's coach first (notify_team_reviewers), like new-card
--     submissions — the coach is the one who approves them. Was: admins only.
--  6. New-card submissions carry a birth_date, copied onto the player on approval (the
--     loan rule needs it; `age` stays for older app builds).
--  7. Submitters got TWO notifications per decision (the decision trigger + the
--     audience fan-out both included them). The fan-outs now skip the submitter; the
--     decision trigger (which deep-links to the new player) now carries the reason.
--
-- Down: player-linking-hardening-down.sql

alter table public.player_claims
  add column if not exists decision_note text
  check (decision_note is null or char_length(decision_note) <= 500);

alter table public.player_submissions
  add column if not exists birth_date date
  check (birth_date is null or (birth_date > date '1930-01-01' and birth_date <= current_date));

-- 1 ── one open request per account, across both tables ───────────────────────────
create or replace function public.guard_player_link_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.status is distinct from 'pending' then return NEW; end if;
  if exists (select 1 from public.profiles where id = NEW.profile_id and player_id is not null) then
    raise exception 'profile_already_linked';
  end if;
  if TG_TABLE_NAME = 'player_claims' then
    if exists (select 1 from public.player_submissions
                where profile_id = NEW.profile_id and status = 'pending') then
      raise exception 'request_already_pending';
    end if;
  else
    if exists (select 1 from public.player_claims
                where profile_id = NEW.profile_id and status = 'pending') then
      raise exception 'request_already_pending';
    end if;
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_guard_link_request on public.player_claims;
create trigger trg_guard_link_request before insert on public.player_claims
  for each row execute function public.guard_player_link_request();
drop trigger if exists trg_guard_link_request on public.player_submissions;
create trigger trg_guard_link_request before insert on public.player_submissions
  for each row execute function public.guard_player_link_request();

-- 2/3 ── approve / reject claim ─────────────────────────────────────────────────────
create or replace function public.can_review_claim(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or public.is_coach_of(p_team)
      or (p_team is null and public.is_league_manager())
$$;

create or replace function public.approve_claim(p_claim_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid; v_player uuid; v_status text; v_team uuid; v_current uuid;
begin
  select profile_id, player_id, status into v_profile, v_player, v_status
    from public.player_claims where id = p_claim_id;
  if v_profile is null then raise exception 'claim not found'; end if;

  select team_id into v_team from public.players where id = v_player;
  if not public.can_review_claim(v_team) then raise exception 'not authorized'; end if;
  if v_status <> 'pending' then raise exception 'claim not pending'; end if;

  select player_id into v_current from public.profiles where id = v_profile;
  if v_current is not null and v_current <> v_player then
    raise exception 'profile_already_linked';
  end if;

  -- profiles.player_id is UNIQUE: raises 23505 if that player is already claimed.
  update public.profiles set player_id = v_player where id = v_profile;

  if v_team is not null then
    insert into public.user_roles (user_id, role, team_id)
      values (v_profile, 'player', v_team)
      on conflict (user_id, role, team_id) do nothing;
  end if;

  update public.player_claims
     set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_claim_id;
end; $$;

drop function if exists public.reject_claim(uuid);
create or replace function public.reject_claim(p_claim_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_found boolean; v_status text; v_team uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select true, c.status, pl.team_id into v_found, v_status, v_team
    from public.player_claims c left join public.players pl on pl.id = c.player_id
   where c.id = p_claim_id;
  if v_found is null then raise exception 'claim not found'; end if;
  if not public.can_review_claim(v_team) then raise exception 'not authorized'; end if;
  if v_status <> 'pending' then raise exception 'claim not pending'; end if;

  update public.player_claims
     set status = 'rejected', decision_note = left(v_reason, 500),
         reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_claim_id;
end; $$;
grant execute on function public.reject_claim(uuid, text) to authenticated;

-- RLS: league managers may already READ claims; reviewers' writes go through the RPCs.

-- 4 ── claim decision notification carries the reason ──────────────────────────────
create or replace function public.notify_on_claim_review()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pname text;
begin
  if NEW.status is distinct from OLD.status and NEW.status in ('approved', 'rejected') then
    select coalesce(first_name, '') || ' ' || coalesce(last_name, '') into v_pname
      from public.players where id = NEW.player_id;
    perform public.create_notification(
      NEW.profile_id,
      case when NEW.status = 'approved' then 'claim_approved' else 'claim_rejected' end,
      NEW.reviewed_by, 'player', NEW.player_id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'player_name', trim(coalesce(v_pname, '')),
        'reason', NEW.decision_note)));
  end if;
  return null;
exception when others then return null;
end; $$;

-- 5 ── new claim → the team's coach first ───────────────────────────────────────────
create or replace function public.notify_admins_new_claim()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pname text; v_cname text; v_team uuid;
begin
  select coalesce(first_name, '') || ' ' || coalesce(last_name, ''), team_id
    into v_pname, v_team from public.players where id = NEW.player_id;
  select display_name into v_cname from public.profiles where id = NEW.profile_id;
  perform public.notify_team_reviewers(
    v_team, 'claim_request', NEW.profile_id, 'claim', NEW.id::text,
    jsonb_build_object('player_name', trim(coalesce(v_pname, '')),
                       'claimant', coalesce(v_cname, ''), 'team_id', v_team),
    (v_team is null));
  return null;
exception when others then return null;
end; $$;

-- 2/6 ── approve submission: refuse when already linked; carry birth_date ──────────
create or replace function public.approve_player_submission(p_submission_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid; v_team uuid; v_status text; v_player uuid;
  v_first text; v_last text; v_jersey integer; v_pos text; v_age integer; v_photo text;
  v_dob date;
begin
  select profile_id, team_id, status, first_name, last_name, jersey_number, position, age, photo_url, birth_date
    into v_profile, v_team, v_status, v_first, v_last, v_jersey, v_pos, v_age, v_photo, v_dob
    from public.player_submissions where id = p_submission_id;
  if v_profile is null then raise exception 'submission not found'; end if;
  if v_status <> 'pending' then raise exception 'submission not pending'; end if;
  if v_team is null then
    if not (public.is_admin() or public.is_league_manager()) then raise exception 'not authorized'; end if;
  else
    if not (public.is_admin() or public.is_coach_of(v_team)) then raise exception 'not authorized'; end if;
  end if;
  if exists (select 1 from public.profiles where id = v_profile and player_id is not null) then
    raise exception 'profile_already_linked';
  end if;

  insert into public.players (first_name, last_name, jersey_number, position, age, photo_url, team_id, birth_date)
    values (v_first, v_last, v_jersey, v_pos, v_age, v_photo, v_team, v_dob)
    returning id into v_player;

  update public.profiles set player_id = v_player where id = v_profile and player_id is null;

  if v_team is not null then
    insert into public.user_roles (user_id, role, team_id) values (v_profile, 'player', v_team)
      on conflict (user_id, role, team_id) do nothing;
  end if;

  update public.player_submissions set status='approved', player_id=v_player, reviewed_at=now(), reviewed_by=auth.uid()
    where id = p_submission_id;
  return v_player;
end; $$;

-- 7 ── one notification per decision for the submitter ─────────────────────────────
create or replace function public.notify_submission_approved()
returns trigger language plpgsql security definer set search_path = public as $$
declare rec record; v_name text;
begin
  if NEW.status = 'approved' and OLD.status is distinct from 'approved' then
    v_name := btrim(coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, ''));
    for rec in select user_id from public.submission_audience(NEW.id) loop
      -- the submitter hears it from notify_player_submission_decision
      if rec.user_id is not null and rec.user_id <> NEW.profile_id then
        perform public.create_notification(
          rec.user_id, 'player_submission_approved', null::uuid, 'team', NEW.team_id::text,
          jsonb_build_object('candidate_name', v_name, 'player_id', NEW.player_id));
      end if;
    end loop;
  end if;
  return null;
exception when others then return null;
end; $$;

create or replace function public.reject_player_submission(p_submission_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_team uuid; v_status text; v_name text; v_profile uuid; rec record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select team_id, status, btrim(first_name || ' ' || last_name), profile_id
    into v_team, v_status, v_name, v_profile
    from public.player_submissions where id = p_submission_id;
  if v_profile is null then raise exception 'submission not found'; end if;
  if not (public.is_admin() or public.is_league_manager() or public.is_coach_of(v_team)) then
    raise exception 'not authorized';
  end if;
  if v_status <> 'pending' then raise exception 'submission not pending'; end if;
  if v_reason is null then raise exception 'reason is required'; end if;

  update public.player_submissions
     set status = 'rejected', decision_note = v_reason,
         reviewed_at = now(), reviewed_by = (select auth.uid())
   where id = p_submission_id;

  for rec in select user_id from public.submission_audience(p_submission_id) loop
    -- the submitter hears it from notify_player_submission_decision
    if rec.user_id is not null and rec.user_id <> v_profile then
      perform public.create_notification(
        rec.user_id, 'player_submission_rejected', (select auth.uid()),
        'team', v_team::text,
        jsonb_build_object('candidate_name', coalesce(v_name, ''), 'reason', v_reason));
    end if;
  end loop;
end; $$;

create or replace function public.notify_player_submission_decision()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cname text;
begin
  if NEW.status is distinct from OLD.status and NEW.status in ('approved','rejected') then
    v_cname := trim(coalesce(NEW.first_name,'') || ' ' || coalesce(NEW.last_name,''));
    perform public.create_notification(
      NEW.profile_id,
      case when NEW.status = 'approved' then 'player_submission_approved' else 'player_submission_rejected' end,
      NEW.reviewed_by, 'player', coalesce(NEW.player_id::text, NEW.id::text),
      jsonb_strip_nulls(jsonb_build_object(
        'candidate_name', v_cname, 'player_id', NEW.player_id,
        'reason', case when NEW.status = 'rejected' then NEW.decision_note end)));
  end if;
  return null;
exception when others then return null;
end; $$;
