-- Down for player-linking-hardening.sql. Restores the guards/notifiers to their
-- pre-2026-10-12 behaviour. Columns are kept (dropping decision_note / birth_date
-- would lose data); drop them by hand if you really mean it.

drop trigger if exists trg_guard_link_request on public.player_claims;
drop trigger if exists trg_guard_link_request on public.player_submissions;
drop function if exists public.guard_player_link_request();

create or replace function public.approve_claim(p_claim_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_profile uuid; v_player uuid; v_team uuid;
begin
  select profile_id, player_id into v_profile, v_player from public.player_claims where id = p_claim_id;
  if v_profile is null then raise exception 'claim not found'; end if;
  select team_id into v_team from public.players where id = v_player;
  if not (public.is_admin() or public.is_coach_of(v_team)) then raise exception 'not authorized'; end if;
  update public.profiles set player_id = v_player where id = v_profile;
  insert into public.user_roles (user_id, role, team_id) values (v_profile, 'player', v_team)
    on conflict (user_id, role, team_id) do nothing;
  update public.player_claims set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_claim_id;
end; $$;

drop function if exists public.reject_claim(uuid, text);
create or replace function public.reject_claim(p_claim_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_team uuid;
begin
  select pl.team_id into v_team from public.player_claims c join public.players pl on pl.id = c.player_id
   where c.id = p_claim_id;
  if v_team is null then raise exception 'claim not found'; end if;
  if not (public.is_admin() or public.is_coach_of(v_team)) then raise exception 'not authorized'; end if;
  update public.player_claims set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_claim_id;
end; $$;
grant execute on function public.reject_claim(uuid) to authenticated;
drop function if exists public.can_review_claim(uuid);

create or replace function public.notify_admins_new_claim()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pname text; v_cname text;
begin
  select coalesce(first_name, '') || ' ' || coalesce(last_name, '') into v_pname from public.players where id = NEW.player_id;
  select display_name into v_cname from public.profiles where id = NEW.profile_id;
  insert into public.notifications(user_id, type, actor_id, entity_type, entity_id, data)
  select au.id, 'claim_request', NEW.profile_id, 'claim', NEW.id::text,
         jsonb_build_object('player_name', trim(coalesce(v_pname, '')), 'claimant', coalesce(v_cname, ''))
  from public.admin_users a join auth.users au on au.email = a.email
  where au.id <> NEW.profile_id;
  return null;
exception when others then return null;
end; $$;

-- approve_player_submission / reject_player_submission / notify_* : re-run the
-- definitions from supabase/player-submissions.sql + notifications-parity.sql if a
-- full revert is needed; the hardened versions are backward compatible.
