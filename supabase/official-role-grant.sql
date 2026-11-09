-- Officials managers grant / revoke their own official role (2026-11-09).
--
-- Ariel: on the חובשים tab the medic manager should be able to make a user a medic
-- (and take it away) without asking an admin. Same gate as everything else officials:
-- can_manage_official(role) — admin / league manager → judge or medic; medic_manager →
-- medic only; referee_manager → judge only. user_roles stays admin-only by RLS; these
-- SECURITY DEFINER RPCs are the only way in for a manager, and they touch ONLY rows with
-- role in ('judge','medic').
--
-- Candidate search returns name + avatar + linked player name only, never email/phone.
-- Bots and device (club-phone) accounts are left out.
-- user_roles.granted_by is filled by its trigger from auth.uid() (still the caller here).
-- Rollback: official-role-grant-down.sql

create or replace function public.official_role_candidates(p_role text, p_query text default '')
returns table(user_id uuid, display_name text, avatar_url text, player_name text, has_role boolean)
language plpgsql stable security definer set search_path to 'public' as $function$
declare q text := btrim(coalesce(p_query, ''));
begin
  if p_role not in ('judge','medic') or not public.can_manage_official(p_role) then
    raise exception 'not authorized';
  end if;
  if length(q) < 2 then return; end if;
  return query
    select pr.id, pr.display_name, pr.avatar_url,
           nullif(btrim(coalesce(pl.first_name, '') || ' ' || coalesce(pl.last_name, '')), ''),
           exists (select 1 from public.user_roles ur where ur.user_id = pr.id and ur.role = p_role)
      from public.profiles pr
      left join public.players pl on pl.id = pr.player_id
     where coalesce(pr.is_bot, false) = false
       and not exists (select 1 from public.device_accounts d where d.user_id = pr.id)
       and (pr.display_name ilike '%' || q || '%'
            or (coalesce(pl.first_name, '') || ' ' || coalesce(pl.last_name, '')) ilike '%' || q || '%')
     order by pr.display_name
     limit 20;
end; $function$;

create or replace function public.grant_official_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_role not in ('judge','medic') or not public.can_manage_official(p_role) then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found';
  end if;
  insert into public.user_roles (user_id, role, team_id)
  select p_user_id, p_role, null
   where not exists (select 1 from public.user_roles where user_id = p_user_id and role = p_role);
end; $function$;

create or replace function public.revoke_official_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_role not in ('judge','medic') or not public.can_manage_official(p_role) then
    raise exception 'not authorized';
  end if;
  delete from public.user_roles where user_id = p_user_id and role = p_role;
end; $function$;

revoke all on function public.official_role_candidates(text, text) from public, anon;
revoke all on function public.grant_official_role(uuid, text) from public, anon;
revoke all on function public.revoke_official_role(uuid, text) from public, anon;
grant execute on function public.official_role_candidates(text, text) to authenticated;
grant execute on function public.grant_official_role(uuid, text) to authenticated;
grant execute on function public.revoke_official_role(uuid, text) to authenticated;
