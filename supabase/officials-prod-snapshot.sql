-- 2026-10-09: snapshot of LIVE definitions that the repo's SQL had drifted from.
-- officials.sql / officials-contact.sql hold OLDER versions of apply_as_official and
-- game_officials_overview (e.g. the repo still raised 'missing full name'); the
-- is_referee mirror (referee_flag_derived_from_judge_role, 2026-09-20) was never committed.
-- This file is the source of truth for these objects; re-running it is a no-op on prod.

CREATE OR REPLACE FUNCTION public.apply_as_official(p_game_id uuid, p_role text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_phone text; v_player uuid; v_uid uuid := (select auth.uid());
begin
  if p_role not in ('judge','medic') then raise exception 'bad role'; end if;
  if p_role = 'judge' and not (public.is_admin() or public.is_judge()) then raise exception 'not authorized'; end if;
  if p_role = 'medic' and not (public.is_admin() or public.is_medic()) then raise exception 'not authorized'; end if;

  -- conflict of interest: his own team is playing
  select player_id into v_player from public.profiles where id = v_uid;
  if v_player is not null and exists (
    select 1 from public.games g
    where g.id = p_game_id
      and (exists (select 1 from public.players p
                   where p.id = v_player and p.team_id in (g.home_team_id, g.away_team_id))
           or exists (select 1 from public.player_teams pt
                      where pt.player_id = v_player and pt.team_id in (g.home_team_id, g.away_team_id)))
  ) then
    raise exception 'own team';
  end if;

  -- one person cannot cover both roles in the same game
  if exists (select 1 from public.game_officials
             where game_id = p_game_id and user_id = v_uid
               and role <> p_role and status in ('applied','approved','assigned')) then
    raise exception 'other role taken';
  end if;

  -- the medic's number is what the game sheet needs; his name comes from the account
  if p_role = 'medic' then
    select phone into v_phone from public.user_contact where user_id = v_uid;
    if coalesce(btrim(v_phone), '') = '' then raise exception 'missing phone'; end if;
  end if;

  insert into public.game_officials (game_id, user_id, role, status, created_by)
    values (p_game_id, v_uid, p_role, 'applied', v_uid)
    on conflict (game_id, role, user_id) do update
      -- re-applying after a decline is allowed; an approved row is left alone
      set status = case when public.game_officials.status = 'approved' then 'approved' else 'applied' end,
          reviewed_by = null, reviewed_at = null;

  insert into public.notifications (user_id, type, actor_id, entity_type, entity_id, data)
  select distinct u, 'official_application', v_uid, 'game', p_game_id::text,
         jsonb_build_object('role', p_role)
  from ( select ur.user_id as u from public.user_roles ur where ur.role = 'league_manager'
         union
         select usr.id from public.admin_users au
           join auth.users usr on lower(usr.email) = lower(au.email) ) t(u)
  where u is not null and u <> v_uid;
end;
$function$;

CREATE OR REPLACE FUNCTION public.game_officials_overview()
 RETURNS TABLE(id uuid, game_id uuid, user_id uuid, display_name text, full_name text, phone text, role text, status text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if not (public.is_admin() or public.is_league_manager()) then raise exception 'not authorized'; end if;
  return query
    select go.id, go.game_id, go.user_id, pr.display_name,
           -- a "full name" with no letters (Itay typed ".") is no name: callers fall back
           -- to display_name (migration officials_overview_ignore_no_letter_names).
           case when uc.full_name ~ '[[:alpha:]א-ת]' then btrim(uc.full_name) end as full_name,
           uc.phone,
           go.role, go.status
    from public.game_officials go
    join public.games g on g.id = go.game_id and g.status <> 'completed'
    left join public.profiles pr     on pr.id      = go.user_id
    left join public.user_contact uc on uc.user_id = go.user_id;
end;
$function$;

-- players.is_referee = DERIVED mirror of user_roles judge (never hand-set).
CREATE OR REPLACE FUNCTION public.player_has_judge_role(p_player uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.profiles pr
    join public.user_roles ur on ur.user_id = pr.id and ur.role = 'judge'
    where pr.player_id = p_player
  )
$function$;

CREATE OR REPLACE FUNCTION public.force_player_referee_flag()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  new.is_referee := public.player_has_judge_role(new.id);
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.resync_player_referee_flags()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  update public.players p
     set is_referee = public.player_has_judge_role(p.id)
   where coalesce(p.is_referee, false) is distinct from public.player_has_judge_role(p.id);
  return null;
end;
$function$;

DROP TRIGGER IF EXISTS trg_players_force_referee_flag ON public.players;
CREATE TRIGGER trg_players_force_referee_flag BEFORE INSERT OR UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION force_player_referee_flag();
DROP TRIGGER IF EXISTS trg_user_roles_resync_referee ON public.user_roles;
CREATE TRIGGER trg_user_roles_resync_referee AFTER INSERT OR DELETE OR UPDATE ON public.user_roles
  FOR EACH STATEMENT EXECUTE FUNCTION resync_player_referee_flags();
DROP TRIGGER IF EXISTS trg_profiles_resync_referee ON public.profiles;
CREATE TRIGGER trg_profiles_resync_referee AFTER INSERT OR DELETE OR UPDATE ON public.profiles
  FOR EACH STATEMENT EXECUTE FUNCTION resync_player_referee_flags();
