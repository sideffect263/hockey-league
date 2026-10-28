-- Undo card-unlink-requests-enforce.sql: restores both functions exactly as they were on
-- prod on 2026-10-29.
create or replace function public.disconnect_my_pairing()
returns void language plpgsql security definer set search_path to 'public' as $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  update public.profiles set player_id = null where id = uid;
  delete from public.user_roles where user_id = uid and role = 'player';
  delete from public.player_claims where profile_id = uid and status = 'approved';
end;
$function$;

create or replace function public.guard_profile_player_id()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.player_id is distinct from old.player_id
     and not public.is_admin()
     and not public.is_league_manager()
     and not (new.player_id is null and old.id = auth.uid())
     and not (
       new.player_id is not null
       and public.is_coach_of((select team_id from public.players where id = new.player_id))
     ) then
    raise exception 'player_id can only be changed by an admin';
  end if;
  return new;
end;
$function$;
